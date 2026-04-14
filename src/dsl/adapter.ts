/**
 * dsl/adapter.ts — DSL → Canonical Geometry IR adapter
 *
 * Converts a GeoMCP model-output DSL object into the engine-internal
 * Canonical Geometry IR understood by the runtime compiler and solver.
 *
 * Flow:
 *   DslIR
 *   → adaptDsl()
 *   → { canonical: CanonicalGeometryIR, freePoints, warnings }
 *   → runFromCanonical()
 *   → SVG
 */
import type { CanonicalEntity, CanonicalGeometryIR, EntityId } from "../canonical/schema.js";
import type { RawDSL, RawObject, RawConstraint } from "./raw-schema.js";
void (0 as unknown as RawObject);

// ── Public output type ────────────────────────────────────────────────────────

export interface AdapterResult {
  canonical:   CanonicalGeometryIR;
  freePoints:  Record<string, { x: number; y: number }>;
  warnings:    string[];
}

// ── Internal context ──────────────────────────────────────────────────────────

class Ctx {
  entities:   CanonicalEntity[] = [];
  freePoints: Record<string, { x: number; y: number }> = {};
  warnings:   string[] = [];

  // Registries: raw name → canonical id
  pointIds = new Map<string, string>();
  lineIds  = new Map<string, string>();
  segIds   = new Map<string, string>(); // key = "A+B" (both orderings are stored)
  circIds  = new Map<string, string>(); // center name → circ id
  angIds   = new Map<string, string>(); // vertex → ang id

  // Deferred segment declarations from objects[] (resolved after all constraints)
  _pendingSegs: Array<[string, string]> = [];
  // Set of point names declared in objects (so we know they're expected)
  _declaredPts = new Set<string>();
  // Set of line names declared in objects[] (resolved after all constraints)
  _declaredLines = new Set<string>();

  _aparIdx = 0;
  readonly _aparAngles = [0.7, 1.4, 2.1, -0.7, -1.4, 2.8];

  // ── Helpers ──────────────────────────────────────────────────────────────

  add(e: CanonicalEntity) { this.entities.push(e); }
  warn(msg: string)       { this.warnings.push(msg); }

  pid(n: string): string   { return `pt.${n}`; }
  lid(n: string): string   { return this.lineIds.get(n) ?? `ln.${n}`; }
  cid(n: string): string   { return this.circIds.get(n) ?? `circ.${n}`; }

  hasPoint(n: string) { return this.pointIds.has(n); }
  hasLine(n: string)  { return this.lineIds.has(n); }
  hasSeg(a: string, b: string) {
    return this.segIds.has(`${a}+${b}`) || this.segIds.has(`${b}+${a}`);
  }

  regPoint(n: string) { this.pointIds.set(n, this.pid(n)); }
  regLine(name: string, id: string) { this.lineIds.set(name, id); }
  regSeg(a: string, b: string, id: string) {
    this.segIds.set(`${a}+${b}`, id);
    this.segIds.set(`${b}+${a}`, id);
  }

  nextApar(): { id: string; value: number } {
    const value = this._aparAngles[this._aparIdx % this._aparAngles.length];
    const id    = `apar.${this._aparIdx++}`;
    return { id, value };
  }

  addFreePoint(n: string, x: number, y: number) {
    if (this.hasPoint(n)) return;
    this.regPoint(n);
    this.add({ id: this.pid(n), kind: "point", label: n, origin: "explicit",
               construction: { type: "free_point" } });
    this.freePoints[this.pid(n)] = { x, y };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addDerivedPoint(n: string, construction: any) {
    if (this.hasPoint(n)) return;
    this.regPoint(n);
    this.add({ id: this.pid(n), kind: "point", label: n, origin: "derived", construction } as CanonicalEntity);
  }

  ensureLineFromPoints(lineName: string, a: string, b: string): string {
    if (this.hasLine(lineName)) return this.lid(lineName);
    const id = `ln.${lineName}`;
    this.regLine(lineName, id);
    this.add({ id, kind: "line", construction: { type: "line_through_points", a: this.pid(a), b: this.pid(b) } });
    return id;
  }

  ensureSegment(a: string, b: string): string {
    if (this.hasSeg(a, b)) return this.segIds.get(`${a}+${b}`) ?? `seg.${a}${b}`;
    const id = `seg.${a}${b}`;
    this.regSeg(a, b, id);
    this.add({ id, kind: "segment", construction: { type: "segment_between_points", a: this.pid(a), b: this.pid(b) } });
    return id;
  }

  // Returns first registered circle id (used for heuristic "through O" inference)
  firstCircleCenter(): string | null {
    const [first] = this.circIds.keys();
    return first ?? null;
  }

  segId(a: string, b: string): string {
    return this.segIds.get(`${a}+${b}`) ?? this.segIds.get(`${b}+${a}`) ?? `seg.${a}${b}`;
  }
}

// ── Line name parsing ─────────────────────────────────────────────────────────

/**
 * Try to parse a 2-char upper-case line name like "AH" → ["A","H"].
 * Returns null for names like "l1", "Cx" (non-2-upper), line names
 * with a lowercase second char, etc.
 */
function parseTwoPointName(name: string): [string, string] | null {
  if (name.length === 2 && /^[A-Z][A-Z]$/.test(name)) return [name[0], name[1]];
  return null;
}

/**
 * For a line name, try to find the canonical line entity id.
 * Creates the line if both named points are already known.
 */
function resolveOrCreateLine(name: string, ctx: Ctx): string | null {
  if (ctx.hasLine(name)) return ctx.lid(name);

  const pts = parseTwoPointName(name);
  if (pts) {
    const [a, b] = pts;
    if (ctx.hasPoint(a) && ctx.hasPoint(b)) {
      return ctx.ensureLineFromPoints(name, a, b);
    }
    // Points not yet known — cannot create now
    return null;
  }

  // Declared line name (e.g. "a", "b", "d") — create as free_line.
  // But first: check x-suffix alias against already-registered lines.
  // "Ax" may be a mistaken name for "Cx" (same suffix 'x') — the tangent
  // at C is already registered by the time any intersection referencing "Ax" runs.
  if (ctx._declaredLines.has(name)) {
    if (/^[A-Z][a-z]$/.test(name)) {
      const suffix = name[1];
      const matches = [...ctx.lineIds.keys()].filter(k => k.length === 2 && k[1] === suffix);
      if (matches.length === 1) {
        ctx.warn(`Declared line "${name}" aliased to existing line "${matches[0]}" (same suffix '${suffix}')`);
        ctx.regLine(name, ctx.lid(matches[0]));
        return ctx.lid(matches[0]);
      }
    }
    const lineId = `ln.${name}`;
    ctx.regLine(name, lineId);
    ctx.add({ id: lineId, kind: "line", label: name,
              construction: { type: "free_line" } } as CanonicalEntity);
    return lineId;
  }

  return null;
}

// ── Object initialisation ─────────────────────────────────────────────────────

const TRIANGLE_DEFAULTS: Array<{ x: number; y: number }> = [
  { x: 1, y: 5 }, { x: -3, y: 0 }, { x: 4, y: 0 },
];

function processObjects(objects: RawObject[], ctx: Ctx) {
  for (const obj of objects) {
    switch (obj.type) {

      case "triangle": {
        const pts = obj.points as string[];
        pts.forEach((p, i) => ctx.addFreePoint(p, TRIANGLE_DEFAULTS[i]?.x ?? i * 2, TRIANGLE_DEFAULTS[i]?.y ?? 0));
        const triId = `tri.${pts.join("")}`;
        ctx.add({ id: triId, kind: "triangle",
                  construction: { type: "triangle_from_points", vertices: [ctx.pid(pts[0]), ctx.pid(pts[1]), ctx.pid(pts[2])] as [EntityId, EntityId, EntityId] } });
        ctx.ensureSegment(pts[0], pts[1]);
        ctx.ensureSegment(pts[1], pts[2]);
        ctx.ensureSegment(pts[2], pts[0]);
        break;
      }

      case "circle": {
        const cn = obj.center as string;
        ctx.addFreePoint(cn, 0, 0);
        const radId = `rpar.${cn}`;
        ctx.add({ id: radId, kind: "radius_parameter", construction: { type: "free_radius", value: 3 } });
        const circId = `circ.${cn}`;
        ctx.circIds.set(cn, circId);
        ctx.add({ id: circId, kind: "circle",
                  construction: { type: "circle_center_radius", center: ctx.pid(cn), radius: radId } });
        break;
      }

      case "point": {
        ctx._declaredPts.add(obj.name as string);
        break;
      }

      case "segment": {
        ctx._pendingSegs.push(obj.points as [string, string]);
        break;
      }

      // line, ray, arc: register the name, handle later
      case "line":
        ctx._declaredLines.add(obj.name as string);
        break;
      case "ray":
        // Just note the name — the construction comes from a constraint
        break;

      // ── Quadrilaterals: rectangle, square, rhombus, parallelogram, etc. ──
      case "rectangle":
      case "square":
      case "rhombus":
      case "parallelogram":
      case "trapezoid":
      case "isosceles_trapezoid":
      case "kite":
      case "polygon": {
        const pts = (obj as any).points as string[] | undefined;
        if (pts && pts.length >= 3) {
          const QUAD_DEFAULTS = [
            { x: -3, y: -2 }, { x:  3, y: -2 },
            { x:  3, y:  2 }, { x: -3, y:  2 },
          ];
          pts.forEach((p: string, i: number) => {
            ctx.addFreePoint(p, QUAD_DEFAULTS[i]?.x ?? (i * 2 - 2), QUAD_DEFAULTS[i]?.y ?? 0);
          });
          // Add sides as segments
          for (let i = 0; i < pts.length; i++) {
            ctx.ensureSegment(pts[i], pts[(i + 1) % pts.length]);
          }
        }
        break;
      }

      default:
        break;
    }
  }
}

// ── Constraint processing ─────────────────────────────────────────────────────

/**
 * For "perpendicular_through_point" pattern with anonymous lines (l1, OA, etc.),
 * guess the "through" point from the line name or from context.
 */
function inferThroughPoint(lineName: string, ctx: Ctx): string | null {
  // If line name starts with an uppercase letter that is a known point → use it
  if (lineName.length >= 1 && /^[A-Z]/.test(lineName[0])) {
    if (ctx.hasPoint(lineName[0])) return lineName[0];
  }
  // Fallback: circle center (for "Qua O kẻ vuông góc" pattern)
  return ctx.firstCircleCenter();
}

function processConstraints(allC: RawConstraint[], ctx: Ctx) {
  // Build lookup of intersection constraints by sorted line-pair key
  const interByPair = new Map<string, RawConstraint[]>();
  for (const c of allC) {
    if (c.type === "intersection") {
      const of = c.of as string[];
      const key = [...of].sort().join("|");
      if (!interByPair.has(key)) interByPair.set(key, []);
      interByPair.get(key)!.push(c);
    }
  }

  // Points that will be defined by an intersection constraint — don't pre-empt them
  // as foot-of-perpendicular when processing a perpendicular constraint.
  const intersectionPoints = new Set<string>(
    allC.filter(c => c.type === "intersection").map(c => (c as any).point as string)
  );

  // Track which constraints have been absorbed
  const absorbed = new Set<RawConstraint>();

  for (const c of allC) {
    if (absorbed.has(c)) continue;

    switch (c.type) {

      // ── midpoint ──────────────────────────────────────────────────────────
      case "midpoint": {
        const { point, of: [a, b] } = c as { point: string; of: [string, string] };

        // Pattern: of: ["A", "BC"] — vertex + 2-char segment name.
        // Semantic: M = midpoint(B,C) and seg.AM is the median from A.
        // Auto-create seg.AM unless it already exists from an explicit segment object.
        const segPts = parseTwoPointName(b);
        if (segPts) {
          const [p1, p2] = segPts;
          if (!ctx.hasPoint(p1)) ctx.addFreePoint(p1, -2, 0);
          if (!ctx.hasPoint(p2)) ctx.addFreePoint(p2,  2, 0);
          ctx.addDerivedPoint(point, { type: "midpoint", a: ctx.pid(p1), b: ctx.pid(p2) } as any);
          // Create the median segment (vertex → midpoint) if not already declared
          if (!ctx.hasPoint(a)) ctx.addFreePoint(a, 0, 3);
          ctx.ensureSegment(a, point);
          absorbed.add(c);
          break;
        }

        if (!ctx.hasPoint(a)) ctx.addFreePoint(a, -2, 0);
        if (!ctx.hasPoint(b)) ctx.addFreePoint(b,  2, 0);
        ctx.addDerivedPoint(point, { type: "midpoint", a: ctx.pid(a), b: ctx.pid(b) } as any);
        absorbed.add(c);
        break;
      }

      // ── perpendicular ─────────────────────────────────────────────────────
      case "perpendicular": {
        const line1Name  = c.line1 as string;
        const line2Name  = c.line2 as string;
        // "intersect-at" (preferred) or legacy "at": the foot point where line1 meets line2.
        const atFoot     = ((c as any)["intersect-at"] ?? (c as any).at) as string | undefined;
        // "through": line1 passes through this point (auxiliary perpendicular construction).
        const throughPt  = (c as any).through as string | undefined;

        // ── "through" shorthand: {"type":"perpendicular","line1":"l1","line2":"CE","through":"O"}
        // Means: create line l1 through O, perpendicular to CE. No foot point needed.
        if (throughPt && !parseTwoPointName(line1Name)) {
          if (!ctx.hasLine(line2Name)) {
            const pts2 = parseTwoPointName(line2Name);
            if (pts2 && ctx.hasPoint(pts2[0]) && ctx.hasPoint(pts2[1])) {
              ctx.ensureLineFromPoints(line2Name, pts2[0], pts2[1]);
            }
          }
          if (ctx.hasPoint(throughPt) && ctx.hasLine(line2Name) && !ctx.hasLine(line1Name)) {
            const line1Id = `ln.${line1Name}`;
            ctx.regLine(line1Name, line1Id);
            ctx.add({ id: line1Id, kind: "line",
                      construction: { type: "perpendicular_through_point",
                                      point: ctx.pid(throughPt), toLine: ctx.lid(line2Name) } });
          }
          absorbed.add(c);
          break;
        }

        // ── "intersect-at" shorthand: {"type":"perpendicular","line1":"EH","line2":"CD","intersect-at":"H"}
        // Means: EH ⊥ CD and H is the foot. No separate intersection needed.
        // H may already exist as a free point (declared in objects) — promote it.
        if (atFoot && (!ctx.hasPoint(atFoot) || ctx.freePoints[ctx.pid(atFoot)] !== undefined)) {
          // Ensure line2 exists
          if (!ctx.hasLine(line2Name)) {
            const pts2 = parseTwoPointName(line2Name);
            if (pts2 && ctx.hasPoint(pts2[0]) && ctx.hasPoint(pts2[1])) {
              ctx.ensureLineFromPoints(line2Name, pts2[0], pts2[1]);
            }
          }
          const pts1 = parseTwoPointName(line1Name);
          if (pts1 && ctx.hasLine(line2Name)) {
            const fromName = pts1[0] === atFoot ? pts1[1] : pts1[0];
            if (ctx.hasPoint(fromName)) {
              const footId = ctx.pid(atFoot);
              if (ctx.freePoints[footId] !== undefined) {
                // Promote free point → foot_of_perpendicular derived point
                delete ctx.freePoints[footId];
                const idx = ctx.entities.findIndex(e => e.id === footId);
                const construction = { type: "foot_of_perpendicular",
                  fromPoint: ctx.pid(fromName), toLine: ctx.lid(line2Name) };
                if (idx >= 0) {
                  ctx.entities[idx] = { id: footId, kind: "point", label: atFoot,
                    origin: "derived", construction } as CanonicalEntity;
                }
              } else {
                ctx.addDerivedPoint(atFoot, { type: "foot_of_perpendicular",
                  fromPoint: ctx.pid(fromName), toLine: ctx.lid(line2Name) } as any);
              }
              ctx.ensureLineFromPoints(line1Name, fromName, atFoot);
              ctx.ensureSegment(fromName, atFoot);
              absorbed.add(c);
              break;
            }
          }
        }

        const key = [line1Name, line2Name].sort().join("|");
        const matchingInter = (interByPair.get(key) ?? []).find(i => !absorbed.has(i));

        // Ensure line2 is created
        if (!ctx.hasLine(line2Name)) {
          const pts2 = parseTwoPointName(line2Name);
          if (pts2 && ctx.hasPoint(pts2[0]) && ctx.hasPoint(pts2[1])) {
            ctx.ensureLineFromPoints(line2Name, pts2[0], pts2[1]);
          }
        }

        const pts1 = parseTwoPointName(line1Name); // e.g. ["A","H"]

        if (matchingInter) {
          absorbed.add(matchingInter);
          const footName = (matchingInter as Record<string, unknown>).point as string;

          if (pts1) {
            // "AH ⊥ BC" → H = foot_of_perpendicular from A on ln.BC
            const fromName = pts1[0] === footName ? pts1[1] : pts1[0];
            const line2Id  = ctx.lid(line2Name);
            ctx.addDerivedPoint(footName, { type: "foot_of_perpendicular", fromPoint: ctx.pid(fromName), toLine: line2Id } as any);
            // Register line1 as line through fromName and footName (available now)
            const line1Id = `ln.${line1Name}`;
            ctx.regLine(line1Name, line1Id);
            ctx.add({ id: line1Id, kind: "line",
                      construction: { type: "line_through_points", a: ctx.pid(fromName), b: ctx.pid(footName) } });
          } else {
            // Anonymous line (l1, OA, ...) ⊥ line2 — find through-point
            const throughName = (throughPt ?? inferThroughPoint(line1Name, ctx));
            const line2Id = ctx.lid(line2Name);
            if (throughName && ctx.hasPoint(throughName)) {
              if (!ctx.hasLine(line1Name)) {
                const line1Id = `ln.${line1Name}`;
                ctx.regLine(line1Name, line1Id);
                ctx.add({ id: line1Id, kind: "line",
                          construction: { type: "perpendicular_through_point", point: ctx.pid(throughName), toLine: line2Id } });
              }
              ctx.addDerivedPoint(footName, { type: "line_intersection", line1: ctx.lid(line1Name), line2: line2Id } as any);
            } else {
              ctx.warn(`Cannot resolve perpendicular origin for "${line1Name}" ⊥ "${line2Name}"`);
            }
          }
        } else {
          // No matching intersection.
          if (pts1) {
            const [a, b] = pts1;
            if (ctx.hasPoint(a) && !ctx.hasPoint(b)) {
              // Ensure line2 exists
              if (!ctx.hasLine(line2Name)) {
                const pts2 = parseTwoPointName(line2Name);
                if (pts2 && ctx.hasPoint(pts2[0]) && ctx.hasPoint(pts2[1])) {
                  ctx.ensureLineFromPoints(line2Name, pts2[0], pts2[1]);
                }
              }
              // Degenerate-foot guard: if 'a' is a named endpoint of line2
              // (e.g. "DH ⊥ CD" → D is on CD), foot_of_perpendicular(a, line2) = a itself.
              // Instead create line1 as perpendicular_through_point and b as point_on_line.
              const pts2chars = parseTwoPointName(line2Name);
              const fromIsOnLine2 = pts2chars && (pts2chars[0] === a || pts2chars[1] === a);

              // Deferred-point guard: if b will be defined by an intersection constraint,
              // only create the perpendicular line here and let the intersection pin b.
              // e.g. "OA ⊥ CE" + "A = OA ∩ Cx" → don't make A = foot(O, CE).
              const bDefinedByIntersection = intersectionPoints.has(b);

              if (bDefinedByIntersection) {
                // Just create line1 as perpendicular_through_point; b comes from intersection.
                if (!ctx.hasLine(line1Name)) {
                  const line1Id = `ln.${line1Name}`;
                  ctx.regLine(line1Name, line1Id);
                  ctx.add({ id: line1Id, kind: "line",
                            construction: { type: "perpendicular_through_point",
                                            point: ctx.pid(a), toLine: ctx.lid(line2Name) } });
                }
              } else if (fromIsOnLine2) {
                // Create line1 as perpendicular through a, then b as a free point on that line
                if (!ctx.hasLine(line1Name)) {
                  const line1Id = `ln.${line1Name}`;
                  ctx.regLine(line1Name, line1Id);
                  ctx.add({ id: line1Id, kind: "line",
                            construction: { type: "perpendicular_through_point",
                                            point: ctx.pid(a), toLine: ctx.lid(line2Name) } });
                }
                ctx.addDerivedPoint(b, { type: "point_on_line", line: ctx.lid(line1Name), t: 0.4 } as any);
                ctx.ensureSegment(a, b);
              } else {
                // Pattern: "EH ⊥ CD" — b is the foot of perpendicular from a onto line2.
                ctx.addDerivedPoint(b, { type: "foot_of_perpendicular", fromPoint: ctx.pid(a), toLine: ctx.lid(line2Name) } as any);
                ctx.ensureSegment(a, b);
              }
            } else if (ctx.hasPoint(a) && ctx.hasPoint(b)) {
              ctx.ensureLineFromPoints(line1Name, a, b);
            }
          } else {
            const throughName = (throughPt ?? inferThroughPoint(line1Name, ctx));
            const line2Id = ctx.lid(line2Name);
            if (throughName && ctx.hasPoint(throughName) && !ctx.hasLine(line1Name)) {
              const line1Id = `ln.${line1Name}`;
              ctx.regLine(line1Name, line1Id);
              ctx.add({ id: line1Id, kind: "line",
                        construction: { type: "perpendicular_through_point", point: ctx.pid(throughName), toLine: line2Id } });
            }
          }
        }
        absorbed.add(c);
        break;
      }

      // ── diameter ──────────────────────────────────────────────────────────
      case "diameter": {
        const { circle: cn, points: [p1, p2] } = c as { circle: string; points: [string, string] };
        const circId = ctx.cid(cn);

        // First endpoint: point_on_circle at angle π (left side)
        if (!ctx.hasPoint(p1)) {
          const ap = { id: `apar.${p1}`, value: Math.PI };
          ctx.add({ id: ap.id, kind: "angle_parameter", construction: { type: "free_angle", value: ap.value } } as CanonicalEntity);
          ctx.addDerivedPoint(p1, { type: "point_on_circle", circle: circId, angle: ap.id } as any);
        }
        // Second endpoint: antipode
        if (!ctx.hasPoint(p2)) {
          ctx.addDerivedPoint(p2, { type: "antipode", circle: circId, point: ctx.pid(p1) } as any);
        }
        // Diameter segment
        ctx.ensureSegment(p1, p2);
        absorbed.add(c);
        break;
      }

      // ── on_circle ─────────────────────────────────────────────────────────
      case "on_circle": {
        const { point: pn, circle: cn } = c as { point: string; circle: string };
        if (!ctx.hasPoint(pn)) {
          const ap = ctx.nextApar();
          ctx.add({ id: ap.id, kind: "angle_parameter", construction: { type: "free_angle", value: ap.value } } as CanonicalEntity);
          ctx.addDerivedPoint(pn, { type: "point_on_circle", circle: ctx.cid(cn), angle: ap.id } as any);
        }
        absorbed.add(c);
        break;
      }

      // ── tangent ───────────────────────────────────────────────────────────
      case "tangent": {
        const { at, line: ln, circle: rawCn } = c as { at: string; line: string; circle?: string };
        // If circle is missing, infer from the only known circle (common in problems with one circle)
        const cn = rawCn ?? ctx.firstCircleCenter() ?? undefined;
        if (!ctx.hasLine(ln)) {
          // Ensure the touch-point exists
          if (!ctx.hasPoint(at)) ctx.addFreePoint(at, 3, 0);
          const id = `ln.${ln}`;
          ctx.regLine(ln, id);
          if (cn) {
            ctx.add({ id, kind: "line",
                      construction: { type: "tangent_at_point", circle: ctx.cid(cn), point: ctx.pid(at) } });
          } else {
            // No circle known — fall back to free line and warn
            ctx.warn(`tangent "${ln}" at "${at}": no circle specified or inferrable; treated as free line`);
            ctx.add({ id, kind: "line", label: ln, construction: { type: "free_line" } } as CanonicalEntity);
          }
        }
        absorbed.add(c);
        break;
      }

      // ── equal_angle (bisector pattern) ────────────────────────────────────
      case "equal_angle": {
        // Normalize {at, lines} format → {angles} format
        // LLM sometimes emits: { type:"equal_angle", at:"V", lines:["VI","VA","VB"] }
        let rawAngles = (c as any).angles as [string,string,string][] | undefined;
        if (!rawAngles) {
          const at = (c as any).at as string | undefined;
          const lines = (c as any).lines as string[] | undefined;
          if (at && lines && lines.length >= 2) {
            // Extract the far endpoint of each 2-char line name (e.g. "VI" → "I")
            const pts = lines.map(l => (l.length === 2 && l[0] === at) ? l[1] : l);
            if (pts.length >= 3) {
              rawAngles = [[pts[0], at, pts[1]], [pts[1], at, pts[2]]];
            } else {
              rawAngles = [[pts[0], at, pts[1]]];
            }
          }
        }
        const angles = rawAngles ?? [];
        // Detect bisector: two equal angles sharing a vertex and one common arm
        if (angles.length === 2) {
          const [α, β] = angles;
          // Both must share the same middle (vertex)
          if (α[1] === β[1]) {
            const vertex = α[1];
            // Shared arm is the common endpoint of both triples (not the vertex)
            const armsA = new Set([α[0], α[2]]);
            const armsB = new Set([β[0], β[2]]);
            const sharedArms  = [...armsA].filter(x => armsB.has(x)); // bisector endpoint
            const outerArm_α  = [...armsA].find(x => !armsB.has(x));
            const outerArm_β  = [...armsB].find(x => !armsA.has(x));

            if (sharedArms.length === 1 && outerArm_α && outerArm_β) {
              const footName = sharedArms[0]; // the bisector foot
              // angle is A-vertex-B (the full angle)
              const angId = `ang.${vertex}`;
              if (!ctx.angIds.has(vertex)) {
                ctx.angIds.set(vertex, angId);
                ctx.add({ id: angId, kind: "angle",
                          construction: { type: "angle_from_points",
                                          points: [ctx.pid(outerArm_α), ctx.pid(vertex), ctx.pid(outerArm_β)] } });
              }
              // Find the opposite segment (e.g. AB for bisector from C)
              // The foot is on the segment connecting the two outer arms
              const oppSegId = ctx.ensureSegment(outerArm_α, outerArm_β);
              ctx.addDerivedPoint(footName, {
                type: "angle_bisector_foot",
                vertex: ctx.pid(vertex),
                angle: angId,
                toSegment: oppSegId,
              } as any);
            }
          }
        }
        absorbed.add(c);
        break;
      }

      // ── intersection (not yet absorbed) ───────────────────────────────────
      case "intersection": {
        const { point, of: [l1Name, l2Name] } = c as unknown as { point: string; of: [string, string] };
        if (!ctx.hasPoint(point)) {
          // Ensure lines exist first
          const l1Id = resolveOrCreateLine(l1Name, ctx);
          const l2Id = resolveOrCreateLine(l2Name, ctx);
          if (l1Id && l2Id) {
            ctx.addDerivedPoint(point, { type: "line_intersection", line1: l1Id, line2: l2Id } as any);
          } else {
            ctx.warn(`Cannot resolve intersection of "${l1Name}" and "${l2Name}" — line(s) not yet defined`);
          }
        }
        absorbed.add(c);
        break;
      }

      // ── segment in constraints array ──────────────────────────────────────
      case "segment": {
        const [a, b] = c.points as [string, string];
        if (ctx.hasPoint(a) && ctx.hasPoint(b)) ctx.ensureSegment(a, b);
        else ctx._pendingSegs.push([a, b]);
        absorbed.add(c);
        break;
      }

      // ── on_line ───────────────────────────────────────────────────────────
      case "on_line": {
        const { point: pn, line: ln } = c as { point: string; line: string };
        // Ensure the line exists as a free_line entity
        if (!ctx.hasLine(ln)) {
          const lineId = `ln.${ln}`;
          ctx.regLine(ln, lineId);
          ctx.add({ id: lineId, kind: "line", label: ln,
                    construction: { type: "free_line" } } as CanonicalEntity);
        }
        // Create point as lying on that line with embedded t parameter
        if (!ctx.hasPoint(pn)) {
          ctx.addDerivedPoint(pn, { type: "point_on_line", line: ctx.lid(ln), t: 0.4 } as any);
        }
        absorbed.add(c);
        break;
      }

      // ── median ────────────────────────────────────────────────────────────
      // { type:"median", from_vertex:"A", to_midpoint:"M", of_side:"BC" }
      case "median": {
        const fromVertex  = (c as any).from_vertex  as string | undefined;
        const toMidpoint  = (c as any).to_midpoint  as string | undefined;
        const ofSide      = (c as any).of_side      as string | undefined;
        if (fromVertex && toMidpoint && ofSide) {
          const sidePts = parseTwoPointName(ofSide);
          if (sidePts) {
            const [p1, p2] = sidePts;
            if (!ctx.hasPoint(toMidpoint)) {
              ctx.addDerivedPoint(toMidpoint, { type: "midpoint", a: ctx.pid(p1), b: ctx.pid(p2) } as any);
            }
            ctx.ensureSegment(fromVertex, toMidpoint);
          }
        }
        absorbed.add(c);
        break;
      }

      // ── bisector ──────────────────────────────────────────────────────────
      // { type:"bisector", from_vertex:"B", to_point:"K", on_opposite_side:"AC" }
      case "bisector": {
        const fromVertex    = (c as any).from_vertex       as string | undefined;
        const toPoint       = (c as any).to_point          as string | undefined;
        const onOppSide     = (c as any).on_opposite_side  as string | undefined;
        if (fromVertex && toPoint && onOppSide) {
          const sidePts = parseTwoPointName(onOppSide);
          if (sidePts) {
            const [p1, p2] = sidePts;
            const angId = `ang.${fromVertex}`;
            if (!ctx.angIds.has(fromVertex)) {
              ctx.angIds.set(fromVertex, angId);
              ctx.add({ id: angId, kind: "angle",
                        construction: { type: "angle_from_points",
                                        points: [ctx.pid(p1), ctx.pid(fromVertex), ctx.pid(p2)] } });
            }
            const oppSegId = ctx.ensureSegment(p1, p2);
            if (!ctx.hasPoint(toPoint)) {
              ctx.addDerivedPoint(toPoint, {
                type: "angle_bisector_foot",
                vertex: ctx.pid(fromVertex),
                angle: angId,
                toSegment: oppSegId,
              } as any);
            }
            ctx.ensureSegment(fromVertex, toPoint);
          }
        }
        absorbed.add(c);
        break;
      }

      default:
        // Silently skip unknown constraint types
        break;
    }
  }
}

// ── Post-processing ───────────────────────────────────────────────────────────

/** After all constraints, resolve any pending segments and declared free points. */
function postProcess(ctx: Ctx) {
  // Ensure all declared points that were never resolved get a free position
  for (const name of ctx._declaredPts) {
    if (!ctx.hasPoint(name)) {
      ctx.addFreePoint(name, Math.random() * 4 - 2, Math.random() * 4 - 2);
      ctx.warn(`Point "${name}" was declared but never given a construction — treated as free point`);
    }
  }

  // Create line entities for any declared line not yet built by a constraint.
  // If both endpoint-points now exist (e.g. EH after H was created by foot_of_perp),
  // use line_through_points; only fall back to free_line when they're truly unknown.
  for (const ln of ctx._declaredLines) {
    if (ctx.hasLine(ln)) continue;
    const pts = parseTwoPointName(ln);
    if (pts && ctx.hasPoint(pts[0]) && ctx.hasPoint(pts[1])) {
      ctx.ensureLineFromPoints(ln, pts[0], pts[1]);
    } else {
      const lineId = `ln.${ln}`;
      ctx.regLine(ln, lineId);
      ctx.add({ id: lineId, kind: "line", label: ln,
                construction: { type: "free_line" } } as CanonicalEntity);
    }
  }

  // Resolve pending segment declarations
  for (const [a, b] of ctx._pendingSegs) {
    if (ctx.hasPoint(a) && ctx.hasPoint(b) && !ctx.hasSeg(a, b)) {
      ctx.ensureSegment(a, b);
    }
  }
}

/**
 * Scan the raw targets array for any two-uppercase-letter names (e.g. "AC", "BD", "AB")
 * and auto-create segments for them when both named points are known.
 * Handles:
 *   - { type: "statement", text: "AC + BD = AB" }  → extracts AC, BD, AB
 *   - { type: "right_angle", triangle: "AOB" }      → extracts AO, OB, AB
 *   - any string field on any target object
 */
function createSegmentsFromTargets(targets: unknown[], ctx: Ctx) {
  const twoUpperRe = /\b([A-Z]{2})\b/g;

  function scanText(text: string) {
    for (const m of text.matchAll(twoUpperRe)) {
      const [a, b] = [m[1][0], m[1][1]];
      if (ctx.hasPoint(a) && ctx.hasPoint(b) && !ctx.hasSeg(a, b)) {
        ctx.ensureSegment(a, b);
      }
    }
  }

  function scanTriple(name: string) {
    // e.g. "AOB" → pairs AO, OB, AB
    if (/^[A-Z]{3}$/.test(name)) {
      for (let i = 0; i < 3; i++) {
        const a = name[i], b = name[(i + 1) % 3];
        if (ctx.hasPoint(a) && ctx.hasPoint(b) && !ctx.hasSeg(a, b)) {
          ctx.ensureSegment(a, b);
        }
      }
    }
  }

  for (const t of targets) {
    if (!t || typeof t !== "object") continue;
    for (const [key, val] of Object.entries(t as Record<string, unknown>)) {
      if (typeof val !== "string") continue;
      if (key === "triangle" || key === "vertices") {
        scanTriple(val);
      } else {
        scanText(val);
      }
    }
  }
}

/**
 * Scan targets for { type:"midpoint", point:"N", segment:["E","H"] }.
 * When point N is still a free point (not geometrically derived) but both
 * segment endpoints are known, replace N's entity with a derived midpoint
 * so the solver places it at the correct geometric position.
 */
function promoteMidpointTargets(targets: unknown[], ctx: Ctx) {
  for (const t of targets) {
    if (!t || typeof t !== "object") continue;
    const target = t as Record<string, unknown>;
    if (target.type !== "midpoint") continue;

    const point   = target.point   as string | undefined;
    const segment = target.segment as unknown;
    if (!point || !segment) continue;

    // Normalise segment to [a, b]
    let a: string, b: string;
    if (Array.isArray(segment) && segment.length === 2) {
      [a, b] = segment as [string, string];
    } else if (typeof segment === "string" && segment.length === 2) {
      [a, b] = [segment[0], segment[1]];
    } else {
      continue;
    }

    // Only promote when: N is a free point AND both endpoints are known
    const ptId = ctx.pid(point);
    if (ctx.freePoints[ptId] === undefined) continue; // already derived
    if (!ctx.hasPoint(a) || !ctx.hasPoint(b)) continue;

    // Replace free-point entity with a derived midpoint
    delete ctx.freePoints[ptId];
    const idx = ctx.entities.findIndex(e => e.id === ptId);
    if (idx >= 0) {
      ctx.entities[idx] = {
        id: ptId, kind: "point", label: point, origin: "derived",
        construction: { type: "midpoint", a: ctx.pid(a), b: ctx.pid(b) },
      } as CanonicalEntity;
    }
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Step 6 repair: fill in geometric constructions the LLM forgot to emit.
 *
 * (a) PERPENDICULAR FOOT repair:
 *     For every declared segment XY where X is a point_on_circle and Y is still
 *     a free point, and a diameter line exists — place Y as foot_of_perpendicular
 *     from X onto the diameter line.
 *
 * (b) TANGENT repair:
 *     For every declared line whose name matches the pattern "[P]t" (e.g. "Dt")
 *     where P is a point_on_circle — add a tangent entity for that line if none
 *     was created by the tangent constraint handler.
 */
function repairOrphanFootFromTargets(ctx: Ctx, targets: unknown[], diameterLineId: string | null): void {
  if (!diameterLineId) return;
  for (const t of targets) {
    if (!t || typeof t !== "object") continue;
    const target = t as Record<string, unknown>;
    if (target.type !== "midpoint") continue;
    const seg = target.segment;
    if (!Array.isArray(seg) || seg.length !== 2) continue;
    const [a, b] = seg as [string, string];
    // Try both orderings: find which is on_circle and which is free
    for (const [srcName, footName] of [[a, b], [b, a]]) {
      const srcEnt = ctx.entities.find(e => e.id === ctx.pid(srcName));
      const footId = ctx.pid(footName);
      if (!srcEnt || ctx.freePoints[footId] === undefined) continue;
      if ((srcEnt.construction as any)?.type !== "point_on_circle") continue;
      const srcAngleId = (srcEnt.construction as any)?.angle as string | undefined;
      if (srcAngleId === `apar.${srcName}`) continue; // diameter endpoint
      // Repair: place foot as foot_of_perpendicular from src onto diameter
      delete ctx.freePoints[footId];
      const idx = ctx.entities.findIndex(e => e.id === footId);
      const construction = { type: "foot_of_perpendicular",
        fromPoint: ctx.pid(srcName), toLine: diameterLineId };
      if (idx >= 0) {
        ctx.entities[idx] = { id: footId, kind: "point", label: footName,
          origin: "derived", construction } as CanonicalEntity;
      }
      ctx.ensureLineFromPoints(`${srcName}${footName}`, srcName, footName);
      ctx.ensureSegment(srcName, footName);
      ctx.warn(`[repair] placed ${footName} as foot_of_perpendicular from ${srcName} onto diameter (via midpoint target)`);
      break;
    }
  }
}

function repairMissingGeometry(ctx: Ctx, targets: unknown[]): void {
  // Find the two diameter point names:
  //   p1 = point_on_circle where angle param is named "apar.{p1}" (fixed at π)
  //   p2 = antipode of p1
  let diamP1: string | null = null;
  let diamP2: string | null = null;
  for (const [ptName] of ctx.pointIds) {
    const ent = ctx.entities.find(e => e.id === ctx.pid(ptName));
    if (!ent) continue;
    const c = ent.construction as any;
    if (c?.type === "point_on_circle" && c?.angle === `apar.${ptName}`) {
      diamP1 = ptName;
    } else if (c?.type === "antipode") {
      diamP2 = ptName;
    }
  }

  // Ensure a line entity exists for the diameter (CD), creating it if needed.
  let diameterLineId: string | null = null;
  if (diamP1 && diamP2) {
    const lineName = `${diamP1}${diamP2}`;
    diameterLineId = ctx.ensureLineFromPoints(lineName, diamP1, diamP2);
  }

  // (a) Perpendicular foot repair
  if (diameterLineId) {
    // segIds keys are "A+B" (raw point names, no pt. prefix)
    const visited = new Set<string>();
    for (const ab of ctx.segIds.keys()) {
      const plus = ab.indexOf("+");
      if (plus < 0) continue;
      const aName = ab.slice(0, plus);
      const bName = ab.slice(plus + 1);
      const pairKey = [aName, bName].sort().join("+");
      if (visited.has(pairKey)) continue;
      visited.add(pairKey);

      // Check each ordered pair (source, foot)
      for (const [srcName, footName] of [[aName, bName], [bName, aName]]) {
        const srcEnt = ctx.entities.find(e => e.id === ctx.pid(srcName));
        const footId = ctx.pid(footName);
        if (!srcEnt || ctx.freePoints[footId] === undefined) continue;
        if ((srcEnt.construction as any)?.type !== "point_on_circle") continue;

        // Skip diameter endpoints — their angle param is named after themselves (apar.C)
        // Generic on-circle points (E) use numeric angle params (apar.0, apar.1, …)
        const srcAngleId = (srcEnt.construction as any)?.angle as string | undefined;
        if (srcAngleId === `apar.${srcName}`) continue; // diameter endpoint, not a foot source

        // footName is free and srcName is on circle — place foot on diameter
        delete ctx.freePoints[footId];
        const idx = ctx.entities.findIndex(e => e.id === footId);
        const construction = { type: "foot_of_perpendicular",
          fromPoint: ctx.pid(srcName), toLine: diameterLineId };
        if (idx >= 0) {
          ctx.entities[idx] = { id: footId, kind: "point", label: footName,
            origin: "derived", construction } as CanonicalEntity;
        }
        // Ensure the line and segment exist
        ctx.ensureLineFromPoints(`${srcName}${footName}`, srcName, footName);
        ctx.ensureSegment(srcName, footName);
        ctx.warn(`[repair] placed ${footName} as foot_of_perpendicular from ${srcName} onto diameter`);
        break; // only repair each foot once
      }
    }
    // Also scan midpoint targets for foot points not declared as segments
    repairOrphanFootFromTargets(ctx, targets, diameterLineId);
  }

  // (b) Tangent repair: line "Dt" where D is point_on_circle
  for (const [lineName, lineId] of ctx.lineIds) {
    if (lineName.length !== 2 || lineName[1] !== "t") continue;
    const ptName = lineName[0];
    if (!ctx.hasPoint(ptName)) continue;
    const ptEnt = ctx.entities.find(e => e.id === ctx.pid(ptName));
    const ptType = (ptEnt?.construction as any)?.type;
    if (ptType !== "point_on_circle" && ptType !== "antipode") continue;

    // Check if a tangent entity already exists for this line
    const alreadyHasTangent = ctx.entities.some(e =>
      e.kind === "line" && (e.construction as any)?.type === "tangent_at_point"
    );
    void alreadyHasTangent;
    // More specifically: check if the line is already a tangent_at_point
    const lineEnt = ctx.entities.find(e => e.id === lineId);
    if ((lineEnt?.construction as any)?.type === "tangent_at_point") continue;

    // Find the circle
    const circId = (ptEnt?.construction as any)?.circle;
    if (!circId) continue;

    // Replace free_line with tangent_at_point
    const idx = ctx.entities.findIndex(e => e.id === lineId);
    if (idx >= 0 && (ctx.entities[idx].construction as any)?.type === "free_line") {
      ctx.entities[idx] = { id: lineId, kind: "line", label: lineName,
        construction: { type: "tangent_at_point", circle: circId, point: ctx.pid(ptName) }
      } as unknown as CanonicalEntity;
      ctx.warn(`[repair] replaced free_line "${lineName}" with tangent_at_point at ${ptName}`);
    }
  }
}

export function adaptDsl(dsl: RawDSL): AdapterResult {
  const ctx = new Ctx();

  // 1. Process object declarations (circles and triangles first)
  processObjects(dsl.objects, ctx);

  // 2. Process constraints + constructions together
  const allC = [...(dsl.constraints ?? []), ...(dsl.constructions ?? [])];
  processConstraints(allC, ctx);

  // 3. Post-processing
  postProcess(ctx);

  // 4. Auto-create segments mentioned in targets (e.g. "AC + BD = AB", triangle "AOB")
  createSegmentsFromTargets(dsl.targets ?? [], ctx);

  // 5. Promote midpoint targets: if a target says "N = midpoint(E,H)" and N is
  //    still a free point, derive its position geometrically from E and H.
  promoteMidpointTargets(dsl.targets ?? [], ctx);

  // 6. Repair geometry the LLM forgot: perpendicular feet and tangent lines.
  repairMissingGeometry(ctx, dsl.targets ?? []);

  return {
    canonical:  { version: "canonical-geometry/v1", entities: ctx.entities },
    freePoints: ctx.freePoints,
    warnings:   ctx.warnings,
  };
}
