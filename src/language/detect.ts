/**
 * Language Detection — Layer 1
 *
 * Detects the language of a geometry problem text.
 * Uses lightweight rule-based heuristics: character set analysis.
 *
 * Supported languages: Vietnamese (vi), Swedish (sv), English (en).
 * Default is English when no distinctive characters are found.
 */

import type { DetectedLanguage } from "./canonical-language.js";

/**
 * Vietnamese-specific Unicode diacritics not found in other European scripts.
 * Matches characters like: ắ ộ ừ ẽ ụ ổ ổ ẫ ẹ ẩ ứ ẻ ấ etc.
 * The ranges cover all Vietnamese tone-marked vowels.
 */
const VI_PATTERN = /[àáâãèéêìíòóôõùúýăđơư\u1ea0-\u1ef9]/i;

/**
 * Swedish-specific characters: å, ä, ö (and uppercase variants).
 */
const SV_PATTERN = /[åäöÅÄÖ]/;

/**
 * Detect the language of a geometry problem text.
 *
 * @param text - Raw input text
 * @returns "vi" | "sv" | "en"
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (VI_PATTERN.test(text)) return "vi";
  if (SV_PATTERN.test(text)) return "sv";
  return "en";
}
