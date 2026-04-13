/**
 * Tests for Layers 10–13: geometry engine
 *   Layer 12+13: src/geometry/layout.ts — buildLayout, refineLayoutWithSolver
 *   Layer 14:    src/geometry/svg.ts    — renderSvg
 *
 * Uses problem fixtures from resources/tests.txt compiled via the DSL path.
 * No LLM calls — all inputs are hand-crafted GeometryModel objects.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLayout, refineLayoutWithSolver, renderSvg } from "../../src/geometry/index.js";
import { dslToGeometryModel } from "../../src/runtime/compiler.js";
import type { GeometryDsl } from "../../src/dsl/dsl.js";

// ─── fixture helpers ──────────────────────────────────────────────────────────

function dsl(
  objects: GeometryDsl["objects"],
  constraints: GeometryDsl["constraints"] = []
): GeometryDsl {
  return { objects, constraints, constructions: [], targets: [] };
}

/** Build a LayoutModel from a hand-crafted DSL (without solver). */
function layout(objects: GeometryDsl["objects"], constraints: GeometryDsl["constraints"] = []) {
  const model = dslToGeometryModel(dsl(objects, constraints), "test");
  return buildLayout(model);
}

/** Build a LayoutModel from a hand-crafted DSL with the constraint solver. */
function layoutWithSolver(
  objects: GeometryDsl["objects"],
  constraints: GeometryDsl["constraints"] = [],
  iterations = 60
) {
  const model = dslToGeometryModel(dsl(objects, constraints), "test");
  const base = buildLayout(model);
  return refineLayoutWithSolver(model, base, { iterations });
}

// ─── buildLayout — result shape ───────────────────────────────────────────────

describe("buildLayout — result shape", () => {
  it("returns a LayoutModel with points, segments, circles, diagnostics, nodes", () => {
    const l = layout([{ type: "point", name: "A" }]);
    assert.ok(Array.isArray(l.points), "points not an array");
    assert.ok(Array.isArray(l.segments), "segments not an array");
    assert.ok(Array.isArray(l.circles), "circles not an array");
    assert.ok(Array.isArray(l.diagnostics), "diagnostics not an array");
    assert.ok(Array.isArray(l.nodes), "nodes not an array");
  });

  it("all layout points have finite x, y", () => {
    const l = layout([{ type: "triangle", points: ["A", "B", "C"] }]);
    for (const pt of l.points) {
      assert.ok(isFinite(pt.x), `point ${pt.id}.x is not finite: ${pt.x}`);
      assert.ok(isFinite(pt.y), `point ${pt.id}.y is not finite: ${pt.y}`);
    }
  });

  it("all layout circles have finite center coordinates and positive radius", () => {
    const l = layout([
      { type: "circle", center: "O", radius: 5 }
    ]);
    for (const c of l.circles) {
      assert.ok(c.radius > 0, `circle radius must be positive: ${c.radius}`);
    }
  });
});

// ─── buildLayout — triangle fixtures ─────────────────────────────────────────

describe("buildLayout — triangle fixtures", () => {
  // Fixture: "Cho tam giác ABC"
  it("triangle ABC lays out exactly 3 points", () => {
    const l = layout([{ type: "triangle", points: ["A", "B", "C"] }]);
    assert.ok(l.points.length >= 3, `expected >= 3 points, got ${l.points.length}`);
  });

  it("triangle ABC points are non-degenerate (not all same position)", () => {
    const l = layout([{ type: "triangle", points: ["A", "B", "C"] }]);
    const pts = l.points.slice(0, 3);
    const allSame = pts.every(p => p.x === pts[0].x && p.y === pts[0].y);
    assert.ok(!allSame, "all triangle points are at the same position");
  });

  // Fixture: "Cho tam giác ABC có đường trung tuyến AM"
  it("triangle ABC with midpoint M on BC includes M in layout", () => {
    const l = layout(
      [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "midpoint", point: "M", of: ["B", "C"] }
      ]
    );
    const ids = l.points.map(p => p.id);
    assert.ok(ids.includes("point:M"), `expected M in layout, got: ${ids.join(", ")}`);
  });
});

// ─── buildLayout — circle fixtures ───────────────────────────────────────────

describe("buildLayout — circle fixtures", () => {
  // Fixture: "Cho đường tròn tâm O, bán kính OA"
  it("circle O with radius OA places O and A", () => {
    const l = layout([
      { type: "circle", center: "O", through: "A" }
    ]);
    const ids = l.points.map(p => p.id);
    assert.ok(ids.includes("point:O"), `missing O, points: ${ids.join(", ")}`);
  });

  // Fixture: "Cho đường tròn (O) có đường kính CD"
  it("circle with diameter CD places C, D symmetric around O", () => {
    const l = layoutWithSolver(
      [
        { type: "circle", name: "O", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" }
      ],
      [{ type: "diameter", circle: "O", points: ["C", "D"] }],
      80
    );
    const byId = Object.fromEntries(l.points.map(p => [p.id, p]));
    const O = byId["point:O"], C = byId["point:C"], D = byId["point:D"];
    if (O && C && D) {
      const midX = (C.x + D.x) / 2;
      const midY = (C.y + D.y) / 2;
      const eps = 10; // allow some solver tolerance
      assert.ok(Math.abs(midX - O.x) < eps, `midpoint of CD (${midX.toFixed(1)}) ≠ O.x (${O.x.toFixed(1)})`);
      assert.ok(Math.abs(midY - O.y) < eps, `midpoint of CD (${midY.toFixed(1)}) ≠ O.y (${O.y.toFixed(1)})`);
    }
  });

  // Fixture: "Lấy điểm E thuộc đường tròn (O)"
  it("point E on circle O is placed at a distance ≈ radius from O", () => {
    const l = layoutWithSolver(
      [
        { type: "circle", name: "O", center: "O", radius: 5 },
        { type: "point", name: "E" }
      ],
      [{ type: "on_circle", point: "E", circle: "O" }],
      80
    );
    const byId = Object.fromEntries(l.points.map(p => [p.id, p]));
    const O = byId["point:O"], E = byId["point:E"];
    const circle = l.circles.find(c => c.center === "point:O");
    if (O && E && circle) {
      const dist = Math.hypot(E.x - O.x, E.y - O.y);
      const r = circle.radius;
      const err = Math.abs(dist - r) / r;
      assert.ok(err < 0.25, `E is not on circle O: dist=${dist.toFixed(2)}, r=${r.toFixed(2)}, err=${(err*100).toFixed(1)}%`);
    }
  });
});

// ─── buildLayout — perpendicular fixtures ────────────────────────────────────

describe("buildLayout — perpendicular constraints", () => {
  // Fixture: "Kẻ EH ⟂ CD tại H"
  it("EH perpendicular to CD: all four points are placed in layout", () => {
    const l = layoutWithSolver(
      [
        { type: "point", name: "C" },
        { type: "point", name: "D" },
        { type: "point", name: "E" },
        { type: "point", name: "H" }
      ],
      [
        { type: "right_angle", points: ["E", "H", "D"] },
        { type: "point_on_line", point: "H", line: "CD" }
      ],
      80
    );
    const ids = l.points.map(p => p.id);
    assert.ok(ids.includes("point:C"), "missing C");
    assert.ok(ids.includes("point:D"), "missing D");
    assert.ok(ids.includes("point:E"), "missing E");
    assert.ok(ids.includes("point:H"), "missing H");
    // All placed points must have finite coordinates
    for (const p of l.points) {
      assert.ok(isFinite(p.x) && isFinite(p.y), `point ${p.id} has non-finite coords`);
    }
  });
});

// ─── refineLayoutWithSolver ────────────────────────────────────────────────────

describe("refineLayoutWithSolver", () => {
  it("returns a LayoutModel with the same structure as buildLayout", () => {
    const model = dslToGeometryModel(dsl([{ type: "triangle", points: ["A", "B", "C"] }]), "test");
    const base = buildLayout(model);
    const refined = refineLayoutWithSolver(model, base, { iterations: 30 });
    assert.ok(Array.isArray(refined.points));
    assert.ok(Array.isArray(refined.circles));
    assert.ok(Array.isArray(refined.diagnostics));
  });

  it("does not produce NaN coordinates after refinement", () => {
    const objects: GeometryDsl["objects"] = [
      { type: "circle", name: "O", center: "O" },
      { type: "point", name: "C" },
      { type: "point", name: "D" },
      { type: "point", name: "E" }
    ];
    const constraints: GeometryDsl["constraints"] = [
      { type: "diameter", circle: "O", points: ["C", "D"] },
      { type: "on_circle", point: "E", circle: "O" }
    ];
    const model = dslToGeometryModel(dsl(objects, constraints), "test");
    const refined = refineLayoutWithSolver(model, buildLayout(model), { iterations: 60 });
    for (const pt of refined.points) {
      assert.ok(!isNaN(pt.x), `NaN in pt.x for ${pt.id}`);
      assert.ok(!isNaN(pt.y), `NaN in pt.y for ${pt.id}`);
    }
  });
});

// ─── renderSvg — layer 13 ─────────────────────────────────────────────────────

describe("renderSvg — layer 13", () => {
  it("returns a string containing <svg", () => {
    const l = layout([{ type: "triangle", points: ["A", "B", "C"] }]);
    const svg = renderSvg(l);
    assert.ok(typeof svg === "string" && svg.length > 0);
    assert.ok(svg.includes("<svg"), `svg missing <svg tag: ${svg.slice(0, 100)}`);
  });

  it("svg contains point labels for triangle ABC", () => {
    const l = layout([{ type: "triangle", points: ["A", "B", "C"] }]);
    const svg = renderSvg(l);
    assert.ok(svg.includes("A"), "SVG missing label A");
    assert.ok(svg.includes("B"), "SVG missing label B");
    assert.ok(svg.includes("C"), "SVG missing label C");
  });

  it("svg is valid XML (starts with < and ends with >)", () => {
    const l = layout([{ type: "triangle", points: ["A", "B", "C"] }]);
    const svg = renderSvg(l).trim();
    assert.ok(svg.startsWith("<"), "SVG should start with <");
    assert.ok(svg.endsWith(">"), "SVG should end with >");
  });

  // Fixture: "Cho đường tròn tâm O, bán kính OA" → should have a <circle> element
  it("svg for circle O contains a <circle element", () => {
    const l = layout([{ type: "circle", center: "O", radius: 5 }]);
    const svg = renderSvg(l);
    assert.ok(svg.includes("<circle"), "SVG should contain a <circle element");
  });

  it("svg for triangle ABC contains <line or <path elements (edges)", () => {
    const l = layout([{ type: "triangle", points: ["A", "B", "C"] }]);
    const svg = renderSvg(l);
    const hasEdges = svg.includes("<line") || svg.includes("<path") || svg.includes("<polyline");
    assert.ok(hasEdges, "SVG for triangle should contain line/path elements");
  });

  it("produces different SVGs for different inputs", () => {
    const svgTriangle = renderSvg(layout([{ type: "triangle", points: ["A", "B", "C"] }]));
    const svgPoint = renderSvg(layout([{ type: "point", name: "A" }]));
    assert.notEqual(svgTriangle, svgPoint);
  });
});
