/**
 * Language Module — Layer 1/2
 *
 * Geometry language detection and normalization.
 * Supports Vietnamese (vi), English (en), and Swedish (sv).
 *
 * Main entry: detectAndNormalize(text) → NormalizedGeometryInput
 */

export type { DetectedLanguage, CanonicalPhrase, NormalizedGeometryInput } from "./canonical-language.js";
export { detectLanguage } from "./detect.js";
export { GEOMETRY_TERM_LEXICON, LEXICON_BY_CANONICAL } from "./term-lexicon.js";
export type { TermEntry } from "./term-lexicon.js";
export { detectCanonicalPhrases } from "./normalize-phrases.js";
export { selectFewShots, formatFewShot, FEW_SHOT_BANK } from "./fewshot-selector.js";
export type { FewShotExample } from "./fewshot-selector.js";

import { detectLanguage } from "./detect.js";
import { detectCanonicalPhrases } from "./normalize-phrases.js";
import type { NormalizedGeometryInput } from "./canonical-language.js";

/**
 * Run the full language normalization pass on a problem text.
 * Detects language and canonical geometry phrases.
 *
 * This is the single integration point called from pipeline/index.ts.
 */
export function detectAndNormalize(text: string): NormalizedGeometryInput {
  const language = detectLanguage(text);
  const canonicalPhrases = detectCanonicalPhrases(text, language);
  return { originalText: text, language, canonicalPhrases };
}
