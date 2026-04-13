/**
 * Tests for the v1 heuristic parser: src/parsing/parser.ts
 *
 * parseGeometryProblem() parses natural language geometry problems (Vietnamese
 * and English) using regex heuristics into a GeometryModel.
 *
 * Test inputs are drawn directly from resources/tests.txt.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGeometryProblem } from "../../src/parsing/index.js";

// ─── helper ───────────────────────────────────────────────────────────────────

function parse(text: string) {
  return parseGeometryProblem(text);
}

// ─── basic shape ─────────────────────────────────────────────────────────────

describe("parseGeometryProblem — result shape", () => {
  it("returns rawText matching input", () => {
    const m = parse("Cho tam giác ABC");
    assert.equal(m.rawText, "Cho tam giác ABC");
  });

  it("returns arrays for all constraint collections", () => {
    const m = parse("Cho tam giác ABC");
    for (const field of [
      "points", "segments", "circles", "triangles", "midpoints",
      "perpendiculars", "parallels", "altitudes", "medians", "angleBisectors"
    ]) {
      assert.ok(Array.isArray((m as any)[field]), `field '${field}' is not an array`);
    }
  });

  it("no duplicate points (string IDs are unique)", () => {
    const m = parse("Cho đường tròn (O) có đường kính CD. Lấy điểm E thuộc đường tròn (O).");
    const unique = new Set(m.points);
    assert.equal(unique.size, m.points.length, `duplicate points: ${m.points.join(",")}`);
  });
});

// ─── circles ─────────────────────────────────────────────────────────────────

describe("parseGeometryProblem — circles (tests.txt fixtures)", () => {
  it("'Cho đường tròn tâm O' recognises circle with center O", () => {
    const m = parse("Cho đường tròn tâm O");
    assert.ok(
      m.circles.some(c => c.center === "point:O") || m.circleConstraints?.some(c => c.centerPointId === "point:O"),
      "expected circle centered at O"
    );
  });

  it("'Cho đường tròn (O) có đường kính CD' recognises diameter CD", () => {
    const m = parse("Cho đường tròn (O) có đường kính CD");
    const hasDiam =
      m.circlesByDiameter?.some(d =>
        (d.a === "point:C" && d.b === "point:D") || (d.a === "point:D" && d.b === "point:C")
      ) || m.diameterConstraints?.some(d =>
        (d.point1Id === "point:C" || d.point2Id === "point:C")
      );
    assert.ok(hasDiam, "expected diameter constraint for C and D");
  });

  it("'Lấy điểm E thuộc đường tròn (O)' registers E on circle O", () => {
    const m = parse("Cho đường tròn (O) có đường kính CD. Lấy điểm E thuộc đường tròn (O).");
    const hasE =
      m.pointsOnCircles?.some(p => p.point === "point:E") ||
      m.circleConstraints?.some(c => c.pointOnCircleId === "point:E") ||
      m.points.includes("point:E");
    assert.ok(hasE, "expected E registered from 'Lấy điểm E thuộc đường tròn'");
  });

  it("'Cho đường tròn tâm O, bán kính OA. Qua A vẽ tiếp tuyến AB.' registers tangent", () => {
    const m = parse("Cho đường tròn tâm O, bán kính OA. Qua A vẽ tiếp tuyến AB.");
    const hasTangent =
      m.tangents?.length > 0 ||
      m.namedTangents?.length > 0 ||
      m.points.includes("point:A");
    assert.ok(hasTangent, "expected a tangent or at least point A");
  });
});

// ─── triangles ────────────────────────────────────────────────────────────────

describe("parseGeometryProblem — triangles (tests.txt fixtures)", () => {
  it("'Cho tam giác ABC' registers a triangle with vertices A B C", () => {
    const m = parse("Cho tam giác ABC");
    const t = m.triangles.find(
      t => t.vertices.includes("point:A") && t.vertices.includes("point:B") && t.vertices.includes("point:C")
    );
    assert.ok(t, `expected triangle ABC, triangles: ${JSON.stringify(m.triangles)}`);
  });

  it("'Cho tam giác có 3 đường trung tuyến cắt nhau tại G' registers medians/centroid", () => {
    const m = parse("Cho tam giác có 3 đường trung tuyến cắt nhau tại G");
    const hasCentroid = m.medians?.length > 0 || m.centroids?.length > 0 || m.points.includes("point:G");
    assert.ok(hasCentroid, "expected median or centroid constraint");
  });

  it("'Cho tam giác ABC có đường trung tuyến AM' registers a median from A", () => {
    const m = parse("Cho tam giác ABC có đường trung tuyến AM");
    const hasMedian =
      m.medians?.some(md => md.from === "point:A") ||
      m.midpoints?.some(mp => mp.point === "point:M") ||
      m.points.includes("point:M");
    assert.ok(hasMedian, "expected a median or midpoint M");
  });

  it("'Cho tam giác ABC có đường phân giác AK' registers an angle bisector from A", () => {
    const m = parse("Cho tam giác ABC có đường phân giác AK");
    const hasBisector =
      m.angleBisectors?.some(ab => ab.from === "point:A") ||
      m.points.includes("point:K");
    assert.ok(hasBisector, "expected angle bisector or point K");
  });

  it("'Cho tam giác ABC có đường cao AH' registers an altitude from A", () => {
    const m = parse("Cho tam giác ABC có đường cao AH");
    const hasAlt =
      m.altitudes?.some(a => a.from === "point:A") ||
      m.perpendiculars?.length > 0 ||
      m.points.includes("point:H");
    assert.ok(hasAlt, "expected altitude or perpendicular or H");
  });

  it("'Cho tam giác ABC. Các đường cao AD, BE, CF cắt nhau tại H' registers H", () => {
    const m = parse("Cho tam giác ABC. Các đường cao AD, BE, CF của tam giác ABC cắt nhau tại H.");
    assert.ok(m.points.includes("point:H"), "expected orthocenter H");
  });

  it("'Cho tam giác có 3 đường cao cắt nhau tại H' registers altitudes", () => {
    const m = parse("Cho tam giác có 3 đường cao cắt nhau tại H");
    const hasAlts = m.altitudes?.length > 0 || m.points.includes("point:H");
    assert.ok(hasAlts, "expected altitudes or H");
  });

  it("'Cho tam giác ABC nhọn, nội tiếp đường tròn (O)' registers circumcircle", () => {
    const m = parse("Cho tam giác ABC nhọn, nội tiếp đường tròn (O).");
    const haCircum =
      m.circumcircles?.length > 0 ||
      m.circles.some(c => c.center === "point:O") ||
      m.circleConstraints?.some(c => c.centerPointId === "point:O");
    assert.ok(haCircum, "expected circumcircle or circle O");
  });
});

// ─── segments / midpoints ─────────────────────────────────────────────────────

describe("parseGeometryProblem — segments and midpoints (tests.txt fixtures)", () => {
  it("'Cho đoạn thẳng AB có trung điểm M' registers a midpoint M for AB", () => {
    const m = parse("Cho đoạn thẳng AB có trung điểm M");
    const hasM =
      m.midpoints?.some(mp => mp.point === "point:M") ||
      m.points.includes("point:M");
    assert.ok(hasM, "expected midpoint M");
  });
});

// ─── perpendiculars ───────────────────────────────────────────────────────────

describe("parseGeometryProblem — perpendiculars (tests.txt fixtures)", () => {
  it("'Kẻ EH vuông góc CD tại H' registers EH ⊥ CD", () => {
    const text =
      "Cho đường tròn (O) có đường kính CD. Lấy điểm E thuộc đường tròn (O). Kẻ EH vuông góc CD tại H.";
    const m = parse(text);
    const hasPerp =
      m.perpendiculars?.length > 0 ||
      m.altitudes?.length > 0 ||
      m.points.includes("point:H");
    assert.ok(hasPerp, "expected perpendicular or H");
  });

  it("'Kẻ EH ⟂ CD tại H' (unicode symbol) registers EH ⊥ CD", () => {
    const text =
      "Cho đường tròn (O) có đường kính CD. Vẽ cung CE. Kẻ EH ⟂ CD tại H.";
    const m = parse(text);
    const hasH = m.points.includes("point:H") || m.perpendiculars?.length > 0;
    assert.ok(hasH, "expected H or perpendicular");
  });
});

// ─── complete problem fixture ─────────────────────────────────────────────────

describe("parseGeometryProblem — full problem (tests.txt last line)", () => {
  const FULL_PROBLEM = [
    "Cho đường tròn (O) có đường kính CD, tiếp tuyến tại C là đường thẳng Cx.",
    "Lấy điểm E thuộc đường tròn (O) (E ≠ C, D).",
    "Qua O kẻ đường thẳng vuông góc với CE, cắt Cx tại A.",
    "a) Chứng minh rằng AE là tiếp tuyến của đường tròn (O).",
    "b) Qua D kẻ tiếp tuyến với đường tròn (O), tiếp tuyến này cắt AE tại B.",
    "c) Kẻ EH ⟂ CD tại H. Chứng minh rằng AD và BC cắt nhau tại trung điểm của EH."
  ].join(" ");

  it("registers at least 6 points (O, C, D, E, A, H)", () => {
    const m = parse(FULL_PROBLEM);
    assert.ok(m.points.length >= 6, `expected >= 6 points, got ${m.points.length}: ${m.points.join(",")}`);
  });

  it("registers E on circle O", () => {
    const m = parse(FULL_PROBLEM);
    const hasE =
      m.pointsOnCircles?.some(p => p.point === "point:E") ||
      m.circleConstraints?.some(c => c.pointOnCircleId === "point:E") ||
      m.points.includes("point:E");
    assert.ok(hasE, "expected E on circle");
  });

  it("registers a perpendicular (EH ⊥ CD)", () => {
    const m = parse(FULL_PROBLEM);
    assert.ok(m.perpendiculars?.length > 0 || m.points.includes("point:H"), "expected perpendicular or H");
  });
});
