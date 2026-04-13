/**
 * Tests for src/language/ — language detection, phrase normalization,
 * few-shot selection, and pipeline integration.
 *
 * All tests run without LLM calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectLanguage } from "../../src/language/detect.js";
import { detectCanonicalPhrases } from "../../src/language/normalize-phrases.js";
import { selectFewShots } from "../../src/language/fewshot-selector.js";
import { detectAndNormalize } from "../../src/language/index.js";
import { GEOMETRY_TERM_LEXICON } from "../../src/language/term-lexicon.js";

// ─── Language detection ────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("detects Vietnamese from diacritics", () => {
    assert.equal(detectLanguage("Cho đường tròn (O) có đường kính CD"), "vi");
  });

  it("detects Vietnamese — ắ", () => {
    assert.equal(detectLanguage("điểm E nằm trên đường tròn"), "vi");
  });

  it("detects Swedish from å", () => {
    assert.equal(detectLanguage("Cirkel O har diameter AB. Punkt E ligger på cirkeln."), "sv");
  });

  it("detects Swedish from ä", () => {
    assert.equal(detectLanguage("Triangeln är vinkelrät mot sidan."), "sv");
  });

  it("detects Swedish from ö", () => {
    assert.equal(detectLanguage("Dra höjden från A"), "sv");
  });

  it("defaults to English", () => {
    assert.equal(detectLanguage("Circle O has diameter AB."), "en");
  });

  it("empty string defaults to English", () => {
    assert.equal(detectLanguage(""), "en");
  });

  it("pure ASCII geometry defaults to English", () => {
    assert.equal(detectLanguage("Triangle ABC inscribed in circle O."), "en");
  });
});

// ─── Phrase normalization ──────────────────────────────────────────────────

describe("detectCanonicalPhrases — Vietnamese", () => {
  it("detects point_on_circle from 'thuộc đường tròn'", () => {
    const phrases = detectCanonicalPhrases("E thuộc đường tròn (O)", "vi");
    assert.ok(phrases.some(p => p.type === "point_on_circle"));
  });

  it("detects point_on_circle from 'nằm trên đường tròn'", () => {
    const phrases = detectCanonicalPhrases("Điểm E nằm trên đường tròn (O)", "vi");
    assert.ok(phrases.some(p => p.type === "point_on_circle"));
  });

  it("detects tangent", () => {
    const phrases = detectCanonicalPhrases("tiếp tuyến tại C là Cx", "vi");
    assert.ok(phrases.some(p => p.type === "tangent"));
  });

  it("detects diameter", () => {
    const phrases = detectCanonicalPhrases("đường kính CD của (O)", "vi");
    assert.ok(phrases.some(p => p.type === "diameter"));
  });

  it("detects perpendicular", () => {
    const phrases = detectCanonicalPhrases("Kẻ EH vuông góc CD tại H", "vi");
    assert.ok(phrases.some(p => p.type === "perpendicular"));
  });

  it("detects inscribed", () => {
    const phrases = detectCanonicalPhrases("tam giác ABC nội tiếp đường tròn (O)", "vi");
    assert.ok(phrases.some(p => p.type === "inscribed"));
  });

  it("returns language field on each phrase", () => {
    const phrases = detectCanonicalPhrases("tiếp tuyến tại A", "vi");
    assert.ok(phrases.every(p => p.language === "vi"));
  });

  it("deduplicates repeated phrase types", () => {
    const phrases = detectCanonicalPhrases("tiếp tuyến tại C, tiếp tuyến tại D", "vi");
    const tangents = phrases.filter(p => p.type === "tangent");
    assert.equal(tangents.length, 1);
  });
});

describe("detectCanonicalPhrases — English", () => {
  it("detects point_on_circle", () => {
    const phrases = detectCanonicalPhrases("Point E lies on the circle.", "en");
    assert.ok(phrases.some(p => p.type === "point_on_circle"));
  });

  it("detects tangent", () => {
    const phrases = detectCanonicalPhrases("Draw the tangent at point A.", "en");
    assert.ok(phrases.some(p => p.type === "tangent"));
  });

  it("detects perpendicular", () => {
    const phrases = detectCanonicalPhrases("Draw EH perpendicular to CD.", "en");
    assert.ok(phrases.some(p => p.type === "perpendicular"));
  });

  it("detects inscribed", () => {
    const phrases = detectCanonicalPhrases("Triangle ABC inscribed in circle O.", "en");
    assert.ok(phrases.some(p => p.type === "inscribed"));
  });

  it("detects midpoint", () => {
    const phrases = detectCanonicalPhrases("M is the midpoint of BC.", "en");
    assert.ok(phrases.some(p => p.type === "midpoint"));
  });
});

describe("detectCanonicalPhrases — Swedish", () => {
  it("detects point_on_circle", () => {
    const phrases = detectCanonicalPhrases("Punkt E ligger på cirkeln.", "sv");
    assert.ok(phrases.some(p => p.type === "point_on_circle"));
  });

  it("detects tangent", () => {
    const phrases = detectCanonicalPhrases("Tangenten vid A är linjen At.", "sv");
    assert.ok(phrases.some(p => p.type === "tangent"));
  });

  it("detects perpendicular", () => {
    const phrases = detectCanonicalPhrases("Dra AH vinkelrät mot BC.", "sv");
    assert.ok(phrases.some(p => p.type === "perpendicular"));
  });

  it("detects midpoint", () => {
    const phrases = detectCanonicalPhrases("M är mittpunkten på BC.", "sv");
    assert.ok(phrases.some(p => p.type === "midpoint"));
  });
});

// ─── Few-shot selection ────────────────────────────────────────────────────

describe("selectFewShots", () => {
  it("returns at most 3 examples", () => {
    const examples = selectFewShots("vi", []);
    assert.ok(examples.length <= 3);
  });

  it("returns at least 1 example", () => {
    const examples = selectFewShots("vi", []);
    assert.ok(examples.length >= 1);
  });

  it("prefers same-language examples for Vietnamese", () => {
    const examples = selectFewShots("vi", []);
    assert.ok(examples[0].language === "vi");
  });

  it("prefers same-language examples for English", () => {
    const examples = selectFewShots("en", []);
    assert.ok(examples[0].language === "en");
  });

  it("prefers same-language examples for Swedish", () => {
    const examples = selectFewShots("sv", []);
    assert.ok(examples[0].language === "sv");
  });

  it("scores examples with matched topics higher (VI + tangent)", () => {
    const phrases = [{ type: "tangent", rawText: "tiếp tuyến", language: "vi" as const }];
    const examples = selectFewShots("vi", phrases);
    // The first example should be VI and include tangent in topics
    assert.equal(examples[0].language, "vi");
    assert.ok(examples[0].topics.includes("tangent"));
  });

  it("scores examples with matched topics higher (EN + inscribed)", () => {
    const phrases = [{ type: "inscribed", rawText: "inscribed in", language: "en" as const }];
    const examples = selectFewShots("en", phrases);
    assert.equal(examples[0].language, "en");
    assert.ok(examples[0].topics.includes("inscribed") || examples[0].topics.includes("circle"));
  });
});

// ─── detectAndNormalize integration ───────────────────────────────────────

describe("detectAndNormalize", () => {
  it("returns originalText unchanged", () => {
    const text = "Circle O has diameter AB.";
    const result = detectAndNormalize(text);
    assert.equal(result.originalText, text);
  });

  it("detects Vietnamese problem correctly", () => {
    const result = detectAndNormalize("Cho đường tròn (O) có đường kính CD.");
    assert.equal(result.language, "vi");
  });

  it("detects Swedish problem correctly", () => {
    const result = detectAndNormalize("Cirkel O har diameter AB. E ligger på cirkeln.");
    assert.equal(result.language, "sv");
  });

  it("detects English problem correctly", () => {
    const result = detectAndNormalize("Circle O has diameter AB. Point E lies on the circle.");
    assert.equal(result.language, "en");
  });

  it("extracts canonical phrases for Vietnamese", () => {
    const result = detectAndNormalize(
      "Cho (O) đường kính CD, tiếp tuyến tại C là Cx, E thuộc (O)."
    );
    const phraseTypes = result.canonicalPhrases.map(p => p.type);
    assert.ok(phraseTypes.includes("diameter"));
    assert.ok(phraseTypes.includes("tangent"));
    assert.ok(phraseTypes.includes("point_on_circle"));
  });

  it("extracts canonical phrases for English", () => {
    const result = detectAndNormalize(
      "Circle O has diameter AB. Point E lies on the circle. Draw tangent at A."
    );
    const phraseTypes = result.canonicalPhrases.map(p => p.type);
    assert.ok(phraseTypes.includes("diameter"));
    assert.ok(phraseTypes.includes("point_on_circle"));
    assert.ok(phraseTypes.includes("tangent"));
  });

  it("returns empty canonicalPhrases for geometry-free text", () => {
    const result = detectAndNormalize("The quick brown fox");
    assert.equal(result.canonicalPhrases.length, 0);
  });
});

// ─── Term lexicon ─────────────────────────────────────────────────────────

describe("GEOMETRY_TERM_LEXICON", () => {
  it("is a non-empty array", () => {
    assert.ok(Array.isArray(GEOMETRY_TERM_LEXICON));
    assert.ok(GEOMETRY_TERM_LEXICON.length > 0);
  });

  it("every entry has canonical, vi, en, sv arrays", () => {
    for (const entry of GEOMETRY_TERM_LEXICON) {
      assert.ok(typeof entry.canonical === "string", `missing canonical in ${JSON.stringify(entry)}`);
      assert.ok(Array.isArray(entry.vi), `vi not array for ${entry.canonical}`);
      assert.ok(Array.isArray(entry.en), `en not array for ${entry.canonical}`);
      assert.ok(Array.isArray(entry.sv), `sv not array for ${entry.canonical}`);
    }
  });

  it("includes key geometry concepts", () => {
    const canonicals = GEOMETRY_TERM_LEXICON.map(e => e.canonical);
    for (const concept of ["circle", "tangent", "perpendicular", "diameter", "midpoint", "point_on_circle"]) {
      assert.ok(canonicals.includes(concept), `missing concept: ${concept}`);
    }
  });
});
