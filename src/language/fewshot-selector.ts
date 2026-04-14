/**
 * Few-Shot Example Selector — Layer 3
 *
 * Dynamically selects 1-3 few-shot examples for the prompt based on:
 *   1. The detected language (prefer same-language examples first)
 *   2. The canonical geometry phrase types present in the input
 *
 * Rule: max 3 examples per prompt (keep prompt compact).
 *
 * Follows the document spec:
 *   "Nếu bài là tiếng Việt về đường tròn + tiếp tuyến → chọn vi circle + vi tangent example"
 *   "Nếu bài là tiếng Thụy Điển → chọn sv perpendicular + sv intersection + canonical EN"
 */

import type { DetectedLanguage, CanonicalPhrase } from "./canonical-language.js";

export interface FewShotExample {
  /** Short description of what this example illustrates. */
  description: string;
  /** Language of the input text. */
  language: DetectedLanguage;
  /** Geometry topics covered (used for selection scoring). */
  topics: string[];
  /** The raw input string. */
  input: string;
  /** The expected JSON output string. */
  output: string;
}

/** Full few-shot example bank. */
export const FEW_SHOT_BANK: FewShotExample[] = [
  // ─── Vietnamese examples ──────────────────────────────────────────────────
  {
    description: "VI: circle + diameter + tangent + perpendicular + intersection + midpoint target",
    language: "vi",
    topics: ["circle", "diameter", "tangent", "perpendicular", "intersection", "point_on_circle", "midpoint"],
    input:
      'Cho (O) đường kính CD, tiếp tuyến tại C là Cx, E thuộc (O). Qua O kẻ đường ⊥ CE cắt Cx tại A. a) CM AE là tiếp tuyến. b) Qua D kẻ tiếp tuyến cắt AE tại B. CM AC+BD=AB và tam giác AOB vuông tại O. c) Kẻ EH ⊥ CD tại H. CM AD và BC cắt nhau tại trung điểm EH.',
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"point","name":"E"},{"type":"point","name":"A"},{"type":"point","name":"B"},{"type":"point","name":"H"},{"type":"point","name":"N"},{"type":"line","name":"Cx"},{"type":"line","name":"Dt"},{"type":"segment","points":["C","D"]},{"type":"segment","points":["A","E"]},{"type":"segment","points":["A","D"]},{"type":"segment","points":["B","C"]},{"type":"segment","points":["E","H"]}],"constraints":[{"type":"diameter","circle":"O","points":["C","D"]},{"type":"tangent","at":"C","line":"Cx","circle":"O"},{"type":"on_circle","point":"E","circle":"O"},{"type":"tangent","at":"D","line":"Dt","circle":"O"},{"type":"perpendicular","line1":"EH","line2":"CD"},{"type":"intersection","point":"H","of":["EH","CD"]}],"constructions":[{"type":"intersection","point":"A","of":["l1","Cx"]},{"type":"intersection","point":"B","of":["Dt","AE"]},{"type":"intersection","point":"N","of":["AD","BC"]}],"targets":[{"type":"tangent","line":"AE","circle":"O"},{"type":"statement","text":"AC + BD = AB"},{"type":"right_angle","triangle":"AOB"},{"type":"midpoint","point":"N","segment":["E","H"]}]}',
  },
  {
    description: "VI: inscribed triangle + diameter",
    language: "vi",
    topics: ["circle", "inscribed", "diameter"],
    input:
      "Cho tam giác ABC nhọn, nội tiếp đường tròn (O). Gọi K sao cho AK là đường kính của (O).",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"K"},{"type":"segment","points":["A","K"]}],"constraints":[{"type":"on_circle","point":"A","circle":"O"},{"type":"on_circle","point":"B","circle":"O"},{"type":"on_circle","point":"C","circle":"O"},{"type":"diameter","circle":"O","points":["A","K"]}],"constructions":[],"targets":[]}',
  },
  {
    description: "VI: altitude + median + bisector from different vertices",
    language: "vi",
    topics: ["triangle", "median", "altitude", "angle_bisector"],
    input:
      "Cho tam giác ABC có đường cao AH, đường trung tuyến BM, đường phân giác CK.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"H"},{"type":"point","name":"M"},{"type":"point","name":"K"},{"type":"segment","points":["A","H"]},{"type":"segment","points":["B","M"]},{"type":"segment","points":["C","K"]}],"constraints":[{"type":"perpendicular","line1":"AH","line2":"BC"},{"type":"intersection","point":"H","of":["AH","BC"]},{"type":"midpoint","point":"M","of":["A","C"]},{"type":"equal_angle","angles":[["A","C","K"],["K","C","B"]]},{"type":"intersection","point":"K","of":["CK","AB"]}],"constructions":[],"targets":[]}',
  },
  {
    description: "VI: incenter — 3 angle bisectors meeting at K",
    language: "vi",
    topics: ["triangle", "incenter", "intersection"],
    input:
      "Cho tam giác có 3 đường phân giác cắt nhau tại K.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"K"}],"constraints":[{"type":"equal_angle","angles":[["B","A","K"],["K","A","C"]]},{"type":"equal_angle","angles":[["A","B","K"],["K","B","C"]]},{"type":"equal_angle","angles":[["A","C","K"],["K","C","B"]]},{"type":"intersection","point":"K","of":["AK","BK","CK"]}],"constructions":[],"targets":[]}',
  },

  // ─── English examples ─────────────────────────────────────────────────────
  {
    description: "EN: circle + tangent + perpendicular + intersection",
    language: "en",
    topics: ["circle", "tangent", "perpendicular", "intersection", "point_on_circle"],
    input:
      "Circle (O) has diameter AB. Tangent at A is line At. Point E lies on the circle. Draw the perpendicular from O to AE, intersecting At at P. Show PE is tangent to the circle.",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"point","name":"E"},{"type":"point","name":"P"},{"type":"line","name":"At"}],"constraints":[{"type":"diameter","circle":"O","points":["A","B"]},{"type":"tangent","at":"A","line":"At","circle":"O"},{"type":"on_circle","point":"E","circle":"O"},{"type":"perpendicular","line1":"l1","line2":"AE"}],"constructions":[{"type":"intersection","point":"P","of":["l1","At"]}],"targets":[{"type":"tangent","line":"PE","circle":"O"}]}',
  },
  {
    description: "EN: inscribed triangle + perpendicular foot",
    language: "en",
    topics: ["circle", "inscribed", "altitude", "perpendicular"],
    input:
      "Triangle ABC is inscribed in circle (O). Draw altitude AH perpendicular to BC at H.",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"H"},{"type":"segment","points":["A","H"]}],"constraints":[{"type":"on_circle","point":"A","circle":"O"},{"type":"on_circle","point":"B","circle":"O"},{"type":"on_circle","point":"C","circle":"O"},{"type":"perpendicular","line1":"AH","line2":"BC"},{"type":"intersection","point":"H","of":["AH","BC"]}],"constructions":[],"targets":[]}',
  },
  {
    description: "EN: parallel lines + midpoint + intersection",
    language: "en",
    topics: ["parallel", "midpoint", "intersection"],
    input:
      "In triangle ABC, M is the midpoint of BC. Draw MN parallel to AB meeting AC at N.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"M"},{"type":"point","name":"N"},{"type":"segment","points":["M","N"]}],"constraints":[{"type":"midpoint","point":"M","of":["B","C"]},{"type":"parallel","line1":"MN","line2":"AB"}],"constructions":[{"type":"intersection","point":"N","of":["MN","AC"]}],"targets":[]}',
  },

  // ─── Swedish examples ─────────────────────────────────────────────────────
  {
    description: "SV: circle + tangent + perpendicular",
    language: "sv",
    topics: ["circle", "tangent", "perpendicular", "point_on_circle"],
    input:
      "Cirkel (O) har diameter AB. Tangenten vid A är linjen At. Punkt E ligger på cirkeln. Dra vinkelräten från O mot AE.",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"point","name":"E"},{"type":"line","name":"At"}],"constraints":[{"type":"diameter","circle":"O","points":["A","B"]},{"type":"tangent","at":"A","line":"At","circle":"O"},{"type":"on_circle","point":"E","circle":"O"},{"type":"perpendicular","line1":"l1","line2":"AE"}],"constructions":[],"targets":[]}',
  },
  {
    description: "SV: triangle + median + perpendicular",
    language: "sv",
    topics: ["triangle", "median", "perpendicular", "midpoint"],
    input:
      "I triangeln ABC är M mittpunkten på BC. Dra höjden AH vinkelrät mot BC.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"M"},{"type":"point","name":"H"},{"type":"segment","points":["A","H"]}],"constraints":[{"type":"midpoint","point":"M","of":["B","C"]},{"type":"perpendicular","line1":"AH","line2":"BC"},{"type":"intersection","point":"H","of":["AH","BC"]}],"constructions":[],"targets":[]}',
  },
];

/** Maximum few-shot examples to include in a single prompt. */
const MAX_EXAMPLES = 3;

/**
 * Score an example for relevance to the given language and topic set.
 */
function scoreExample(
  ex: FewShotExample,
  language: DetectedLanguage,
  phraseTypes: Set<string>
): number {
  let score = 0;
  // Language match is highest priority
  if (ex.language === language) score += 10;
  // Topic overlap
  for (const topic of ex.topics) {
    if (phraseTypes.has(topic)) score += 2;
  }
  return score;
}

/**
 * Select the best few-shot examples for the given language and canonical phrases.
 * Returns at most MAX_EXAMPLES examples.
 */
export function selectFewShots(
  language: DetectedLanguage,
  canonicalPhrases: CanonicalPhrase[]
): FewShotExample[] {
  const phraseTypes = new Set(canonicalPhrases.map((p) => p.type));

  const scored = FEW_SHOT_BANK.map((ex) => ({
    ex,
    score: scoreExample(ex, language, phraseTypes),
  })).sort((a, b) => b.score - a.score);

  // Pick the top examples, but ensure we always include at least one
  // same-language example if any exists.
  const selected: FewShotExample[] = [];
  const sameLang = scored.filter((s) => s.ex.language === language);
  const others = scored.filter((s) => s.ex.language !== language);

  // Always take the top same-language match (if any)
  if (sameLang.length > 0) selected.push(sameLang[0].ex);
  // Fill remaining slots with the highest-scoring remaining examples
  for (const { ex } of [...sameLang.slice(1), ...others]) {
    if (selected.length >= MAX_EXAMPLES) break;
    selected.push(ex);
  }

  return selected;
}

/** Format a few-shot example as two prompt lines (input: / output:). */
export function formatFewShot(ex: FewShotExample): string {
  return `Example (${ex.description}):\ninput: "${ex.input}"\noutput: ${ex.output}`;
}
