/**
 * LLM Output Repair — Layer 6
 *
 * When the LLM returns JSON that fails schema validation, this module attempts
 * lightweight structural repairs before giving up and triggering a full retry.
 *
 * Keeps the repair logic isolated so swapping models (or tightening the prompt)
 * only requires changes here — not scattered across dslParser.ts.
 *
 * ## Repair strategies (applied in order)
 *
 * 1. **Unwrap** – some models wrap the payload: `{ "result": { … } }` or
 *    `{ "geometry": { … } }`.  Strip the outer wrapper.
 * 2. **Objects from keys** – if `objects` is an object (map) instead of an
 *    array, convert each key/value to the expected `{ type, name }` shape.
 * 3. **Constraints array** – if missing, default to `[]`.
 * 4. **String-typed numbers** – `"radius": "5"` → `"radius": 5`.
 * 5. **Single-char uppercase** – point names that are lowercase: `"a"` → `"A"`.
 * 6. **Retry hint** – if all repairs fail, return null so the caller can fire
 *    a second LLM call with an error-repair system prompt.
 */

import type { GeometryDsl } from "../dsl/dsl.js";

/** Result of a repair attempt. */
export type RepairResult =
  | { ok: true; repaired: unknown; strategies: string[] }
  | { ok: false; strategies: string[]; reason: string };

/**
 * Attempt to repair a raw (possibly malformed) LLM JSON object so it
 * conforms to the `GeometryDsl` schema.
 *
 * Returns `{ ok: true, repaired, strategies }` on partial or full success,
 * or `{ ok: false, strategies, reason }` if the object is too broken to fix.
 *
 * The caller should pass the result through schema validation again; repair
 * does NOT guarantee validity — it only fixes the most common failure modes.
 */
export function repairDslJson(raw: unknown): RepairResult {
  const strategies: string[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, strategies, reason: "Not a JSON object" };
  }

  let obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  // ── 1. Unwrap common outer wrappers ───────────────────────────────────────
  const WRAPPER_KEYS = ["result", "geometry", "output", "dsl", "response", "data"];
  for (const key of WRAPPER_KEYS) {
    if (
      obj[key] !== undefined &&
      typeof obj[key] === "object" &&
      obj[key] !== null &&
      !Array.isArray(obj[key]) &&
      Object.keys(obj).length === 1
    ) {
      obj = { ...(obj[key] as Record<string, unknown>) };
      strategies.push(`unwrap:${key}`);
      break;
    }
  }

  // ── 2. Convert objects-as-map to array ────────────────────────────────────
  if (obj["objects"] !== undefined && !Array.isArray(obj["objects"])) {
    if (typeof obj["objects"] === "object" && obj["objects"] !== null) {
      const asMap = obj["objects"] as Record<string, unknown>;
      obj["objects"] = Object.entries(asMap).map(([name, val]) => {
        if (typeof val === "string") {
          return { type: val.toLowerCase(), name: name.slice(0, 1).toUpperCase() };
        }
        if (typeof val === "object" && val !== null) {
          return { name: name.slice(0, 1).toUpperCase(), ...(val as object) };
        }
        return { type: "point", name: name.slice(0, 1).toUpperCase() };
      });
      strategies.push("objects:map-to-array");
    } else {
      obj["objects"] = [];
      strategies.push("objects:default-empty");
    }
  }

  // ── 3. Ensure constraints is an array ─────────────────────────────────────
  if (!Array.isArray(obj["constraints"])) {
    obj["constraints"] = [];
    strategies.push("constraints:default-empty");
  }

  // ── 4. Fix string-typed numbers in circles (radius) and segments (length) ─
  if (Array.isArray(obj["objects"])) {
    obj["objects"] = (obj["objects"] as unknown[]).map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const o = { ...(item as Record<string, unknown>) };
      if (typeof o["radius"] === "string") {
        const n = parseFloat(o["radius"] as string);
        if (!isNaN(n)) { o["radius"] = n; strategies.push("radius:string-to-number"); }
      }
      if (typeof o["length"] === "string") {
        const n = parseFloat(o["length"] as string);
        if (!isNaN(n)) { o["length"] = n; strategies.push("length:string-to-number"); }
      }
      return o;
    });
  }

  // ── 5. Normalize point names to single uppercase letter ───────────────────
  if (Array.isArray(obj["objects"])) {
    obj["objects"] = (obj["objects"] as unknown[]).map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const o = { ...(item as Record<string, unknown>) };
      const type = String(o["type"] ?? "").toLowerCase();
      if (type === "point" && typeof o["name"] === "string") {
        const upper = o["name"].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (upper && upper !== o["name"]) {
          o["name"] = upper;
          strategies.push(`point-name:uppercase:${upper}`);
        }
      }
      return o;
    });
  }

  // ── 6. Ensure `objects` key exists (some models omit entirely) ────────────
  if (obj["objects"] === undefined) {
    obj["objects"] = [];
    strategies.push("objects:missing-default-empty");
  }

  return { ok: true, repaired: obj, strategies };
}

/**
 * Build a repair-request prompt to send on a second LLM call when the first
 * response fails schema validation.  Embeds the previous raw response and the
 * validation error message so the model can self-correct.
 */
export function buildRepairPrompt(rawResponse: string, validationError: string): string {
  return `The previous response failed JSON schema validation.

Validation error:
${validationError}

Previous response (invalid):
\`\`\`json
${rawResponse.slice(0, 3000)}
\`\`\`

Please output ONLY valid JSON that matches the required schema. Fix the issues described in the validation error. Output nothing else — no explanation, no markdown text outside the JSON object.`;
}
