/**
 * Unit tests for src/ai/repair.ts — Layer 5 structural repair.
 *
 * Run with:  npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairDslJson, buildRepairPrompt } from "../../src/llm/repair.js";

// ─── repairDslJson ──────────────────────────────────────────────────────────

describe("repairDslJson", () => {
  describe("non-object inputs", () => {
    it("returns ok:false for null", () => {
      const r = repairDslJson(null);
      assert.equal(r.ok, false);
    });

    it("returns ok:false for an array", () => {
      const r = repairDslJson([]);
      assert.equal(r.ok, false);
    });

    it("returns ok:false for a string", () => {
      const r = repairDslJson("hello");
      assert.equal(r.ok, false);
    });
  });

  describe("strategy 1: unwrap outer wrapper", () => {
    const WRAPPERS = ["result", "geometry", "output", "dsl", "response", "data"];

    for (const key of WRAPPERS) {
      it(`unwraps { "${key}": { ... } }`, () => {
        const inner = { objects: [], constraints: [] };
        const r = repairDslJson({ [key]: inner });
        assert.equal(r.ok, true);
        if (r.ok) {
          assert.ok(r.strategies.includes(`unwrap:${key}`));
          assert.deepEqual((r.repaired as any).objects, []);
        }
      });
    }

    it("does NOT unwrap when there are multiple top-level keys", () => {
      const r = repairDslJson({ result: {}, extra: "foo" });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.ok(!r.strategies.some(s => s.startsWith("unwrap:")));
      }
    });
  });

  describe("strategy 2: objects as map → array", () => {
    it("converts a plain-object objects map with string values", () => {
      const raw = {
        objects: { A: "point", B: "point" },
        constraints: []
      };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        const objs = (r.repaired as any).objects as unknown[];
        assert.equal(objs.length, 2);
        assert.ok(r.strategies.includes("objects:map-to-array"));
      }
    });

    it("converts a map with object values", () => {
      const raw = {
        objects: { O: { type: "circle", center: "O" } },
        constraints: []
      };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        const objs = (r.repaired as any).objects as any[];
        assert.equal(objs[0].name, "O");
        assert.equal(objs[0].center, "O");
      }
    });

    it("falls back to empty array for a non-object, non-array objects value", () => {
      const raw = { objects: 42, constraints: [] };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.deepEqual((r.repaired as any).objects, []);
        assert.ok(r.strategies.includes("objects:default-empty"));
      }
    });
  });

  describe("strategy 3: constraints default empty", () => {
    it("adds constraints:[] when missing", () => {
      const raw = { objects: [] };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.deepEqual((r.repaired as any).constraints, []);
        assert.ok(r.strategies.includes("constraints:default-empty"));
      }
    });

    it("does not overwrite existing constraints array", () => {
      const raw = { objects: [], constraints: [{ type: "collinear", points: ["A", "B"] }] };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal((r.repaired as any).constraints.length, 1);
        assert.ok(!r.strategies.includes("constraints:default-empty"));
      }
    });
  });

  describe("strategy 4: string-typed numbers", () => {
    it('converts "radius":"5" to radius:5', () => {
      const raw = {
        objects: [{ type: "circle", name: "O", radius: "5" }],
        constraints: []
      };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        const circle = (r.repaired as any).objects[0];
        assert.equal(circle.radius, 5);
        assert.ok(r.strategies.includes("radius:string-to-number"));
      }
    });

    it("leaves numeric radius unchanged", () => {
      const raw = { objects: [{ type: "circle", name: "O", radius: 5 }], constraints: [] };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal((r.repaired as any).objects[0].radius, 5);
        assert.ok(!r.strategies.some(s => s.startsWith("radius:")));
      }
    });
  });

  describe("strategy 5: uppercase point names", () => {
    it("uppercases lowercase point name", () => {
      const raw = {
        objects: [{ type: "point", name: "a" }],
        constraints: []
      };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal((r.repaired as any).objects[0].name, "A");
        assert.ok(r.strategies.some(s => s.startsWith("point-name:uppercase:")));
      }
    });

    it("leaves already-uppercase point name unchanged", () => {
      const raw = { objects: [{ type: "point", name: "A" }], constraints: [] };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal((r.repaired as any).objects[0].name, "A");
        assert.ok(!r.strategies.some(s => s.startsWith("point-name:uppercase:")));
      }
    });

    it("does not affect non-point objects", () => {
      const raw = {
        objects: [{ type: "circle", name: "o", center: "o" }],
        constraints: []
      };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        // circle name is not renamed by strategy 5
        assert.equal((r.repaired as any).objects[0].name, "o");
      }
    });
  });

  describe("strategy 6: missing objects key", () => {
    it("adds objects:[] when key is entirely absent", () => {
      const raw = { constraints: [] };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.deepEqual((r.repaired as any).objects, []);
        assert.ok(r.strategies.includes("objects:missing-default-empty"));
      }
    });
  });

  describe("combined repairs", () => {
    it("applies multiple strategies in one pass", () => {
      const raw = {
        objects: [
          { type: "point", name: "a" },
          { type: "circle", name: "O", radius: "3" }
        ]
        // no constraints key
      };
      const r = repairDslJson(raw);
      assert.equal(r.ok, true);
      if (r.ok) {
        const repaired = r.repaired as any;
        assert.equal(repaired.objects[0].name, "A");      // strategy 5
        assert.equal(repaired.objects[1].radius, 3);       // strategy 4
        assert.deepEqual(repaired.constraints, []);          // strategy 3
        assert.equal(r.strategies.length >= 3, true);
      }
    });
  });
});

// ─── buildRepairPrompt ──────────────────────────────────────────────────────

describe("buildRepairPrompt", () => {
  it("includes the validation error in the output", () => {
    const prompt = buildRepairPrompt('{"objects":[]}', "constraints field is required");
    assert.ok(prompt.includes("constraints field is required"));
  });

  it("includes the raw response (truncated to 3000 chars)", () => {
    const longRaw = "x".repeat(5000);
    const prompt = buildRepairPrompt(longRaw, "error");
    assert.ok(!prompt.includes("x".repeat(3001)));
    assert.ok(prompt.includes("x".repeat(100)));
  });

  it("returns a non-empty string", () => {
    assert.ok(buildRepairPrompt("{}", "err").length > 0);
  });
});
