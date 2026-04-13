/**
 * Geometry Phrase Normalizer — Layer 2
 *
 * Detects canonical geometry phrases in a problem text using pattern matching.
 * This is NOT free-form translation: it maps language-specific surface forms
 * to canonical phrase types for downstream use by the prompt builder and
 * few-shot selector.
 *
 * Examples:
 *   VI "thuộc đường tròn"  →  { type: "point_on_circle", language: "vi" }
 *   EN "lies on the circle" →  { type: "point_on_circle", language: "en" }
 *   SV "ligger på cirkeln"  →  { type: "point_on_circle", language: "sv" }
 */

import type { DetectedLanguage, CanonicalPhrase } from "./canonical-language.js";

/** A phrase detection pattern for one language. */
interface PhrasePattern {
  pattern: RegExp;
  type: string;
}

/** Pattern bank keyed by language. */
const PATTERNS: Record<DetectedLanguage, PhrasePattern[]> = {
  vi: [
    { pattern: /thuộc\s+(?:đường\s+tròn|\([A-Z]\))|nằm\s+trên\s+đường\s+tròn|trên\s+đường\s+tròn/gi, type: "point_on_circle" },
    { pattern: /tiếp tuyến tại|tiếp tuyến/gi, type: "tangent" },
    { pattern: /đường kính/gi, type: "diameter" },
    { pattern: /vuông góc|⊥/gi, type: "perpendicular" },
    { pattern: /song song|∥/gi, type: "parallel" },
    { pattern: /trung điểm/gi, type: "midpoint" },
    { pattern: /giao điểm|cắt tại|cắt nhau/gi, type: "intersection" },
    { pattern: /nội tiếp đường tròn|nội tiếp/gi, type: "inscribed" },
    { pattern: /ngoại tiếp/gi, type: "circumscribed" },
    { pattern: /đường cao/gi, type: "altitude" },
    { pattern: /trung tuyến/gi, type: "median" },
    { pattern: /phân giác/gi, type: "angle_bisector" },
    { pattern: /trọng tâm/gi, type: "centroid" },
    { pattern: /trực tâm/gi, type: "orthocenter" },
  ],
  en: [
    { pattern: /lies on (the )?circle|is on (the )?circle|on (the )?circle/gi, type: "point_on_circle" },
    { pattern: /tangent (at|to|from)/gi, type: "tangent" },
    { pattern: /diameter/gi, type: "diameter" },
    { pattern: /perpendicular (to|from|through)/gi, type: "perpendicular" },
    { pattern: /parallel (to|with)/gi, type: "parallel" },
    { pattern: /midpoint/gi, type: "midpoint" },
    { pattern: /intersect(ion)? (at|of|with)|meet(s)? at/gi, type: "intersection" },
    { pattern: /inscribed in/gi, type: "inscribed" },
    { pattern: /circumscribed/gi, type: "circumscribed" },
    { pattern: /altitude|height from/gi, type: "altitude" },
    { pattern: /median/gi, type: "median" },
    { pattern: /angle bisector|bisector/gi, type: "angle_bisector" },
    { pattern: /centroid/gi, type: "centroid" },
    { pattern: /orthocenter/gi, type: "orthocenter" },
  ],
  sv: [
    { pattern: /ligger på cirkeln|på cirkeln/gi, type: "point_on_circle" },
    { pattern: /\btangente?n?\b/gi, type: "tangent" },
    { pattern: /diameter/gi, type: "diameter" },
    { pattern: /vinkelrät (mot|till)/gi, type: "perpendicular" },
    { pattern: /parallell (med|till)/gi, type: "parallel" },
    { pattern: /mittpunkt/gi, type: "midpoint" },
    { pattern: /skärningspunkt|skär (med|vid)|möts/gi, type: "intersection" },
    { pattern: /inskriven i/gi, type: "inscribed" },
    { pattern: /omskriven/gi, type: "circumscribed" },
    { pattern: /höjd (från|till)/gi, type: "altitude" },
    { pattern: /median/gi, type: "median" },
    { pattern: /vinkelbisektris/gi, type: "angle_bisector" },
    { pattern: /tyngdpunkt/gi, type: "centroid" },
    { pattern: /ortocenter/gi, type: "orthocenter" },
  ],
};

/**
 * Detect all canonical geometry phrases in the given text.
 * Returns deduplicated list of canonical phrase types found.
 */
export function detectCanonicalPhrases(
  text: string,
  language: DetectedLanguage
): CanonicalPhrase[] {
  const patterns = PATTERNS[language];
  const seen = new Set<string>();
  const result: CanonicalPhrase[] = [];

  for (const { pattern, type } of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && !seen.has(type)) {
      seen.add(type);
      result.push({ type, rawText: match[0], language });
    }
  }

  return result;
}
