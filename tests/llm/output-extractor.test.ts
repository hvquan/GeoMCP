/**
 * Tests for Layer 4: src/ai/output-extractor.ts
 *
 * extractJsonObject strips LLM response noise and returns the first JSON object.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "../../src/llm/output-extractor.js";

describe("extractJsonObject — layer 4", () => {

  describe("bare JSON", () => {
    it("parses a bare JSON object string", () => {
      const result = extractJsonObject('{"objects":[],"constraints":[]}');
      assert.deepEqual(result, { objects: [], constraints: [] });
    });

    it("parses a JSON object with leading/trailing whitespace", () => {
      const result = extractJsonObject('  { "a": 1 }  ');
      assert.deepEqual(result, { a: 1 });
    });
  });

  describe("markdown fences", () => {
    it("extracts JSON from ```json ... ``` fence", () => {
      const text = '```json\n{"objects":[]}\n```';
      const result = extractJsonObject(text);
      assert.deepEqual(result, { objects: [] });
    });

    it("extracts JSON from ``` ... ``` fence (no language tag)", () => {
      const text = '```\n{"constraints":[]}\n```';
      const result = extractJsonObject(text);
      assert.deepEqual(result, { constraints: [] });
    });

    it("extracts JSON preceded by explanatory prose", () => {
      const text = 'Here is the geometry:\n{"objects":[{"type":"point","name":"A"}]}';
      const result = extractJsonObject(text) as any;
      assert.equal(result.objects[0].name, "A");
    });
  });

  describe("nested objects", () => {
    it("handles nested object values", () => {
      const text = '{"circle":{"center":"O","radius":5}}';
      const result = extractJsonObject(text) as any;
      assert.equal(result.circle.radius, 5);
    });

    it("handles arrays of objects", () => {
      const text = '{"objects":[{"type":"point","name":"A"},{"type":"point","name":"B"}]}';
      const result = extractJsonObject(text) as any;
      assert.equal(result.objects.length, 2);
    });
  });

  describe("error cases", () => {
    it("throws when input has no JSON object", () => {
      assert.throws(() => extractJsonObject("just text, no braces"), /JSON/);
    });

    it("throws when input is empty string", () => {
      assert.throws(() => extractJsonObject(""));
    });

    it("throws when braces are present but content is invalid JSON", () => {
      assert.throws(() => extractJsonObject("{unquoted: value}"));
    });
  });
});
