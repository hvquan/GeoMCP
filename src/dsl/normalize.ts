/**
 * dsl/normalize.ts — Raw DSL normalizer
 *
 * normalizeRawDsl(raw)  — fixes GeoMCP snapshot format (objects/constraints/…)
 *
 * Normalizing the raw DSL:
 *  1. Token splitting: "BC" in midpoint.of → ["B","C"]
 *  2. Auto-add missing point objects from any constraint reference
 *  3. Truncate intersection.of with 3+ items to just 2 (enough to define the point)
 *  4. Remove duplicate constraints
 *  5. Line alias repair: "Ax" → "Cx" when only Cx is registered (x-suffix rule)
 *  6. Degenerate perpendicular-source repair: "DH ⊥ CD" → "EH ⊥ CD" when D
 *     is on the base line and E is the unambiguous external (on-circle) source.
 */
import type { RawDSL, RawObject, RawConstraint } from "./raw-schema.js";

// ── Warning types ─────────────────────────────────────────────────────────────

export interface NormalizeWarning {
  code:    string;
  message: string;
}

export interface NormalizeResult {
  dsl:      RawDSL;
  warnings: NormalizeWarning[];
}

// ═════════════════════════════════════════════════════════════════════════════
// Section A — Raw DSL normalizer
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if `s` looks like a two-point segment token, e.g. "BC", "AD".
 */
function isTwoPointToken(s: string): boolean {
  return s.length === 2 && /^[A-Z][A-Z]$/.test(s);
}

/**
 * If `s` is a two-point token, split it; otherwise return null.
 */
function splitTwoPoint(s: string): [string, string] | null {
  return isTwoPointToken(s) ? [s[0], s[1]] : null;
}

/**
 * Collect all single-uppercase-letter point names referenced anywhere in the DSL.
 */
function collectReferencedPoints(raw: RawDSL): Set<string> {
  const pts = new Set<string>();

  const addIfPoint = (s: string) => {
    if (/^[A-Z]$/.test(s)) pts.add(s);
    else if (isTwoPointToken(s)) { pts.add(s[0]); pts.add(s[1]); }
  };

  for (const obj of raw.objects) {
    if (obj.type === "triangle") (obj.points as string[]).forEach(p => pts.add(p));
    if (obj.type === "point")   pts.add(obj.name as string);
    if (obj.type === "circle")  pts.add(obj.center as string);
    if (obj.type === "segment") (obj.points as string[]).forEach(p => pts.add(p));
  }

  const allC = [...raw.constraints, ...raw.constructions];
  for (const c of allC) {
    Object.values(c).forEach(v => {
      if (typeof v === "string") addIfPoint(v);
      if (Array.isArray(v)) v.flat(2).forEach(x => { if (typeof x === "string") addIfPoint(x); });
    });
  }
  return pts;
}

/**
 * Collect point names already declared in objects[].
 */
function declaredPoints(raw: RawDSL): Set<string> {
  const pts = new Set<string>();
  for (const obj of raw.objects) {
    if (obj.type === "triangle") (obj.points as string[]).forEach(p => pts.add(p));
    if (obj.type === "point")    pts.add(obj.name as string);
    if (obj.type === "circle")   pts.add(obj.center as string);
  }
  return pts;
}

// ── Main normalizer ───────────────────────────────────────────────────────────

// ── Line alias helpers ────────────────────────────────────────────────────────

/**
 * Collect all line names that are "registered" in the DSL — either declared as
 * objects or produced by tangent constraints/constructions.
 */
function collectRegisteredLines(objects: RawObject[], allC: RawConstraint[]): Set<string> {
  const lines = new Set<string>();
  for (const obj of objects) {
    if (obj.type === "line") lines.add(obj.name as string);
  }
  for (const c of allC) {
    if (c.type === "tangent") {
      const name = (c as { type: "tangent"; line: string }).line;
      if (name) lines.add(name);
    }
  }
  return lines;
}

/**
 * Rule N18 — x-suffix alias repair.
 *
 * If a line name like "Ax" is referenced but not registered, and exactly one
 * registered line shares the same lowercase suffix (e.g. "Cx"), substitute it
 * and emit a warning.
 *
 * Only applies to 2-char names of the form [A-Z][a-z] (tangent-style line names).
 */
function repairLineRef(
  name: string,
  registeredLines: Set<string>,
  warnings: NormalizeWarning[],
): string {
  if (registeredLines.has(name)) return name;
  if (/^[A-Z][a-z]$/.test(name)) {
    const suffix = name[1];
    const candidates = [...registeredLines].filter(k => k.length === 2 && k[1] === suffix);
    if (candidates.length === 1) {
      warnings.push({
        code:    "line_alias_repaired",
        message: `Repaired unknown line "${name}" → "${candidates[0]}" (same suffix '${suffix}').`,
      });
      return candidates[0];
    }
  }
  return name;
}

/**
 * Apply line alias repair to all line-name fields inside a single constraint.
 */
function repairConstraintLines(
  c: RawConstraint,
  registeredLines: Set<string>,
  warnings: NormalizeWarning[],
): RawConstraint {
  const r = (name: string) => repairLineRef(name, registeredLines, warnings);

  if (c.type === "intersection") {
    const of_ = (c.of as string[]).map(r);
    return of_.some((v, i) => v !== (c.of as string[])[i]) ? { ...c, of: of_ } : c;
  }
  if (c.type === "perpendicular" || c.type === "parallel") {
    const a = c as { type: string; line1: string; line2: string };
    const line1 = r(a.line1);
    const line2 = r(a.line2);
    return (line1 !== a.line1 || line2 !== a.line2) ? { ...c, line1, line2 } : c;
  }
  if (c.type === "on_line") {
    const a = c as { type: "on_line"; point: string; line: string };
    const line = r(a.line);
    return (line !== a.line) ? { ...c, line } : c;
  }
  return c;
}

/**
 * Rule N20 — Degenerate perpendicular-source repair.
 *
 * The LLM sometimes names a foot-of-perpendicular line after an endpoint of the
 * base line instead of the external source point.  Example: the problem says
 * "Draw EH ⊥ CD at H" but the model outputs line1="DH" line2="CD".
 * D is an endpoint of CD → the perpendicular through D onto CD is degenerate
 * (it is the entire line CD itself, and foot = D, not H).
 *
 * Strategy: if line1="XH" ⊥ line2="YZ" and X ∈ {Y,Z}, find the unique
 * external candidate point P (not X/Y/Z/H) from declared objects, preferring
 * on-circle points, and rename the line from "XH" to "PH" everywhere.
 */

/** Parse a two-uppercase-letter line name (foot-of-perpendicular pattern). */
function parseTwoUpper(name: string): [string, string] | null {
  return /^[A-Z][A-Z]$/.test(name) ? [name[0], name[1]] : null;
}

/**
 * Find all degenerate perpendicular lines and return a rename map old→new.
 */
function findDegeneratePerps(
  objects:       RawObject[],
  constraints:   RawConstraint[],
  constructions: RawConstraint[],
  warnings:      NormalizeWarning[],
): Map<string, string> {
  // Collect on_circle points
  const onCircle = new Set<string>();
  const allC = [...constraints, ...constructions];
  for (const c of allC) {
    if (c.type === "on_circle" && typeof (c as Record<string,unknown>).point === "string") {
      onCircle.add((c as Record<string,unknown>).point as string);
    }
  }

  // Collect all declared single-uppercase-letter point names
  const allPoints = new Set<string>();
  for (const obj of objects) {
    if (obj.type === "point" && /^[A-Z]$/.test(obj.name as string)) {
      allPoints.add(obj.name as string);
    } else if (obj.type === "circle" && /^[A-Z]$/.test((obj as Record<string,unknown>).center as string)) {
      allPoints.add((obj as Record<string,unknown>).center as string);
    } else if (obj.type === "triangle") {
      for (const p of (obj.points as string[])) {
        if (/^[A-Z]$/.test(p)) allPoints.add(p);
      }
    }
  }

  const renames = new Map<string, string>();

  for (const c of allC) {
    if (c.type !== "perpendicular") continue;
    const line1 = (c as Record<string,unknown>).line1 as string | undefined;
    const line2 = (c as Record<string,unknown>).line2 as string | undefined;
    if (typeof line1 !== "string" || typeof line2 !== "string") continue;

    const pts1 = parseTwoUpper(line1);
    const pts2 = parseTwoUpper(line2);
    if (!pts1 || !pts2) continue;         // only two-uppercase-letter names

    const [src, foot] = pts1;
    const [y,   z]    = pts2;

    // Not degenerate — source is external
    if (src !== y && src !== z) continue;
    if (renames.has(line1)) continue;     // already scheduled

    // Candidate external points: not src/foot/y/z
    const excluded = new Set([src, foot, y, z]);
    const externals = [...allPoints].filter(p => !excluded.has(p));
    if (externals.length === 0) continue;

    // Prefer on_circle points; fall back to all externals if none
    const preferred   = externals.filter(p => onCircle.has(p));
    const candidates  = preferred.length > 0 ? preferred : externals;
    if (candidates.length !== 1) continue; // ambiguous — don't guess

    const newName = candidates[0] + foot;
    renames.set(line1, newName);
    warnings.push({
      code:    "degenerate_perp_source_repaired",
      message: `Renamed degenerate perpendicular line "${line1}" → "${newName}": ` +
               `source "${src}" is an endpoint of base line "${line2}"; ` +
               `inferred external source "${candidates[0]}".`,
    });
  }

  return renames;
}

/**
 * Rename all line-name string fields in a constraint according to a rename map.
 */
function renameLineRefs(c: RawConstraint, renames: Map<string, string>): RawConstraint {
  const r = (v: string) => renames.get(v) ?? v;
  let changed = false;
  const newC = { ...c } as Record<string, unknown>;

  for (const key of ["line1", "line2", "line", "name"]) {
    if (typeof newC[key] === "string") {
      const renamed = r(newC[key] as string);
      if (renamed !== newC[key]) { newC[key] = renamed; changed = true; }
    }
  }
  if (Array.isArray(newC["of"])) {
    const of_ = (newC["of"] as string[]).map(r);
    if (of_.some((v, i) => v !== (newC["of"] as string[])[i])) {
      newC["of"] = of_; changed = true;
    }
  }
  return changed ? newC as RawConstraint : c;
}

export function normalizeRawDsl(input: unknown): NormalizeResult {
  const raw = input as Partial<RawDSL>;
  const warnings: NormalizeWarning[] = [];

  const objects:       RawObject[]     = Array.isArray(raw.objects)       ? [...raw.objects]       : [];
  const constraints:   RawConstraint[] = Array.isArray(raw.constraints)   ? [...raw.constraints]   : [];
  const constructions: RawConstraint[] = Array.isArray(raw.constructions) ? [...raw.constructions] : [];
  const targets                        = Array.isArray(raw.targets)       ? raw.targets            : [];

  // ── 1. Fix midpoint "of" token splitting ────────────────────────────────────
  // Model sometimes emits "of": ["BC","AD"] where both are side names with no vertex.
  // Pattern ["A","BC"] (vertex + segment) is kept as-is — the adapter handles it as a median.
  const fixMidpoints = (arr: RawConstraint[]): RawConstraint[] =>
    arr.map(c => {
      if (c.type !== "midpoint") return c;
      const [a, b] = c.of as [string, string];
      const splitA = splitTwoPoint(a);
      const splitB = splitTwoPoint(b);
      // ["A","BC"] — first token is a single point, second is a segment name.
      // Keep as-is so the adapter can emit the median segment A-M.
      if (!splitA && splitB) return c;
      // ["BC","D"] — first is segment, second is point (unusual, normalise to points)
      if (splitA && !splitB) return { ...c, of: splitA } as RawConstraint;
      // ["AB","CD"] — both are segment names, take the second (heuristic)
      if (splitA && splitB)  return { ...c, of: splitB } as RawConstraint;
      return c;
    });

  const normConstraints   = fixMidpoints(constraints);
  const normConstructions = fixMidpoints(constructions);

  // ── 2. Truncate intersection.of with 3+ entries to 2 ─────────────────────
  // e.g. model emits "of": ["AK","BK","CK"] for incenter → keep first two
  const truncateIntersections = (arr: RawConstraint[]): RawConstraint[] =>
    arr.map(c => {
      if (c.type !== "intersection") return c;
      const of_ = c.of as string[];
      return of_.length > 2 ? { ...c, of: [of_[0], of_[1]] } as RawConstraint : c;
    });

  const cleanConstraints   = truncateIntersections(normConstraints);
  const cleanConstructions = truncateIntersections(normConstructions);

  // ── 3. Auto-add missing point objects from all constraint references ───────
  const allC = [...cleanConstraints, ...cleanConstructions];
  const referenced = collectReferencedPoints({ objects, constraints: allC, constructions: [], targets });
  const declared   = declaredPoints({ objects, constraints: [], constructions: [], targets });

  const newObjects: RawObject[] = [...objects];
  for (const name of referenced) {
    if (!declared.has(name)) {
      newObjects.push({ type: "point", name });
      declared.add(name);
    }
  }

  // ── 4. Deduplicate point objects (same name appearing twice) ──────────────
  const seenObjs = new Set<string>();
  const dedupedObjects: RawObject[] = [];
  for (const obj of newObjects) {
    const key = obj.type === "point"    ? `pt:${obj.name ?? ""}` :
                obj.type === "segment"  ? `seg:${(obj.points as string[]).join("+")}` :
                obj.type === "triangle" ? `tri:${(obj.points as string[]).join("")}` :
                `${obj.type}:${JSON.stringify(obj)}`;
    if (!seenObjs.has(key)) { seenObjs.add(key); dedupedObjects.push(obj); }
  }

  // ── 5. Line alias repair (Rule N18) ───────────────────────────────────────
  // Repair x-suffix typos like "Ax" → "Cx" when only Cx is registered.
  const registeredLines = collectRegisteredLines(dedupedObjects, allC);
  const repairedConstraints   = cleanConstraints.map(c =>
    repairConstraintLines(c, registeredLines, warnings));
  const repairedConstructions = cleanConstructions.map(c =>
    repairConstraintLines(c, registeredLines, warnings));

  // ── 6. Degenerate perpendicular-source repair (Rule N20) ──────────────────
  // Rename "DH ⊥ CD" → "EH ⊥ CD" when D is on the base line and E is the
  // unambiguous external (on-circle) source.
  const degenerateRenames = findDegeneratePerps(
    dedupedObjects, repairedConstraints, repairedConstructions, warnings,
  );

  let finalObjects       = dedupedObjects as RawObject[];
  let finalConstraints   = repairedConstraints;
  let finalConstructions = repairedConstructions;

  if (degenerateRenames.size > 0) {
    finalObjects = dedupedObjects.map(obj =>
      obj.type === "line" && degenerateRenames.has(obj.name as string)
        ? { ...obj, name: degenerateRenames.get(obj.name as string)! }
        : obj,
    );
    finalConstraints   = repairedConstraints.map(c   => renameLineRefs(c, degenerateRenames));
    finalConstructions = repairedConstructions.map(c => renameLineRefs(c, degenerateRenames));
  }

  return {
    dsl: {
      objects:       finalObjects,
      constraints:   finalConstraints,
      constructions: finalConstructions,
      targets,
    },
    warnings,
  };
}
