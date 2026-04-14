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
    description: "VI: altitude + median + angle bisector from different vertices",
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
    description: "EN: circle + diameter + tangent + perpendicular + intersection + midpoint target",
    language: "en",
    topics: ["circle", "diameter", "tangent", "perpendicular", "intersection", "point_on_circle", "midpoint"],
    input:
      "Given circle (O) with diameter CD, the tangent at C is line Cx. Take point E on circle (O) (E \u2260 C, D). Through O draw a line perpendicular to CE, meeting Cx at A. a) Prove that AE is a tangent to circle (O). b) Through D draw a tangent to circle (O); this tangent meets AE at B. Prove that: AC + BD = AB and that triangle AOB is right-angled at O. c) Draw EH \u22a5 CD at H. Prove that AD and BC meet at the midpoint of EH.",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"point","name":"E"},{"type":"point","name":"A"},{"type":"point","name":"B"},{"type":"point","name":"H"},{"type":"point","name":"N"},{"type":"line","name":"Cx"},{"type":"line","name":"Dt"},{"type":"segment","points":["C","D"]},{"type":"segment","points":["A","E"]},{"type":"segment","points":["A","D"]},{"type":"segment","points":["B","C"]},{"type":"segment","points":["E","H"]}],"constraints":[{"type":"diameter","circle":"O","points":["C","D"]},{"type":"tangent","at":"C","line":"Cx","circle":"O"},{"type":"on_circle","point":"E","circle":"O"},{"type":"tangent","at":"D","line":"Dt","circle":"O"},{"type":"perpendicular","line1":"EH","line2":"CD"},{"type":"intersection","point":"H","of":["EH","CD"]}],"constructions":[{"type":"intersection","point":"A","of":["l1","Cx"]},{"type":"intersection","point":"B","of":["Dt","AE"]},{"type":"intersection","point":"N","of":["AD","BC"]}],"targets":[{"type":"tangent","line":"AE","circle":"O"},{"type":"statement","text":"AC + BD = AB"},{"type":"right_angle","triangle":"AOB"},{"type":"midpoint","point":"N","segment":["E","H"]}]}',
  },
  {
    description: "EN: inscribed triangle + diameter",
    language: "en",
    topics: ["circle", "inscribed", "diameter"],
    input:
      "Acute triangle ABC is inscribed in circle (O). Let K be the point such that AK is a diameter of (O).",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"K"},{"type":"segment","points":["A","K"]}],"constraints":[{"type":"on_circle","point":"A","circle":"O"},{"type":"on_circle","point":"B","circle":"O"},{"type":"on_circle","point":"C","circle":"O"},{"type":"diameter","circle":"O","points":["A","K"]}],"constructions":[],"targets":[]}',
  },
  {
    description: "EN: altitude + median + angle bisector from different vertices",
    language: "en",
    topics: ["triangle", "median", "altitude", "angle_bisector"],
    input:
      "Triangle ABC has altitude AH, median BM, and angle bisector CK.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"H"},{"type":"point","name":"M"},{"type":"point","name":"K"},{"type":"segment","points":["A","H"]},{"type":"segment","points":["B","M"]},{"type":"segment","points":["C","K"]}],"constraints":[{"type":"perpendicular","line1":"AH","line2":"BC"},{"type":"intersection","point":"H","of":["AH","BC"]},{"type":"midpoint","point":"M","of":["A","C"]},{"type":"equal_angle","angles":[["A","C","K"],["K","C","B"]]},{"type":"intersection","point":"K","of":["CK","AB"]}],"constructions":[],"targets":[]}',
  },
  {
    description: "EN: incenter — 3 angle bisectors meeting at K",
    language: "en",
    topics: ["triangle", "incenter", "intersection"],
    input:
      "Triangle ABC has three angle bisectors meeting at point K.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"K"}],"constraints":[{"type":"equal_angle","angles":[["B","A","K"],["K","A","C"]]},{"type":"equal_angle","angles":[["A","B","K"],["K","B","C"]]},{"type":"equal_angle","angles":[["A","C","K"],["K","C","B"]]},{"type":"intersection","point":"K","of":["AK","BK","CK"]}],"constructions":[],"targets":[]}',
  },

  // ─── Swedish examples ─────────────────────────────────────────────────────
  {
    description: "SV: circle + diameter + tangent + perpendicular + intersection + midpoint target",
    language: "sv",
    topics: ["circle", "diameter", "tangent", "perpendicular", "intersection", "point_on_circle", "midpoint"],
    input:
      "Givet cirkeln (O) med diametern CD, tangenten vid C \u00e4r linjen Cx. Tag punkten E p\u00e5 cirkeln (O) (E \u2260 C, D). Genom O dra en linje vinkelr\u00e4t mot CE som sk\u00e4r Cx vid A. a) Bevisa att AE \u00e4r en tangent till cirkeln (O). b) Genom D dra en tangent till cirkeln (O); denna tangent sk\u00e4r AE vid B. Bevisa att: AC + BD = AB och att triangeln AOB \u00e4r r\u00e4tvinklig vid O. c) Dra EH \u22a5 CD vid H. Bevisa att AD och BC sk\u00e4r varandra i mittpunkten av EH.",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"point","name":"E"},{"type":"point","name":"A"},{"type":"point","name":"B"},{"type":"point","name":"H"},{"type":"point","name":"N"},{"type":"line","name":"Cx"},{"type":"line","name":"Dt"},{"type":"segment","points":["C","D"]},{"type":"segment","points":["A","E"]},{"type":"segment","points":["A","D"]},{"type":"segment","points":["B","C"]},{"type":"segment","points":["E","H"]}],"constraints":[{"type":"diameter","circle":"O","points":["C","D"]},{"type":"tangent","at":"C","line":"Cx","circle":"O"},{"type":"on_circle","point":"E","circle":"O"},{"type":"tangent","at":"D","line":"Dt","circle":"O"},{"type":"perpendicular","line1":"EH","line2":"CD"},{"type":"intersection","point":"H","of":["EH","CD"]}],"constructions":[{"type":"intersection","point":"A","of":["l1","Cx"]},{"type":"intersection","point":"B","of":["Dt","AE"]},{"type":"intersection","point":"N","of":["AD","BC"]}],"targets":[{"type":"tangent","line":"AE","circle":"O"},{"type":"statement","text":"AC + BD = AB"},{"type":"right_angle","triangle":"AOB"},{"type":"midpoint","point":"N","segment":["E","H"]}]}',
  },
  {
    description: "SV: inscribed triangle + diameter",
    language: "sv",
    topics: ["circle", "inscribed", "diameter"],
    input:
      "Spetsvinklig triangel ABC \u00e4r inskriven i cirkeln (O). L\u00e5t K vara punkten s\u00e5 att AK \u00e4r en diameter i (O).",
    output:
      '{"objects":[{"type":"circle","center":"O"},{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"K"},{"type":"segment","points":["A","K"]}],"constraints":[{"type":"on_circle","point":"A","circle":"O"},{"type":"on_circle","point":"B","circle":"O"},{"type":"on_circle","point":"C","circle":"O"},{"type":"diameter","circle":"O","points":["A","K"]}],"constructions":[],"targets":[]}',
  },
  {
    description: "SV: altitude + median + angle bisector from different vertices",
    language: "sv",
    topics: ["triangle", "median", "altitude", "angle_bisector"],
    input:
      "Triangeln ABC har h\u00f6jden AH, medianen BM och vinkelbisektorn CK.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"H"},{"type":"point","name":"M"},{"type":"point","name":"K"},{"type":"segment","points":["A","H"]},{"type":"segment","points":["B","M"]},{"type":"segment","points":["C","K"]}],"constraints":[{"type":"perpendicular","line1":"AH","line2":"BC"},{"type":"intersection","point":"H","of":["AH","BC"]},{"type":"midpoint","point":"M","of":["A","C"]},{"type":"equal_angle","angles":[["A","C","K"],["K","C","B"]]},{"type":"intersection","point":"K","of":["CK","AB"]}],"constructions":[],"targets":[]}',
  },
  {
    description: "SV: incenter — 3 angle bisectors meeting at K",
    language: "sv",
    topics: ["triangle", "incenter", "intersection"],
    input:
      "Triangeln ABC har tre vinkelbisektorer som sk\u00e4r varandra i punkten K.",
    output:
      '{"objects":[{"type":"triangle","points":["A","B","C"]},{"type":"point","name":"K"}],"constraints":[{"type":"equal_angle","angles":[["B","A","K"],["K","A","C"]]},{"type":"equal_angle","angles":[["A","B","K"],["K","B","C"]]},{"type":"equal_angle","angles":[["A","C","K"],["K","C","B"]]},{"type":"intersection","point":"K","of":["AK","BK","CK"]}],"constructions":[],"targets":[]}',
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
