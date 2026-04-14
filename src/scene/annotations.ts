/**
 * scene/annotations.ts — Semantic annotation builder.
 *
 * Translates construction semantics and canonical relations into visual marks:
 *   - SceneSegmentMark   (equal-length ticks)
 *   - SceneAngleMark     (equal-angle / bisector arcs)
 *   - SceneRightAngleMark (perpendicular / altitude box)
 *
 * Sources, applied in order with deduplication:
 *
 *   1. Construction type of solved point nodes:
 *        midpoint              → 2 segment tick marks (same group)
 *        foot_of_perpendicular → right-angle box at foot
 *        projection            → same (alias of above)
 *        angle_bisector_foot   → 2 arc marks on both half-angles
 *
 *   2. Construction type of line / ray nodes:
 *        angle_bisector_line   → 2 arc marks (vertex from angle refs)
 *        angle_bisector_ray    → 2 arc marks (vertex from angle refs)
 *        perpendicular_bisector → right-angle box at midpoint (if midpoint is in graph)
 *
 *   3. Canonical IR relations (only when `ir` is supplied):
 *        equal_length   → segment tick group (style cycles: single → double → triple)
 *        equal_angle    → angle arc group    (style cycles: single → double → triple)
 */

import type { CanonicalGeometryIR } from "../canonical/schema.js";
import type { RuntimeGraph, RuntimeStructuralNode, NodeId } from "../runtime/schema.js";
import type {
  SceneAngleMark, SceneRightAngleMark, SceneSegmentMark,
} from "./schema.js";

// ── Style cycles ─────────────────────────────────────────────────────────────
const TICK_STYLES = ["single_tick", "double_tick", "triple_tick"] as const;
const ARC_STYLES  = ["single_arc",  "double_arc",  "triple_arc" ] as const;

// ── Canonical "unordered pair" key ────────────────────────────────────────────
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildAnnotations(
  graph: RuntimeGraph,
  ir?: CanonicalGeometryIR,
): {
  angleMarks:      SceneAngleMark[];
  rightAngleMarks: SceneRightAngleMark[];
  segmentMarks:    SceneSegmentMark[];
} {
  const angleMarks:      SceneAngleMark[]      = [];
  const rightAngleMarks: SceneRightAngleMark[] = [];
  const segmentMarks:    SceneSegmentMark[]    = [];

  // Deduplication
  const seenSeg   = new Set<string>();  // pairKey + "|" + group
  const seenRA    = new Set<string>();  // vertex point id
  const seenAngle = new Set<string>();  // "p1:v:p2|group"

  // ── Build fast lookup: unordered point pair → segment node id ─────────────
  const segByPair = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind === "segment") {
      const [a, b] = node.refs;
      segByPair.set(pairKey(a, b), node.id);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function addSegMark(
    a: string, b: string, group: string,
    style: typeof TICK_STYLES[number],
  ): void {
    const key = pairKey(a, b) + "|" + group;
    if (seenSeg.has(key)) return;
    seenSeg.add(key);
    segmentMarks.push({
      kind: "segment_mark",
      id:   `smk_${a}_${b}_${group}`,
      a, b, group, markStyle: style,
    });
  }

  function addAngleMark(
    p1: string, vertex: string, p2: string,
    group: string,
    style: typeof ARC_STYLES[number],
  ): void {
    const key = `${p1}:${vertex}:${p2}|${group}`;
    if (seenAngle.has(key)) return;
    seenAngle.add(key);
    angleMarks.push({
      kind:      "angle_mark",
      id:        `amk_${p1}_${vertex}_${p2}_${group}`,
      points:    [p1, vertex, p2] as [string, string, string],
      group,
      markStyle: style,
    });
  }

  function addRightAngleMark(
    vertexId: string, line1Id: string, line2Id: string,
  ): void {
    if (seenRA.has(vertexId)) return;
    seenRA.add(vertexId);
    rightAngleMarks.push({
      kind: "right_angle_mark",
      id:   `ram_${vertexId}`,
      pointId: vertexId,
      line1Id,
      line2Id,
    });
  }

  // Helper: lookup an angle structural node's [sideA, vertex, sideB] refs.
  function angleRefs(angleId: NodeId): [string, string, string] | null {
    const n = graph.byId.get(angleId) as RuntimeStructuralNode | undefined;
    if (n?.refs?.length === 3) return n.refs as [string, string, string];
    return null;
  }

  // ── 1. Point construction pass ─────────────────────────────────────────────

  for (const node of graph.nodes) {
    if (node.kind !== "point") continue;
    const c = node.construction;

    // midpoint → equal tick marks on both halves
    // Only emit when the parent segment (a–b) is explicitly present in the graph;
    // otherwise the ticks would float on ghost segments that are never drawn.
    if (c.type === "midpoint" && segByPair.has(pairKey(c.a, c.b))) {
      const group = `midpt_${node.id}`;
      addSegMark(c.a, node.id, group, "single_tick");
      addSegMark(node.id, c.b, group, "single_tick");
    }

    // foot_of_perpendicular / projection → right-angle box at foot
    if (c.type === "foot_of_perpendicular" || c.type === "projection") {
      const fromPt = c.type === "foot_of_perpendicular" ? c.fromPoint : c.point;
      const segId  = segByPair.get(pairKey(fromPt, node.id));
      if (segId) addRightAngleMark(node.id, segId, c.toLine);
    }

    // angle_bisector_foot → double arc on each half-angle
    if (c.type === "angle_bisector_foot") {
      const refs = angleRefs(c.angle);
      if (refs) {
        const [sideA, vertex, sideB] = refs;
        const group = `bisect_${node.id}`;
        addAngleMark(sideA, vertex, node.id,  group, "double_arc");
        addAngleMark(node.id, vertex, sideB,   group, "double_arc");
      }
    }
  }

  // ── 2. Line / Ray construction pass ────────────────────────────────────────

  for (const node of graph.nodes) {
    if (node.kind !== "line" && node.kind !== "ray") continue;
    const c = node.construction;

    // angle_bisector_line / angle_bisector_ray → arcs on both half-angles.
    // We need a named point along the bisector to split the angle into two.
    // Look for any angle_bisector_foot that uses the same angle structural node.
    if (
      (node.kind === "line" && c.type === "angle_bisector_line") ||
      (node.kind === "ray"  && c.type === "angle_bisector_ray")
    ) {
      const angleId = c.angle;
      const refs    = angleRefs(angleId);
      if (!refs) continue;
      const [sideA, vertex, sideB] = refs;

      // Find a bisector foot using the same angle → use it as the split point.
      const footNode = graph.nodes.find(
        n =>
          n.kind === "point" &&
          n.construction.type === "angle_bisector_foot" &&
          (n.construction as { angle: string }).angle === angleId,
      );
      if (footNode) {
        const group = `bisect_${node.id}`;
        addAngleMark(sideA, vertex, footNode.id, group, "double_arc");
        addAngleMark(footNode.id, vertex, sideB, group, "double_arc");
      }
    }

    // perpendicular_bisector → right-angle mark at the midpoint of the segment.
    if (node.kind === "line" && c.type === "perpendicular_bisector") {
      const segNode = graph.byId.get(c.segment) as RuntimeStructuralNode | undefined;
      if (segNode?.refs?.length === 2) {
        const [a, b] = segNode.refs;
        // Find a declared midpoint of (a, b) in the graph.
        const midNode = graph.nodes.find(n => {
          if (n.kind !== "point") return false;
          const mc = n.construction as { type: string; a?: string; b?: string };
          return mc.type === "midpoint" &&
            ((mc.a === a && mc.b === b) || (mc.a === b && mc.b === a));
        });
        if (midNode) {
          const segId = segByPair.get(pairKey(a, midNode.id))
                     ?? segByPair.get(pairKey(midNode.id, b));
          if (segId) addRightAngleMark(midNode.id, segId, node.id);
        }
      }
    }
  }

  // ── 3. Canonical relations pass ────────────────────────────────────────────

  if (ir?.relations) {
    let eqLenIdx = 0;
    let eqAngIdx = 0;

    for (const rel of ir.relations) {
      if (rel.type === "equal_length") {
        const style = TICK_STYLES[Math.min(eqLenIdx, TICK_STYLES.length - 1)];
        const group = `eq_len_${eqLenIdx}`;
        const s1 = graph.byId.get(rel.seg1) as RuntimeStructuralNode | undefined;
        const s2 = graph.byId.get(rel.seg2) as RuntimeStructuralNode | undefined;
        if (s1 && s1.refs && s1.refs.length >= 2) addSegMark(s1.refs[0], s1.refs[1], group, style);
        if (s2 && s2.refs && s2.refs.length >= 2) addSegMark(s2.refs[0], s2.refs[1], group, style);
        eqLenIdx++;
      }

      if (rel.type === "equal_angle") {
        const style = ARC_STYLES[Math.min(eqAngIdx, ARC_STYLES.length - 1)];
        const group = `eq_ang_${eqAngIdx}`;
        const a1 = graph.byId.get(rel.ang1) as RuntimeStructuralNode | undefined;
        const a2 = graph.byId.get(rel.ang2) as RuntimeStructuralNode | undefined;
        if (a1?.refs?.length === 3) addAngleMark(a1.refs[0], a1.refs[1], a1.refs[2], group, style);
        if (a2?.refs?.length === 3) addAngleMark(a2.refs[0], a2.refs[1], a2.refs[2], group, style);
        eqAngIdx++;
      }
    }
  }

  return { angleMarks, rightAngleMarks, segmentMarks };
}
