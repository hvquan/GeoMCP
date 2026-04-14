/**
 * runtime/edit-policy.ts — Map a hit-test result to a canonical edit action.
 *
 * Sits between the interaction layer and the solver:
 *
 *   Pointer event
 *     → Hit test
 *     → Edit policy          ← this module
 *     → Update solved state
 *     → recompute()
 *
 * Rules (per architecture spec section 11-12):
 *   • free_point hit                     → update_free_point
 *   • point_on_circle with a parameter   → update_angle_parameter
 *   • any other derived point            → none
 *   • circle border, circle_center_radius    → update_radius_parameter
 *   • circle border, other circle types      → none (radius is implicit/derived)
 */

import type { RuntimeGraph, NodeId } from "./schema.js";
import type { HitResult } from "../interaction/types.js";

// ── Edit action union ─────────────────────────────────────────────────────────

export type EditAction =
  | { kind: "update_free_point";       pointId: NodeId }
  | { kind: "update_radius_parameter"; parameterId: NodeId; circleId: NodeId }
  | { kind: "update_angle_parameter";  parameterId: NodeId; pointId: NodeId }
  | { kind: "none";                    reason: string };

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the canonical edit action for a given hit result.
 *
 * The caller applies the action to the SolvedState, then calls recompute().
 */
export function getEditPolicy(
  graph: RuntimeGraph,
  hit: HitResult,
): EditAction {
  if (hit.kind === "none") {
    return { kind: "none", reason: "no object under cursor" };
  }

  if (hit.kind === "point") {
    const node = graph.byId.get(hit.pointId);
    if (!node || node.kind !== "point") {
      return { kind: "none", reason: `point "${hit.pointId}" not in graph` };
    }

    const c = node.construction;

    if (c.type === "free_point") {
      return { kind: "update_free_point", pointId: node.id };
    }

    if (c.type === "point_on_circle" && c.angle) {
      return {
        kind:        "update_angle_parameter",
        parameterId: c.angle,
        pointId:     node.id,
      };
    }

    return { kind: "none", reason: `derived point type "${c.type}" is not directly editable` };
  }

  if (hit.kind === "circle-border") {
    const node = graph.byId.get(hit.circleId);
    if (!node || node.kind !== "circle") {
      return { kind: "none", reason: `circle "${hit.circleId}" not in graph` };
    }

    const c = node.construction;

    if (c.type === "circle_center_radius") {
      return {
        kind:        "update_radius_parameter",
        parameterId: c.radius,
        circleId:    node.id,
      };
    }

    return { kind: "none", reason: `circle type "${c.type}" is not directly resizable` };
  }

  return { kind: "none", reason: "unhandled hit kind" };
}
