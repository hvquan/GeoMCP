/**
 * Canonical Language Types — Layer 1/2 (Language Detection & Normalization)
 *
 * Shared types used by language detection, phrase normalization, and
 * dynamic few-shot selection.
 */

/** Languages supported by the geometry language normalization layer. */
export type DetectedLanguage = "vi" | "en" | "sv";

/**
 * A canonical geometry phrase detected in the input text.
 * Maps language-specific surface forms to a single semantic type.
 *
 * Examples of different surface forms mapping to the same type:
 *   "thuộc đường tròn" (VI) → point_on_circle
 *   "lies on the circle" (EN) → point_on_circle
 *   "ligger på cirkeln" (SV) → point_on_circle
 */
export interface CanonicalPhrase {
  /** Geometry concept type, e.g. "point_on_circle", "tangent", "diameter". */
  type: string;
  /** The raw matched text from the original input. */
  rawText: string;
  /** The language in which this phrase was detected. */
  language: DetectedLanguage;
}

/**
 * Result of the geometry language normalization pass.
 * Passed to prompt-builder and few-shot selector.
 */
export interface NormalizedGeometryInput {
  /** Original problem text, unchanged. */
  originalText: string;
  /** Detected language. */
  language: DetectedLanguage;
  /** Canonical geometry phrases found in the text. */
  canonicalPhrases: CanonicalPhrase[];
}
