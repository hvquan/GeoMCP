/**
 * Output Extractor — Layer 5
 *
 * Strips markdown fences and extracts raw JSON from LLM response text.
 * Different models format their responses differently; this module handles
 * the most common patterns.
 */

/**
 * Find and return the first JSON object `{...}` in an LLM response string.
 * Strips surrounding markdown code fences if present.
 * Uses balanced-brace scanning so trailing text after the JSON is ignored.
 */
export function extractJsonObject(text: string): unknown {
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  const start = stripped.indexOf("{");
  if (start < 0) throw new Error("LLM response does not contain a JSON object");

  // Walk forward counting braces to find the matching closing }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(stripped.slice(start, i + 1));
        } catch (e) {
          // Balanced scan found a block but it's still invalid — fall through to last-resort
          break;
        }
      }
    }
  }

  // Last-resort: first { to last }
  const last = stripped.lastIndexOf("}");
  if (last > start) {
    return JSON.parse(stripped.slice(start, last + 1));
  }
  throw new Error("LLM response does not contain valid JSON object");
}
