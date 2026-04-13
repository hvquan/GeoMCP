/**
 * Layer 9 — Canonical Problem Representation
 *
 * Converts a validated GeometryDsl (LLM output, Layer 7) into a stable
 * CanonicalProblem that is:
 *   - independent of LLM quirks (name aliasing, type aliasing, missing objects)
 *   - cleanly separated into entities / givens / goals
 *   - suitable as input for the construction compiler (Layer 11), constraint
 *     solver (Layer 12), renderer (Layer 13), and future proof engines
 *
 * Key normalizations performed here:
 *   4.1  Object names  — "O" / "(O)" / "circle O" → entity ids pt_O + cir_O
 *   4.2  Relation types — variant spellings → single canonical type string
 *   4.3  Implicit lines — referenced 2-letter names become explicit line entities
 *   4.4  givens vs goals — DSL targets become goals, everything else becomes givens
 *   4.5  Derived objects — foot-of-perp, implicit lines from constructions, etc.
 *
 * ID convention:
 *   pt_A        — explicit/derived point with label A
 *   pt_i_001    — implicit/bookkeeping point (no label, counter-based)
 *   ln_AE       — line through A and E (endpoint letters sorted for stability)
 *   cir_O       — circle with centre O
 *   seg_EH      — bounded segment (endpoint letters sorted)
 *   ray_AB      — ray from A through B (origin first, not sorted)
 *   ray_AB      — ray from A through B
 *   tri_ABC     — triangle
 *   poly_…      — polygon
 *
 * Entity metadata schema:
 *   id          — stable internal id (never shown to users)
 *   label       — display label ("A", "(O)", null for implicit objects)
 *   kind        — point | circle | line | segment | ray | triangle | polygon
 *   origin      — "explicit" | "derived" | "implicit"
 *   source      — why this entity was created (e.g. "problem_text", "intersection")
 *   debug_name? — optional human-readable name for implicit objects
 */

import type { GeometryDsl, DslObject, DslConstraint, DslConstruction, DslTarget } from "./dsl.js";

// ─── Entity metadata ──────────────────────────────────────────────────────────

export type EntityOrigin = "explicit" | "derived" | "implicit";

/**
 * Typed vocabulary for the `source` field.
 *
 * Tier 1 — problem input:
 *   problem_text            stated directly in the problem text
 *   llm_extraction          produced by the LLM DSL extractor
 *
 * Tier 2 — geometry derivation:
 *   line_through_points      line implied by two points (two-letter name or ensureLineByPoints)
 *   intersection_of_lines   point defined as intersection of two lines/circles
 *   foot_of_perpendicular   foot of an altitude or perpendicular construction
 *   tangent_at_point        tangent line touching a circle at a named point
 *   perpendicular_through_point  line constructed perpendicular to another through a point
 *   parallel_through_point  line constructed parallel to another through a point
 *   compiled_from_circle_definition  radius or angle param synthesised by the compiler from a circle declaration
 *
 * Tier 3 — internal / tooling:
 *   layout_helper           coordinate seed or helper used by the numeric layout engine
 *   render_clip             synthetic endpoint created to clip an infinite line to the viewport
 *   label_anchor            point used only to anchor a display label
 */
export type EntitySource =
  | "problem_text"
  | "llm_extraction"
  | "line_through_points"
  | "intersection_of_lines"
  | "foot_of_perpendicular"
  | "tangent_at_point"
  | "perpendicular_through_point"
  | "parallel_through_point"
  | "compiled_from_circle_definition"
  | "layout_helper"
  | "render_clip"
  | "label_anchor";

export interface EntityMeta {
  /** Stable internal id — never shown to users. */
  id: string;
  /** Display label: "A", "(O)", or null for invisible bookkeeping objects. */
  label: string | null;
  /** Conceptual kind. */
  kind: "point" | "circle" | "line" | "segment" | "ray" | "triangle" | "polygon"
      | "radius_parameter" | "angle_parameter";
  /** How this entity was introduced. */
  origin: EntityOrigin;
  /** Why this entity was created (typed vocabulary — see EntitySource). */
  source: EntitySource;
  /** Whether this entity should be rendered in the diagram. Defaults to true. */
  visible: boolean;
  /** Whether the user can select / drag this entity. Defaults to true for explicit/derived. */
  selectable?: boolean;
  /** Extra human-readable description for implicit objects (e.g. "viewport endpoint 1 for ln_AE"). */
  debug_name?: string;
  /**
   * Semantic roles this entity plays in the problem.
   * Examples: ["radius_segment"], ["diameter"], ["altitude"], ["median"].
   */
  roles?: string[];
  /**
   * Provenance record for derived/implicit objects.
   * Captures the geometric construction that produced this entity so that
   * downstream engines (constraint solver, renderer) can reconstruct it
   * without reparsing the problem text.
   *
   * Examples:
   *   { type: "perpendicular_through_point", point: "pt_O", to_line: "ln_CE" }
   *   { type: "tangent_at_point",            circle: "cir_O", at: "pt_C" }
   *   { type: "intersection_of_lines",       line1: "ln_CE", line2: "ln_Cx" }
   *   { type: "render_clip",                 for_entity: "ln_perp_O_to_ln_CE" }
   */
  construction?: Record<string, string>;
}

// ─── Entity types ─────────────────────────────────────────────────────────────

export type CanonicalEntity =
  | (EntityMeta & { kind: "point" })
  | (EntityMeta & {
      kind: "circle";
      center: string;
      /** Reference to the scalar radius parameter, e.g. "rad_cir_O". */
      radius_ref: string;
    })
  | (EntityMeta & { kind: "line"; through?: [string, string] })
  | (EntityMeta & { kind: "segment"; endpoints: [string, string] })
  | (EntityMeta & { kind: "ray"; from: string; direction: string })
  | (EntityMeta & { kind: "triangle"; vertices: [string, string, string] })
  | (EntityMeta & { kind: "polygon"; vertices: string[] })
  /**
   * Scalar radius geometric parameter.
   * Participates in the dependency graph: when `value` changes (user drag)
   * or its constraints are solved, all circle/point nodes downstream update.
   *
   * id convention: rad_cir_O
   */
  | (EntityMeta & {
      kind: "radius_parameter";
      /** Owning circle id. */
      circle: string;
      /** Current numeric value (null → free / not yet solved). */
      value: number | null;
      /** Whether the user can drag this parameter interactively. */
      interactive: boolean;
    })
  /**
   * Scalar angle parameter for a free point on a circle.
   * Captures the angular position of the point so that when the
   * circle's radius changes, the point stays on the circle.
   *
   * id convention: ang_E_on_cir_O
   */
  | (EntityMeta & {
      kind: "angle_parameter";
      /** The point whose position this angle determines. */
      point: string;
      /** The circle the point lies on. */
      circle: string;
      /** Current value in radians (null → free). */
      value: number | null;
      /** Whether the user can drag this parameter interactively. */
      interactive: boolean;
    });

// ─── Given types ──────────────────────────────────────────────────────────────

export type CanonicalGiven =
  | { type: "diameter_of_circle"; circle: string; endpoints: [string, string] }
  | { type: "point_on_circle"; point: string; circle: string }
  | { type: "tangent_at_point"; circle: string; line: string; point: string }
  | { type: "perpendicular_through_point"; line: string; point: string; to_line: string }
  | { type: "intersection_of_lines"; point: string; lines: [string, string] }
  | { type: "foot_of_perpendicular"; from_point: string; to_line: string; foot: string }
  | { type: "midpoint_of_segment"; point: string; segment: [string, string] }
  | { type: "point_on_segment"; point: string; segment: [string, string] }
  | { type: "line_through_points"; line: string; points: [string, string] }
  | { type: "perpendicular_lines"; line1: string; line2: string }
  | { type: "parallel_lines"; line1: string; line2: string }
  | { type: "equal_length"; segment1: [string, string]; segment2: [string, string] }
  | { type: "equal_angle"; angle1: [string, string, string]; angle2: [string, string, string] }
  | { type: "right_angle"; vertex: string; ray1: string; ray2: string }
  | { type: "distinct_points"; points: string[] };

// ─── Goal types ───────────────────────────────────────────────────────────────

export type CanonicalGoal =
  | { id: string; type: "tangent_at_point"; circle: string; line: string; point: string }
  | { id: string; type: "perpendicular_lines"; line1: string; line2: string }
  | { id: string; type: "parallel_lines"; line1: string; line2: string }
  | { id: string; type: "midpoint_of_segment"; point: string; segment: [string, string] }
  | { id: string; type: "right_angle_at"; point: string }
  | { id: string; type: "intersection_is_midpoint_of_segment"; lines: [string, string]; segment_endpoints: [string, string] }
  | { id: string; type: "statement"; text: string };

// ─── Top-level canonical problem ──────────────────────────────────────────────

export interface CanonicalProblem {
  version: "1.0";
  problem_type: "plane_geometry";
  entities: CanonicalEntity[];
  givens: CanonicalGiven[];
  goals: CanonicalGoal[];
}

// ─── ID constructors ──────────────────────────────────────────────────────────

/** Extract a single uppercase letter from either a raw DSL label ("A", "angle") or a canonical point id ("pt_A" → "A"). */
function rawLetter(s: string): string {
  const str = String(s || "").trim();
  const m = str.match(/^pt_([A-Z])$/i);
  if (m) return m[1].toUpperCase();
  return str.toUpperCase().slice(0, 1);
}

/** pt_A */
function mkPointId(label: string): string { return `pt_${rawLetter(label)}`; }
/** cir_O */
function mkCircleId(centerLabel: string): string { return `cir_${rawLetter(centerLabel)}`; }
/** seg_EH — endpoint letters sorted so seg_EH === seg_HE. */
function mkSegmentId(a: string, b: string): string {
  const [p, q] = [rawLetter(a), rawLetter(b)].sort();
  return `seg_${p}${q}`;
}
/** ray_AB — origin first, through-point second; NOT sorted (direction matters). */
function mkRayId(from: string, dir: string): string { return `ray_${rawLetter(from)}_${rawLetter(dir)}`; }
/** ln_AE — endpoint letters sorted so ln_AE === ln_EA. */
function mkLineId(a: string, b: string): string {
  const [p, q] = [rawLetter(a), rawLetter(b)].sort();
  return `ln_${p}${q}`;
}

/**
 * Parse a two-letter DSL line name only when BOTH characters are uppercase A-Z.
 *   "CE"  → ["C","E"]   (2-point line — canonical id will be sorted: ln_CE)
 *   "Cx"  → null         (user-labeled line: first char is point, rest is direction marker)
 *   "l1"  → null         (anonymous line)
 */
function parseLineName(name: string): [string, string] | null {
  const s = String(name || "").trim();
  if (/^[A-Z]{2}$/.test(s)) return [s[0], s[1]];
  return null;
}

// ─── Main converter ───────────────────────────────────────────────────────────

export function dslToCanonical(dsl: GeometryDsl): CanonicalProblem {
  const entities = new Map<string, CanonicalEntity>();
  const givens: CanonicalGiven[] = [];
  const goals: CanonicalGoal[] = [];

  // Counter for implicit (bookkeeping) point ids: pt_i_001, pt_i_002, …
  let implicitPointCounter = 0;
  function nextImplicitPointId(): string {
    return `pt_i_${String(++implicitPointCounter).padStart(3, "0")}`;
  }

  // Counter for compiler-generated circle ids: cir_i_001, cir_i_002, …
  let implicitCircleCounter = 0;
  function nextImplicitCircleId(): string {
    return `cir_i_${String(++implicitCircleCounter).padStart(3, "0")}`;
  }

  // Pre-classify derived points (produced by intersection constructions)
  const derivedPointLabels = new Set<string>();
  for (const step of dsl.constructions) {
    if (step.type === "intersection") derivedPointLabels.add(rawLetter(step.point));
  }
  for (const c of dsl.constraints) {
    if (c.type === "intersection") derivedPointLabels.add(rawLetter(c.point));
  }

  // ── Entity registration helpers ────────────────────────────────────────────

  function ensurePoint(raw: string, forceOrigin?: EntityOrigin, forceSrc?: string): string {
    const label = rawLetter(raw);
    const id = mkPointId(label);
    if (!entities.has(id)) {
      const origin: EntityOrigin = forceOrigin ?? (derivedPointLabels.has(label) ? "derived" : "explicit");
      const source: EntitySource = forceSrc as EntitySource ?? (origin === "derived" ? "intersection_of_lines" : "problem_text");
      entities.set(id, { id, label, kind: "point", origin, source, visible: true, selectable: origin !== "implicit" });
    }
    return id;
  }

  /**
   * Create a new implicit (bookkeeping) point not tied to any problem label.
   * Returns the generated pt_i_NNN id.
   */
  function createImplicitPoint(debugName: string): string {
    const id = nextImplicitPointId();
    entities.set(id, { id, label: null, kind: "point", origin: "implicit", source: "layout_helper", visible: false, selectable: false, debug_name: debugName });
    return id;
  }

  /**
   * Create a compiler-generated circle not tied to any problem label.
   * Returns the generated cir_i_NNN id.
   */
  function createImplicitCircle(centerPtId: string, debugName: string): string {
    const id = nextImplicitCircleId();
    entities.set(id, { id, label: null, kind: "circle", center: centerPtId, radius_ref: `rad_${id}`, origin: "implicit", source: "layout_helper", visible: false, selectable: false, debug_name: debugName });
    return id;
  }

  function ensureCircle(centerRaw: string): string {
    const label = rawLetter(centerRaw);
    ensurePoint(label);
    const id = mkCircleId(label);
    const radId = `rad_${id}`; // e.g. rad_cir_O
    if (!entities.has(radId)) {
      entities.set(radId, {
        id: radId,
        label: `r(${label})`,
        kind: "radius_parameter",
        circle: id,
        value: null,
        interactive: true,
        origin: "derived",
        source: "compiled_from_circle_definition",
        visible: false,
        selectable: false,
      });
    }
    if (!entities.has(id)) {
      entities.set(id, {
        id,
        label: `(${label})`,
        kind: "circle",
        center: mkPointId(label),
        radius_ref: radId,
        origin: "explicit",
        source: "problem_text",
        visible: true,
        selectable: true,
      });
    }
    return id;
  }

  /**
   * Register an angle parameter for a free point on a circle, and stamp
   * a point_on_circle_by_angle construction record onto the point entity.
   */
  function ensureAngleParam(ptId: string, cirId: string): string {
    const ptLabel = rawLetter(ptId.replace("pt_", "") || ptId);
    const angId = `ang_${ptLabel}_on_${cirId}`;
    if (!entities.has(angId)) {
      entities.set(angId, {
        id: angId,
        label: null,
        kind: "angle_parameter",
        point: ptId,
        circle: cirId,
        value: null,
        interactive: true,
        origin: "derived",
        source: "compiled_from_circle_definition",
        visible: false,
        selectable: false,
      });
    }
    // Stamp construction provenance onto the point if not already set
    const ptEntity = entities.get(ptId);
    if (ptEntity && !ptEntity.construction) {
      (ptEntity as EntityMeta).construction = {
        type: "point_on_circle_by_angle",
        circle: cirId,
        angle_parameter: angId,
      };
    }
    return angId;
  }

  function ensureLineByPoints(aRaw: string, bRaw: string, origin: EntityOrigin = "implicit", src: EntitySource = "line_through_points"): string {
    const [aL, bL] = [rawLetter(aRaw), rawLetter(bRaw)];
    ensurePoint(aL);
    ensurePoint(bL);
    const id = mkLineId(aL, bL); // mkLineId sorts the letters
    if (!entities.has(id)) {
      const [sA, sB] = [aL, bL].sort() as [string, string]; // match the sorted id
      entities.set(id, { id, label: `${sA}${sB}`, kind: "line", through: [mkPointId(sA), mkPointId(sB)], origin, source: src as EntitySource, visible: true, selectable: origin !== "implicit" });
    }
    return id;
  }

  function ensureLineByName(name: string, origin: EntityOrigin = "explicit", src: EntitySource = "problem_text"): string | null {
    if (!name) return null;
    const parsed = parseLineName(name);
    if (parsed) {
      // Two-uppercase-letter name → 2-point line; sort for stable id + label
      const [aL, bL] = parsed;
      const [sA, sB] = [aL, bL].sort() as [string, string];
      ensurePoint(aL);
      ensurePoint(bL);
      const id = mkLineId(aL, bL); // same as `ln_${sA}${sB}`
      if (!entities.has(id)) {
        entities.set(id, { id, label: `${sA}${sB}`, kind: "line", through: [mkPointId(sA), mkPointId(sB)], origin, source: src as EntitySource, visible: true, selectable: origin !== "implicit" });
      }
      return id;
    }
    // User-labeled line (Cx, l, m, EH, …): preserve the original label, prefix with ln_
    const id = `ln_${name}`;
    if (!entities.has(id)) {
      entities.set(id, { id, label: name, kind: "line", origin, source: src as EntitySource, visible: true, selectable: origin !== "implicit" });
    }
    return id;
  }

  /** Resolve a DSL line reference. Anonymous labels (l1, l2, …) → null. */
  function resolveLineRef(name: string): string | null {
    if (!name || /^[a-z_]/.test(name)) return null;
    return ensureLineByName(name, "implicit", "problem_text");
  }

  // DSL circle name/centre letter → cir_X
  const circleCenterById = new Map<string, string>();

  // ── Pass 1: Walk objects ───────────────────────────────────────────────────

  for (const obj of dsl.objects) {
    processObject(obj);
  }

  function processObject(obj: DslObject): void {
    switch (obj.type) {
      case "point":
        ensurePoint(obj.name);
        break;

      case "circle": {
        const center = obj.center ?? obj.name ?? "O";
        const cid = ensureCircle(center);
        const centerPtId = mkPointId(center);
        circleCenterById.set(obj.name ?? centerPtId, cid);
        circleCenterById.set(centerPtId, cid);
        if (obj.through) {
          const throughPt = ensurePoint(obj.through);
          ensureAngleParam(throughPt, cid);
          givens.push({ type: "point_on_circle", point: throughPt, circle: cid });
        }
        break;
      }

      case "line":
        ensureLineByName(obj.name);
        break;

      case "segment": {
        const a = ensurePoint(obj.points[0]);
        const b = ensurePoint(obj.points[1]);
        const id = mkSegmentId(obj.points[0], obj.points[1]);
        if (!entities.has(id)) {
          const [sA, sB] = [rawLetter(obj.points[0]), rawLetter(obj.points[1])].sort();
          entities.set(id, { id, label: `${sA}${sB}`, kind: "segment", endpoints: [mkPointId(sA), mkPointId(sB)], origin: "explicit", source: "problem_text", visible: true, selectable: true });
        }
        // A declared segment also implies a line through its endpoints
        ensureLineByPoints(obj.points[0], obj.points[1]);
        break;
      }

      case "triangle": {
        const [a, b, c] = obj.points.map(p => ensurePoint(p)) as [string, string, string];
        const lbls = obj.points.map(rawLetter);
        const id = `tri_${lbls.join("")}`;
        if (!entities.has(id)) {
          entities.set(id, { id, label: lbls.join(""), kind: "triangle", vertices: [a, b, c], origin: "explicit", source: "problem_text", visible: true, selectable: true });
        }
        // Implied sides
        ensureLineByPoints(obj.points[0], obj.points[1]);
        ensureLineByPoints(obj.points[1], obj.points[2]);
        ensureLineByPoints(obj.points[2], obj.points[0]);
        break;
      }

      case "polygon": {
        const pts = obj.points.map(p => ensurePoint(p));
        const lbls = obj.points.map(rawLetter);
        const id = `poly_${lbls.join("")}`;
        if (!entities.has(id)) {
          entities.set(id, { id, label: lbls.join(""), kind: "polygon", vertices: pts, origin: "explicit", source: "problem_text", visible: true, selectable: true });
        }
        break;
      }

      case "intersection": {
        // Intersection as an object means the point IS its own entity
        ensurePoint(obj.point);
        break;
      }

      case "midpoint":
        ensurePoint(obj.point);
        ensurePoint(obj.of[0]);
        ensurePoint(obj.of[1]);
        break;

      case "foot":
      case "projection":
        ensurePoint(obj.point);
        break;

      case "perpendicular_line": {
        const through = ensurePoint(obj.through);
        const to = Array.isArray(obj.to)
          ? ensureLineByPoints(ensurePoint(obj.to[0]), ensurePoint(obj.to[1]))
          : resolveLineRef(obj.to as string);
        // Semantic id: ln_perp_O_to_ln_CE (through-point → target-line)
        const lineId = obj.name
          ? `ln_${obj.name}`
          : `ln_perp_${rawLetter(through)}_to_${to ?? "?"}`;
        if (!entities.has(lineId)) {
          entities.set(lineId, {
            id: lineId, label: obj.name ?? null, kind: "line",
            origin: "derived", source: "perpendicular_through_point",
            visible: true, selectable: true,
            construction: { type: "perpendicular_through_point", point: through, to_line: to ?? "?" },
          });
        }
        if (to) {
          givens.push({ type: "perpendicular_through_point", line: lineId, point: through, to_line: to });
        }
        break;
      }

      case "parallel_line": {
        const through = ensurePoint(obj.through);
        const to = Array.isArray(obj.to)
          ? ensureLineByPoints(ensurePoint(obj.to[0]), ensurePoint(obj.to[1]))
          : resolveLineRef(obj.to as string);
        void through;
        void to;
        break;
      }

      // Shape shorthands — just register constituent points; constraints come later
      case "isosceles_triangle":
      case "equilateral_triangle":
      case "right_triangle":
      case "right_isosceles_triangle":
        obj.points.forEach(p => ensurePoint(p));
        break;

      case "rectangle":
      case "square":
      case "rhombus":
      case "parallelogram":
      case "trapezoid":
      case "isosceles_trapezoid":
      case "kite":
        (obj as any).points.forEach((p: string) => ensurePoint(p));
        break;

      default:
        break;
    }
  }

  // ── Pass 2: Walk constraints → givens ─────────────────────────────────────

  for (const c of dsl.constraints) {
    processConstraint(c);
  }

  function resolveCircleRef(raw: string): string {
    // Try: exact match in circleCenterById, or treat as center letter
    return circleCenterById.get(raw) ?? circleCenterById.get(mkPointId(raw)) ?? mkCircleId(raw);
  }

  function processConstraint(c: DslConstraint): void {
    switch (c.type) {
      case "diameter": {
        const cid = resolveCircleRef(c.circle);
        const [a, b] = c.points.map(p => ensurePoint(p)) as [string, string];
        ensureCircle(c.circle);
        // CD is the diameter line — make it explicit
        ensureLineByPoints(c.points[0], c.points[1]);
        givens.push({ type: "diameter_of_circle", circle: cid, endpoints: [a, b] });
        break;
      }

      case "on_circle": {
        const pt = ensurePoint(c.point);
        const cid = resolveCircleRef(c.circle);
        ensureAngleParam(pt, cid);
        givens.push({ type: "point_on_circle", point: pt, circle: cid });
        break;
      }

      case "tangent": {
        const at = ensurePoint(c.at);
        const cid = resolveCircleRef(c.circle);
        const tanFallbackId = `ln_tan_${rawLetter(at)}_on_${cid}`;
        const lineCanonId = ensureLineByName(c.line) ?? tanFallbackId;
        if (!entities.has(lineCanonId)) {
          entities.set(lineCanonId, {
            id: lineCanonId, label: c.line ?? null, kind: "line",
            origin: c.line ? "explicit" : "derived", source: "tangent_at_point",
            visible: true, selectable: true,
            construction: { type: "tangent_at_point", at: at, circle: cid },
          });
        }
        givens.push({ type: "tangent_at_point", circle: cid, line: lineCanonId, point: at });
        break;
      }

      case "perpendicular": {
        const l1 = resolveLineRef(c.line1);
        const l2 = resolveLineRef(c.line2);
        if (l1 && l2) {
          givens.push({ type: "perpendicular_lines", line1: l1, line2: l2 });
        }
        break;
      }

      case "parallel": {
        const l1 = resolveLineRef(c.line1);
        const l2 = resolveLineRef(c.line2);
        if (l1 && l2) {
          givens.push({ type: "parallel_lines", line1: l1, line2: l2 });
        }
        break;
      }

      case "midpoint": {
        const pt = ensurePoint(c.point);
        const segRaw: [string, string] | undefined = Array.isArray(c.segment)
          ? [c.segment[0], c.segment[1]]
          : (parseLineName(c.segment as string) ?? undefined);
        if (segRaw) {
          const seg = segRaw.map(p => ensurePoint(p)) as [string, string];
          ensureLineByPoints(segRaw[0], segRaw[1]);
          givens.push({ type: "midpoint_of_segment", point: pt, segment: seg });
        }
        break;
      }

      case "point_on_line":
      case "on_line": {
        const pt = ensurePoint(c.point);
        const linePts: [string, string] | null = typeof c.line === "string"
          ? parseLineName(c.line)
          : (c.line as [string, string]);
        if (linePts) {
          ensureLineByPoints(linePts[0], linePts[1]);
          const [a, b] = linePts.map(p => ensurePoint(p)) as [string, string];
          givens.push({ type: "point_on_segment", point: pt, segment: [a, b] });
        }
        break;
      }

      case "right_angle": {
        const [a, v, b] = c.points.map(p => ensurePoint(p)) as [string, string, string];
        givens.push({ type: "right_angle", vertex: v, ray1: a, ray2: b });
        break;
      }

      case "equal_length": {
        const s1 = c.segments[0].map(p => ensurePoint(p)) as [string, string];
        const s2 = c.segments[1].map(p => ensurePoint(p)) as [string, string];
        givens.push({ type: "equal_length", segment1: s1, segment2: s2 });
        break;
      }

      case "equal_angle": {
        const a1 = c.angles[0].map(p => ensurePoint(p)) as [string, string, string];
        const a2 = c.angles[1].map(p => ensurePoint(p)) as [string, string, string];
        givens.push({ type: "equal_angle", angle1: a1, angle2: a2 });
        break;
      }

      case "intersection": {
        const pt = ensurePoint(c.point);
        const l1 = resolveLineRef(c.of[0]);
        const l2 = resolveLineRef(c.of[1]);
        if (l1 && l2) {
          // Stamp construction provenance onto the point entity
          const ptEntity = entities.get(pt);
          if (ptEntity && !ptEntity.construction) {
            (ptEntity as EntityMeta).construction = { type: "intersection_of_lines", line1: l1, line2: l2 };
          }
          givens.push({ type: "intersection_of_lines", point: pt, lines: [l1, l2] });
        }
        break;
      }

      case "collinear":
        c.points.forEach(p => ensurePoint(p));
        break;

      case "passes_through": {
        const pt = ensurePoint(c.point);
        const canonLine = resolveLineRef(c.line);
        void pt;
        void canonLine;
        break;
      }
    }
  }

  // ── Pass 3: Walk constructions → derive objects + more givens ─────────────

  for (const step of dsl.constructions) {
    processConstruction(step);
  }

  function processConstruction(step: DslConstruction): void {
    switch (step.type) {
      case "intersection": {
        const pt = ensurePoint(step.point);
        const l1 = resolveLineRef(step.of[0]);
        const l2 = resolveLineRef(step.of[1]);
        if (l1 && l2) {
          // Stamp construction provenance onto the point entity
          const ptEntity = entities.get(pt);
          if (ptEntity && !ptEntity.construction) {
            (ptEntity as EntityMeta).construction = { type: "intersection_of_lines", line1: l1, line2: l2 };
          }
          givens.push({ type: "intersection_of_lines", point: pt, lines: [l1, l2] });
        }
        break;
      }

      case "draw_perpendicular": {
        // "through P draw perpendicular to line XY" — synthesises a new line
        // and registers it as a perpendicular_through_point given.
        const through = ensurePoint(step.through);
        const toLine = resolveLineRef(step.to);
        const newLineId = (step.line ? ensureLineByName(step.line) : null)
          ?? (() => {
            const id = toLine
              ? `ln_perp_${rawLetter(through)}_to_${toLine}`
              : `ln_perp_${rawLetter(through)}`;
            if (!entities.has(id)) entities.set(id, {
              id, label: step.line ?? null, kind: "line",
              origin: "derived", source: "perpendicular_through_point",
              visible: true, selectable: true,
              construction: { type: "perpendicular_through_point", point: through, to_line: toLine ?? "?" },
            });
            return id;
          })();
        if (toLine) {
          givens.push({ type: "perpendicular_through_point", line: newLineId, point: through, to_line: toLine });
        }
        break;
      }

      case "draw_tangent": {
        const at = ensurePoint(step.at);
        const cid = resolveCircleRef(step.circle);
        const tanFallbackId = `ln_tan_${rawLetter(at)}_on_${cid}`;
        const lineCanonId = ensureLineByName(step.line) ?? tanFallbackId;
        if (!entities.has(lineCanonId)) {
          entities.set(lineCanonId, {
            id: lineCanonId, label: step.line ?? null, kind: "line",
            origin: step.line ? "explicit" : "derived", source: "tangent_at_point",
            visible: true, selectable: true,
            construction: { type: "tangent_at_point", at: at, circle: cid },
          });
        }
        givens.push({ type: "tangent_at_point", circle: cid, line: lineCanonId, point: at });
        break;
      }

      case "draw_parallel": {
        const through = ensurePoint(step.through);
        ensureLineByName(step.line);
        void through;
        break;
      }

      case "perpendicular": {
        // "perpendicular" construction: detect altitude foot pattern.
        // If the second letter of line1 is NOT an endpoint of line2, it is the foot
        // (e.g. AH ⊥ BC where H lies on BC → foot_of_perpendicular from A to BC at H).
        const l2id = typeof step.line2 === "string"
          ? (resolveLineRef(step.line2) ?? step.line2)
          : ensureLineByPoints(step.line2[0], step.line2[1]);
        const l1raw = typeof step.line1 === "string" ? parseLineName(step.line1) : null;
        const l2ent = entities.get(l2id);
        const footDetected = !!l1raw && l2ent?.kind === "line" && !!l2ent.through &&
          l1raw[1] !== rawLetter(l2ent.through[0]) && l1raw[1] !== rawLetter(l2ent.through[1]);

        if (footDetected && l1raw && l2ent?.through) {
          const fromId = mkPointId(l1raw[0]);
          const footId = mkPointId(l1raw[1]);
          ensurePoint(l1raw[0]);
          ensurePoint(l1raw[1]);
          const [baseA, baseB] = l2ent.through as [string, string];
          if (!givens.some(g => g.type === "foot_of_perpendicular" && g.foot === footId)) {
            givens.push({ type: "foot_of_perpendicular", from_point: fromId, to_line: l2id, foot: footId });
            givens.push({ type: "point_on_segment", point: footId, segment: [baseA, baseB] });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // ── Pass 4: Walk targets → goals ──────────────────────────────────────────

  let goalCounter = 0;

  for (const target of dsl.targets) {
    processTarget(target);
  }

  function processTarget(t: DslTarget): void {
    const id = `goal_${String.fromCharCode(97 + goalCounter++)}`;

    switch (t.type) {
      case "tangent": {
        const at = ensurePoint(t.at);
        const cid = resolveCircleRef(t.circle);
        const tanFallbackId = `ln_tan_${rawLetter(at)}_on_${cid}`;
        const lineCanonId = resolveLineRef(t.line) ?? tanFallbackId;
        goals.push({ id, type: "tangent_at_point", circle: cid, line: lineCanonId, point: at });
        break;
      }

      case "perpendicular": {
        const l1 = typeof t.line1 === "string"
          ? (resolveLineRef(t.line1) ?? t.line1)
          : ensureLineByPoints(t.line1[0], t.line1[1]);
        const l2 = typeof t.line2 === "string"
          ? (resolveLineRef(t.line2) ?? t.line2)
          : ensureLineByPoints(t.line2[0], t.line2[1]);

        // Detect altitude/foot pattern: the second letter of line1 is the foot and
        // it is NOT an endpoint of line2 → this is a given (the altitude is declared),
        // not just a goal to prove.  Push foot_of_perpendicular + point_on_segment as givens
        // so canonicalToGeometryModel can solve for the foot position.
        const l1raw = typeof t.line1 === "string" ? parseLineName(t.line1) : null;
        const l2ent = entities.get(l2);
        const footDetected = !!l1raw && l2ent?.kind === "line" && !!l2ent.through &&
          l1raw[1] !== rawLetter(l2ent.through[0]) && l1raw[1] !== rawLetter(l2ent.through[1]);

        if (footDetected && l1raw && l2ent?.through) {
          const fromId   = mkPointId(l1raw[0]);
          const footId   = mkPointId(l1raw[1]);
          ensurePoint(l1raw[0]);
          ensurePoint(l1raw[1]);
          const [baseA, baseB] = l2ent.through as [string, string];
          if (!givens.some(g => g.type === "foot_of_perpendicular" && g.foot === footId)) {
            givens.push({ type: "foot_of_perpendicular", from_point: fromId, to_line: l2, foot: footId });
            givens.push({ type: "point_on_segment", point: footId, segment: [baseA, baseB] });
          }
        } else {
          goals.push({ id, type: "perpendicular_lines", line1: l1, line2: l2 });
        }
        break;
      }

      case "parallel": {
        const l1 = typeof t.line1 === "string"
          ? (resolveLineRef(t.line1) ?? t.line1)
          : ensureLineByPoints(t.line1[0], t.line1[1]);
        const l2 = typeof t.line2 === "string"
          ? (resolveLineRef(t.line2) ?? t.line2)
          : ensureLineByPoints(t.line2[0], t.line2[1]);
        goals.push({ id, type: "parallel_lines", line1: l1, line2: l2 });
        break;
      }

      case "midpoint": {
        const pt = ensurePoint(t.point);
        const segRaw: [string, string] | undefined = Array.isArray(t.segment)
          ? (t.segment as [string, string])
          : (parseLineName(t.segment as string) ?? undefined);
        const seg = segRaw ? segRaw.map(p => ensurePoint(p)) as [string, string] : undefined;
        if (seg) {
          goals.push({ id, type: "midpoint_of_segment", point: pt, segment: seg });
        }
        break;
      }

      case "right_angle":
        goals.push({ id, type: "right_angle_at", point: ensurePoint(t.at) });
        break;

      case "statement":
        goals.push({ id, type: "statement", text: t.text });
        break;

      default:
        break;
    }
  }

  // ── Pass 5: Re-analyse givens to synthesise foot_of_perpendicular entries ─
  // When the DSL has both: perpendicular(EH, CD) AND intersection/point_on_line(H on CD),
  // we can promote the pair to a foot_of_perpendicular given which is cleaner for the
  // canonical representation.
  // Find all perpendicular_lines givens where one line is of the form XH (from X to H)
  // and H already appears as a point_on_segment on the other line.
  const footsAlreadyEmitted = new Set<string>();

  const perpGivens = givens.filter((g): g is Extract<CanonicalGiven, { type: "perpendicular_lines" }> =>
    g.type === "perpendicular_lines"
  );
  const posGivens = givens.filter((g): g is Extract<CanonicalGiven, { type: "point_on_segment" }> =>
    g.type === "point_on_segment"
  );

  for (const perp of perpGivens) {
    // Candidate: line1 = lineIdFromPoints(X,H), line2 = base; H is on base
    for (const [altLineId, baseLineId] of [[perp.line1, perp.line2], [perp.line2, perp.line1]]) {
      const altEntity = entities.get(altLineId);
      if (!altEntity || altEntity.kind !== "line" || !altEntity.through) continue;
      const [fromPt, footPt] = altEntity.through;
      const baseEntity = entities.get(baseLineId);
      if (!baseEntity || baseEntity.kind !== "line" || !baseEntity.through) continue;
      const [baseA, baseB] = baseEntity.through;
      // Confirm footPt is on the base line
      const isOnBase = posGivens.some(
        (p) => p.point === footPt &&
          ((p.segment[0] === baseA && p.segment[1] === baseB) ||
           (p.segment[0] === baseB && p.segment[1] === baseA))
      );
      if (!isOnBase) continue;
      if (footsAlreadyEmitted.has(footPt)) continue;
      footsAlreadyEmitted.add(footPt);
      givens.push({ type: "foot_of_perpendicular", from_point: fromPt, to_line: baseLineId, foot: footPt });
    }
  }

  // ── Pass 6: Analyse goals for "intersection is midpoint" pattern ──────────
  // Pattern: goal states line AD and line BC intersect at midpoint of EH.
  // This is hard to express as a plain statement, so we try to recognise it
  // from statement text and upgrade it to the typed goal if possible.
  for (let i = 0; i < goals.length; i++) {
    const g = goals[i];
    if (g.type !== "statement") continue;
    const text = g.text.toLowerCase();
    // "AD and BC meet/intersect at midpoint of EH"
    const midpointMatch = text.match(
      /\b([a-z]{2})\b.{0,30}\b([a-z]{2})\b.{0,60}midpoint\b.{0,20}\b([a-z]{2})\b/i
    );
    if (!midpointMatch) continue;
    const [, l1raw, l2raw, segRaw] = midpointMatch;
    const l1 = ensureLineByName(l1raw);
    const l2 = ensureLineByName(l2raw);
    const seg = parseLineName(segRaw)?.map(p => ensurePoint(p)) as [string, string] | undefined;
    if (l1 && l2 && seg) {
      goals[i] = {
        id: g.id,
        type: "intersection_is_midpoint_of_segment",
        lines: [l1, l2],
        segment_endpoints: seg
      };
    }
  }

  // ── Pass 7: Emit implicit line_through_points givens for all line entities ─
  // Any line entity that has a `through` pair but no explicit line_through_points given yet.
  const linesWithGivens = new Set<string>(
    givens
      .filter((g): g is Extract<CanonicalGiven, { type: "line_through_points" }> =>
        g.type === "line_through_points"
      )
      .map((g) => g.line)
  );

  for (const entity of entities.values()) {
    if (entity.kind !== "line") continue;
    if (linesWithGivens.has(entity.id)) continue;
    if (!entity.through) continue;
    givens.push({ type: "line_through_points", line: entity.id, points: entity.through });
  }

  // ── Deduplicate givens ────────────────────────────────────────────────────
  const seenGivens = new Set<string>();
  const uniqueGivens = givens.filter((g) => {
    const key = JSON.stringify(g);
    if (seenGivens.has(key)) return false;
    seenGivens.add(key);
    return true;
  });

  return {
    version: "1.0",
    problem_type: "plane_geometry",
    entities: [...entities.values()],
    givens: uniqueGivens,
    goals,
  };
}
