/**
 * Integration tests for src/pipeline/index.ts
 *
 * These tests use the heuristic parser only (no LLM calls) by triggering
 * the fallback path.  They verify the full pipeline end-to-end:
 *   parseGeometryProblem → buildLayout → [refineLayoutWithSolver] → renderSvg
 *
 * Run with:  npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runGeometryPipeline } from "../../src/pipeline/index.js";

/**
 * Force the heuristic path: set fallbackToHeuristic:true and pass a bogus
 * model that will fail immediately (no real HTTP call made since there's no
 * API key in the test environment — the callLlm guard throws before the
 * network request).
 */
const HEURISTIC_OPTS = {
  fallbackToHeuristic: true,
  useConstraintSolver: false,   // skip solver to keep tests fast
  model: "__test_no_llm__"
} as const;

/**
 * Problem text the v1 heuristic parser recognises and produces several points.
 * The circle-diameter problem reliably yields 7 declared points.
 */
const HEURISTIC_PROBLEM =
  "Given circle (O) with diameter CD, the tangent at C is line Cx. " +
  "Let E be a point on circle (O). " +
  "Through O draw a line perpendicular to CE, intersecting Cx at A. " +
  "Draw EH perpendicular to CD at H.";

// ─── result shape ──────────────────────────────────────────────────────────

describe("runGeometryPipeline — result shape", () => {
  it("returns the expected top-level keys", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.ok("parserVersion" in result, "missing parserVersion");
    assert.ok("warnings" in result, "missing warnings");
    assert.ok("parsed" in result, "missing parsed");
    assert.ok("layout" in result, "missing layout");
    assert.ok("svg" in result, "missing svg");
  });

  it("parserVersion is v3-dsl-fallback-v1 in heuristic path", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.equal(result.parserVersion, "v3-dsl-fallback-v1");
  });

  it("warnings array is non-empty in heuristic fallback", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.ok(Array.isArray(result.warnings));
    assert.ok(result.warnings.length > 0);
  });

  it("canonical is undefined in heuristic fallback", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.equal(result.canonical, undefined);
  });
});

// ─── SVG output ────────────────────────────────────────────────────────────

describe("runGeometryPipeline — SVG output", () => {
  it("svg contains <svg element", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    // Some renderers emit an XML declaration before <svg; accept both
    assert.ok(result.svg.includes("<svg"), `svg has no <svg element: ${result.svg.slice(0, 120)}`);
  });

  it("svg is a non-empty string", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.ok(typeof result.svg === "string" && result.svg.length > 0);
  });
});

// ─── parsed model ──────────────────────────────────────────────────────────

describe("runGeometryPipeline — parsed model", () => {
  it("returns a GeometryModel with a points array", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.ok(result.parsed, "parsed is falsy");
    // GeometryModel.points is string[] (point IDs)
    assert.ok(Array.isArray(result.parsed.points), "parsed.points is not an array");
  });

  it("circle-diameter problem yields several point IDs", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.ok(
      result.parsed.points.length >= 3,
      `expected >= 3 point IDs, got ${result.parsed.points.length}`
    );
    // Points are strings (IDs like "point:O", "point:C", …)
    for (const p of result.parsed.points) {
      assert.equal(typeof p, "string", `point entry is not a string: ${JSON.stringify(p)}`);
    }
  });
});

// ─── layout ────────────────────────────────────────────────────────────────

describe("runGeometryPipeline — layout", () => {
  it("layout.points is an array", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    assert.ok(result.layout, "layout is falsy");
    assert.ok(Array.isArray(result.layout.points), "layout.points is not an array");
  });

  it("layout points have finite numeric x,y coordinates", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, HEURISTIC_OPTS);
    for (const pt of result.layout.points) {
      // LayoutModel.points is Point[] — {id, x, y}
      const { id, x, y } = pt;
      assert.ok(typeof x === "number", `point ${id}.x is not a number`);
      assert.ok(typeof y === "number", `point ${id}.y is not a number`);
      assert.ok(isFinite(x), `point ${id}.x is not finite`);
      assert.ok(isFinite(y), `point ${id}.y is not finite`);
    }
  });
});

// ─── solverIterations clamping ─────────────────────────────────────────────

describe("runGeometryPipeline — options", () => {
  it("completes with solverIterations below minimum (clamped to 40)", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, {
      ...HEURISTIC_OPTS,
      useConstraintSolver: true,
      solverIterations: 1
    });
    assert.ok(result.svg.length > 0);
  });

  it("completes with solverIterations above maximum (clamped to 2000)", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, {
      ...HEURISTIC_OPTS,
      useConstraintSolver: true,
      solverIterations: 5000
    });
    assert.ok(result.svg.length > 0);
  });

  it("useConstraintSolver:false skips refinement but still returns svg", async () => {
    const result = await runGeometryPipeline(HEURISTIC_PROBLEM, {
      ...HEURISTIC_OPTS,
      useConstraintSolver: false
    });
    assert.ok(result.svg.length > 0);
  });

  it("throws when fallbackToHeuristic:false and LLM unavailable", async () => {
    await assert.rejects(
      () => runGeometryPipeline(HEURISTIC_PROBLEM, {
        fallbackToHeuristic: false,
        useConstraintSolver: false,
        model: "__test_no_llm__"
      }),
      "expected rejection when LLM unavailable and no fallback"
    );
  });
});
