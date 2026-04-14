/**
 * solver/recompute.ts — Geometry math solver for the Runtime Constraint Graph.
 *
 * Receives a RuntimeGraph + current SolvedState + the id of a node that
 * changed (free_point moved, parameter adjusted), propagates the change to
 * all transitively dependent nodes, and returns an updated SolvedState.
 *
 * Caller contract:
 *   • Before calling recompute(), update state for the changed node.
 *   • recompute() will NOT touch the changed node's entry — only downstream.
 *
 * Supported geometry:
 *   Points  : free_point, midpoint, line_intersection, foot_of_perpendicular,
 *             angle_bisector_foot, circumcenter, incenter, centroid, orthocenter,
 *             point_on_circle, reflection, translation
 *   Lines   : line_through_points, parallel_through_point,
 *             perpendicular_through_point, tangent_at_point, perpendicular_bisector
 *   Rays    : ray_from_point_through, angle_bisector
 *   Circles : circle_center_radius, circle_center_through_point,
 *             circumscribed, inscribed
 *   Params  : not recomputed (externally set)
 *   Structural (segment, triangle, angle): no geometry state
 */

import type {
  RuntimeGraph,
  RuntimeNode,
  RuntimePointNode,
  RuntimeLineNode,
  RuntimeRayNode,
  RuntimeCircleNode,
  RuntimeVectorNode,
  RuntimeStructuralNode,
  NodeId,
} from "../runtime/schema.js";

// ── Solved value types ────────────────────────────────────────────────────────

export interface SolvedPoint  { kind: "point";  x: number; y: number }
export interface SolvedLine   { kind: "line";   px: number; py: number; dx: number; dy: number }
export interface SolvedRay    { kind: "ray";    px: number; py: number; dx: number; dy: number }
export interface SolvedCircle { kind: "circle"; cx: number; cy: number; r: number }
export interface SolvedParam  { kind: "param";  value: number }

export interface SolvedVector { kind: "vector"; dx: number; dy: number }

export type SolvedValue = SolvedPoint | SolvedLine | SolvedRay | SolvedCircle | SolvedParam | SolvedVector;
export type SolvedState = Map<NodeId, SolvedValue>;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Solve all nodes in the graph that are not yet present in `state`.
 *
 * Iterates `graph.nodes` (topologically sorted, roots first) so that each
 * node's dependencies are resolved before the node itself.  Nodes already in
 * `state` (free points, parameters) are left untouched.
 *
 * @returns The same `state` map, mutated with computed values.
 */
export function solveAll(graph: RuntimeGraph, state: SolvedState): SolvedState {
  for (const node of graph.nodes) {
    if (state.has(node.id)) continue;
    const val = solveNode(node, state, graph);
    if (val !== null) state.set(node.id, val);
  }
  return state;
}

/**
 * Recompute all nodes transitively downstream of `dirtyId`.
 *
 * The caller must have already updated `state.get(dirtyId)` before calling.
 * Iterates `graph.nodes` (topologically sorted, roots first) and updates
 * every node in the transitive downstream set.
 *
 * @returns The same `state` map, mutated with new values.
 */
export function recompute(
  graph: RuntimeGraph,
  state: SolvedState,
  dirtyId: NodeId,
): SolvedState {
  // BFS over downstream map to collect all transitively dirty node ids.
  const dirty = collectDownstream(dirtyId, graph.downstream);

  // graph.nodes is already in topological order (dependencies first).
  // Skip dirtyId itself (caller set it); recompute everything else in order.
  for (const node of graph.nodes) {
    if (node.id === dirtyId || !dirty.has(node.id)) continue;
    const val = solveNode(node, state, graph);
    if (val !== null) state.set(node.id, val);
  }

  return state;
}

// ── Dirty-set collection ──────────────────────────────────────────────────────

function collectDownstream(
  startId: NodeId,
  downstream: Map<NodeId, NodeId[]>,
): Set<NodeId> {
  const dirty = new Set<NodeId>();
  const direct = downstream.get(startId);
  if (!direct) return dirty;

  const queue = [...direct];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (dirty.has(id)) continue;
    dirty.add(id);
    for (const dep of downstream.get(id) ?? []) {
      queue.push(dep);
    }
  }
  return dirty;
}

// ── Node solver dispatch ──────────────────────────────────────────────────────

function solveNode(
  node: RuntimeNode,
  state: SolvedState,
  graph: RuntimeGraph,
): SolvedValue | null {
  switch (node.kind) {
    case "point":             return solvePoint(node, state, graph);
    case "line":              return solveLine(node, state, graph);
    case "ray":               return solveRay(node, state, graph);
    case "circle":            return solveCircle(node, state, graph);
    case "vector":            return solveVector(node, state, graph);
    case "radius_parameter":
    case "length_parameter":
    case "angle_parameter":
    case "line_parameter":
      return null; // parameters are set externally
    case "segment":
    case "triangle":
    case "angle":
    case "polygon":
      return null; // structural nodes have no independent geometry state
  }
}

// ── State accessors ───────────────────────────────────────────────────────────

function getPoint(id: NodeId, state: SolvedState): Vec2 {
  const v = state.get(id);
  if (!v || v.kind !== "point") throw new Error(`Expected point for "${id}"`);
  return { x: v.x, y: v.y };
}

function getLine(id: NodeId, state: SolvedState): SolvedLine {
  const v = state.get(id);
  if (!v || v.kind !== "line") throw new Error(`Expected line for "${id}"`);
  return v;
}

function getCircle(id: NodeId, state: SolvedState): SolvedCircle {
  const v = state.get(id);
  if (!v || v.kind !== "circle") throw new Error(`Expected circle for "${id}"`);
  return v;
}

function getParam(id: NodeId, state: SolvedState): number {
  const v = state.get(id);
  if (!v || v.kind !== "param") throw new Error(`Expected param for "${id}"`);
  return v.value;
}

function getVector(id: NodeId, state: SolvedState): SolvedVector {
  const v = state.get(id);
  if (!v || v.kind !== "vector") throw new Error(`Expected vector for "${id}"`);
  return v;
}

function getStructuralRefs(id: NodeId, graph: RuntimeGraph): NodeId[] {
  const n = graph.byId.get(id);
  if (!n) throw new Error(`Node not found: "${id}"`);
  if (n.kind !== "segment" && n.kind !== "triangle" && n.kind !== "angle") {
    throw new Error(`Expected structural node for "${id}", got "${n.kind}"`);
  }
  return (n as RuntimeStructuralNode).refs;
}

// ── Point solver ──────────────────────────────────────────────────────────────

function solvePoint(
  node: RuntimePointNode,
  state: SolvedState,
  graph: RuntimeGraph,
): SolvedPoint {
  const c = node.construction;

  switch (c.type) {
    case "free_point":
      // free_points are set externally; this should not be reached during
      // downstream recomputation (the moved point is skipped in recompute()).
      throw new Error(`free_point "${node.id}" reached solver unexpectedly`);

    case "midpoint": {
      const a = getPoint(c.a, state), b = getPoint(c.b, state);
      return pt((a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    case "line_intersection": {
      const l1 = getLine(c.line1, state), l2 = getLine(c.line2, state);
      return pt(...lineLineIntersection(l1, l2));
    }

    case "foot_of_perpendicular": {
      const p = getPoint(c.fromPoint, state), l = getLine(c.toLine, state);
      return pt(...footOnLine(p, l));
    }

    case "angle_bisector_foot": {
      // Angle bisector theorem: foot divides toSegment in ratio |V→A| : |V→B|.
      // (ratio of distances from vertex to each segment endpoint)
      const v       = getPoint(c.vertex, state);
      const segRefs = getStructuralRefs(c.toSegment, graph);
      const a       = getPoint(segRefs[0], state);
      const b       = getPoint(segRefs[1], state);
      const ra = dist(v, a), rb = dist(v, b);
      const total = ra + rb;
      if (total < 1e-12) return pt(a.x, a.y); // degenerate: V on segment
      // D = A + (ra / (ra + rb)) * (B - A)
      const t = ra / total;
      return pt(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
    }

    case "circumcenter": {
      const [A, B, C] = triPoints(c.triangle, graph, state);
      return pt(...circumcenter(A, B, C));
    }

    case "incenter": {
      const [A, B, C] = triPoints(c.triangle, graph, state);
      return pt(...incenter(A, B, C));
    }

    case "centroid": {
      const [A, B, C] = triPoints(c.triangle, graph, state);
      return pt((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3);
    }

    case "orthocenter": {
      const [A, B, C] = triPoints(c.triangle, graph, state);
      return pt(...orthocenter(A, B, C));
    }

    case "point_on_circle": {
      const circ  = getCircle(c.circle, state);
      const theta = c.angle ? getParam(c.angle, state) : 0;
      return pt(circ.cx + circ.r * Math.cos(theta),
                circ.cy + circ.r * Math.sin(theta));
    }

    case "point_on_line": {
      const l = getLine(c.line, state);
      const t = c.parameter
        ? getParam(c.parameter, state)
        : (c.t ?? 0.4);
      const len = Math.hypot(l.dx, l.dy) || 1;
      return pt(l.px + (t / len) * l.dx, l.py + (t / len) * l.dy);
    }

    case "antipode": {
      const circ = getCircle(c.circle, state);
      const p    = getPoint(c.point, state);
      return pt(2 * circ.cx - p.x, 2 * circ.cy - p.y);
    }

    case "reflect": {
      const p    = getPoint(c.point, state);
      const axis = getLine(c.line, state);
      const [fx, fy] = footOnLine(p, axis);
      return pt(2 * fx - p.x, 2 * fy - p.y);
    }

    case "translate": {
      const p   = getPoint(c.point, state);
      const vec = getVector(c.vector, state);
      return pt(p.x + vec.dx, p.y + vec.dy);
    }

    case "rotate": {
      const p      = getPoint(c.point, state);
      const center = getPoint(c.center, state);
      const theta  = getParam(c.angle, state);
      const dx = p.x - center.x, dy = p.y - center.y;
      return pt(
        center.x + dx * Math.cos(theta) - dy * Math.sin(theta),
        center.y + dx * Math.sin(theta) + dy * Math.cos(theta),
      );
    }

    case "projection": {
      const p = getPoint(c.point, state);
      const l = getLine(c.toLine, state);
      return pt(...footOnLine(p, l));
    }
    default: {
      const _: never = c;
      throw new Error(`Unhandled point construction: ${(_  as {type: string}).type}`);
    }
  }
}

// ── Line solver ───────────────────────────────────────────────────────────────

function solveLine(
  node: RuntimeLineNode,
  state: SolvedState,
  graph: RuntimeGraph,
): SolvedLine | null {
  const c = node.construction;

  switch (c.type) {
    case "free_line":
      return null; // position/direction set externally via initSolvedState

    case "line_through_points": {
      const a = getPoint(c.a, state), b = getPoint(c.b, state);
      return ln(a.x, a.y, b.x - a.x, b.y - a.y);
    }

    case "parallel_through_point": {
      const p   = getPoint(c.point, state);
      const ref = getLine(c.toLine, state);
      return ln(p.x, p.y, ref.dx, ref.dy);
    }

    case "perpendicular_through_point": {
      const p   = getPoint(c.point, state);
      const ref = getLine(c.toLine, state);
      // Rotate direction 90°: (dx, dy) → (-dy, dx)
      return ln(p.x, p.y, -ref.dy, ref.dx);
    }

    case "tangent_at_point": {
      const circ = getCircle(c.circle, state);
      const p    = getPoint(c.point, state);
      // Tangent is perpendicular to radius at point of tangency
      const rx = p.x - circ.cx, ry = p.y - circ.cy;
      return ln(p.x, p.y, -ry, rx);
    }

    case "angle_bisector_line": {
      const refs = getStructuralRefs(c.angle, graph);
      const arm1 = getPoint(refs[0], state);
      const v    = getPoint(refs[1], state);
      const arm2 = getPoint(refs[2], state);
      const d1   = normalize(sub(arm1, v));
      const d2   = normalize(sub(arm2, v));
      return ln(v.x, v.y, d1.x + d2.x, d1.y + d2.y);
    }

    case "perpendicular_bisector": {
      const [aId, bId] = getStructuralRefs(c.segment, graph);
      const a = getPoint(aId, state), b = getPoint(bId, state);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // Perpendicular to AB: rotate AB direction 90°
      const dx = -(b.y - a.y), dy = b.x - a.x;
      return ln(mx, my, dx, dy);
    }

    default: {
      const _: never = c;
      throw new Error(`Unhandled line construction: ${(_ as {type: string}).type}`);
    }
  }
}

// ── Ray solver ────────────────────────────────────────────────────────────────

function solveRay(
  node: RuntimeRayNode,
  state: SolvedState,
  graph: RuntimeGraph,
): SolvedRay {
  const c = node.construction;

  switch (c.type) {
    case "ray_from_point_through_point": {
      const o = getPoint(c.origin, state), t = getPoint(c.through, state);
      return ry(o.x, o.y, t.x - o.x, t.y - o.y);
    }

    case "angle_bisector_ray": {
      // refs = [arm1, vertex, arm2]; bisector direction = sum of unit arm vectors
      const refs = getStructuralRefs(c.angle, graph);
      const arm1 = getPoint(refs[0], state);
      const v    = getPoint(refs[1], state);
      const arm2 = getPoint(refs[2], state);
      const d1   = normalize(sub(arm1, v));
      const d2   = normalize(sub(arm2, v));
      return ry(v.x, v.y, d1.x + d2.x, d1.y + d2.y);
    }
    default: {
      const _: never = c;
      throw new Error(`Unhandled ray construction: ${(_ as {type: string}).type}`);
    }
  }
}

// ── Circle solver ─────────────────────────────────────────────────────────────

function solveCircle(
  node: RuntimeCircleNode,
  state: SolvedState,
  graph: RuntimeGraph,
): SolvedCircle {
  const c = node.construction;

  switch (c.type) {
    case "circle_center_radius": {
      const center = getPoint(c.center, state);
      const r      = getParam(c.radius, state);
      return circ(center.x, center.y, r);
    }

    case "circle_center_through_point": {
      const center  = getPoint(c.center, state);
      const through = getPoint(c.through, state);
      return circ(center.x, center.y, dist(center, through));
    }

    case "circumcircle": {
      const [A, B, C] = triPoints(c.triangle, graph, state);
      const [cx, cy]  = circumcenter(A, B, C);
      return circ(cx, cy, dist({ x: cx, y: cy }, A));
    }

    case "incircle": {
      const [A, B, C] = triPoints(c.triangle, graph, state);
      const [ix, iy]  = incenter(A, B, C);
      const a = dist(B, C), b = dist(C, A), cLen = dist(A, B);
      const s    = (a + b + cLen) / 2;
      const area = Math.abs(cross2(sub(B, A), sub(C, A))) / 2;
      return circ(ix, iy, area / s);
    }
    default: {
      const _: never = c;
      throw new Error(`Unhandled circle construction: ${(_ as {type: string}).type}`);
    }
  }
}

// ── Vector solver ─────────────────────────────────────────────────────────────

function solveVector(
  node: RuntimeVectorNode,
  state: SolvedState,
  graph: RuntimeGraph,
): SolvedVector {
  const c = node.construction;
  switch (c.type) {
    case "vector_from_points": {
      const from = getPoint(c.from, state), to = getPoint(c.to, state);
      return { kind: "vector", dx: to.x - from.x, dy: to.y - from.y };
    }
    case "direction_of_line": {
      const l = getLine(c.line, state);
      const len = Math.hypot(l.dx, l.dy) || 1;
      return { kind: "vector", dx: l.dx / len, dy: l.dy / len };
    }
    default: {
      const _: never = c;
      throw new Error(`Unhandled vector construction: ${(_ as {type: string}).type}`);
    }
  }
}

// ── Geometry primitives ───────────────────────────────────────────────────────

type Vec2 = { x: number; y: number };

const pt   = (x: number, y: number):                         SolvedPoint  => ({ kind: "point",  x, y });
const ln   = (px: number, py: number, dx: number, dy: number): SolvedLine => ({ kind: "line",   px, py, dx, dy });
const ry   = (px: number, py: number, dx: number, dy: number): SolvedRay  => ({ kind: "ray",    px, py, dx, dy });
const circ = (cx: number, cy: number, r: number):             SolvedCircle => ({ kind: "circle", cx, cy, r });

function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
function cross2(a: Vec2, b: Vec2): number { return a.x * b.y - a.y * b.x; }
function dist(a: Vec2, b: Vec2): number { return Math.hypot(b.x - a.x, b.y - a.y); }

function normalize(v: Vec2): Vec2 {
  const m = Math.hypot(v.x, v.y);
  return m < 1e-12 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
}

/**
 * Orthogonal projection of point `p` onto line `l`.
 * Returns the foot coordinates [x, y].
 */
function footOnLine(p: Vec2, l: SolvedLine): [number, number] {
  const dd = dot({ x: l.dx, y: l.dy }, { x: l.dx, y: l.dy });
  if (dd < 1e-24) return [l.px, l.py]; // degenerate line
  const t = dot(sub(p, { x: l.px, y: l.py }), { x: l.dx, y: l.dy }) / dd;
  return [l.px + t * l.dx, l.py + t * l.dy];
}

/**
 * Intersection of two lines (parametric form).
 * Returns midpoint of anchors if lines are parallel (degenerate input).
 */
function lineLineIntersection(l1: SolvedLine, l2: SolvedLine): [number, number] {
  const d1 = { x: l1.dx, y: l1.dy }, d2 = { x: l2.dx, y: l2.dy };
  const denom = cross2(d1, d2);
  if (Math.abs(denom) < 1e-12) {
    return [(l1.px + l2.px) / 2, (l1.py + l2.py) / 2]; // parallel fallback
  }
  const diff = sub({ x: l2.px, y: l2.py }, { x: l1.px, y: l1.py });
  const t    = cross2(diff, d2) / denom;
  return [l1.px + t * l1.dx, l1.py + t * l1.dy];
}

/** Returns the three vertex points of a structural triangle node. */
function triPoints(
  triId: NodeId,
  graph: RuntimeGraph,
  state: SolvedState,
): [Vec2, Vec2, Vec2] {
  const refs = getStructuralRefs(triId, graph);
  return [getPoint(refs[0], state), getPoint(refs[1], state), getPoint(refs[2], state)];
}

/**
 * Circumcenter of triangle ABC.
 * Computed as intersection of perpendicular bisectors of AB and AC.
 */
function circumcenter(A: Vec2, B: Vec2, C: Vec2): [number, number] {
  const midAB = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const midAC = { x: (A.x + C.x) / 2, y: (A.y + C.y) / 2 };
  const AB = sub(B, A), AC = sub(C, A);
  const bisAB: SolvedLine = { kind: "line", px: midAB.x, py: midAB.y, dx: -AB.y, dy: AB.x };
  const bisAC: SolvedLine = { kind: "line", px: midAC.x, py: midAC.y, dx: -AC.y, dy: AC.x };
  return lineLineIntersection(bisAB, bisAC);
}

/**
 * Incenter of triangle ABC.
 * Weighted average of vertices by opposite side lengths.
 */
function incenter(A: Vec2, B: Vec2, C: Vec2): [number, number] {
  const a = dist(B, C), b = dist(C, A), c = dist(A, B);
  const s = a + b + c;
  return [(a * A.x + b * B.x + c * C.x) / s,
          (a * A.y + b * B.y + c * C.y) / s];
}

/**
 * Orthocenter of triangle ABC.
 * Uses Euler line identity: H = A + B + C − 2·O  (O = circumcenter).
 */
function orthocenter(A: Vec2, B: Vec2, C: Vec2): [number, number] {
  const [ox, oy] = circumcenter(A, B, C);
  return [A.x + B.x + C.x - 2 * ox,
          A.y + B.y + C.y - 2 * oy];
}
