/**
 * solver/state.ts — SolvedState initialization.
 *
 * Creates the initial SolvedState map from a RuntimeGraph plus caller-provided
 * free-point coordinates.  Parameters are seeded from the value stored on
 * RuntimeParameterNode.  Derived nodes are left absent so that the caller can
 * fill them by invoking `solveAll()` from solver/recompute.ts.
 */

import type { RuntimeGraph, NodeId } from "../runtime/schema.js";
import type { SolvedState } from "./recompute.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Free-point seed coordinates, keyed by NodeId. */
export type FreePointCoords = Partial<Record<NodeId, { x: number; y: number }>>;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build an initial (partially-populated) SolvedState from a compiled
 * RuntimeGraph.
 *
 *  - `free_point` nodes are seeded from `freePoints`
 *    (falls back to `{x:0, y:0}` if the id is absent in the map).
 *  - `radius_parameter / length_parameter / angle_parameter` nodes use
 *    their `value` field (defaulting to 0 when unset).
 *  - All other nodes are absent — call `solveAll(graph, state)` to
 *    compute them in topological order.
 */
export function initSolvedState(
  graph: RuntimeGraph,
  freePoints: FreePointCoords = {},
): SolvedState {
  const state: SolvedState = new Map();

  for (const node of graph.nodes) {
    if (node.kind === "point") {
      if (node.construction.type === "free_point") {
        const coords = freePoints[node.id] ?? { x: 0, y: 0 };
        state.set(node.id, { kind: "point", x: coords.x, y: coords.y });
      }
      // Derived points are computed by solveAll().

    } else if (node.kind === "line") {
      if (node.construction.type === "free_line") {
        const c = node.construction;
        // If direction not specified, assign a unique default angle so that
        // multiple free_lines in the same graph are never parallel.
        let dx = c.dx, dy = c.dy;
        if (dx == null || dy == null) {
          const freeLineIdx = [...state.keys()].filter(k => {
            const v = state.get(k); return v && v.kind === "line";
          }).length;
          const angle = freeLineIdx * (Math.PI / 4);  // 0°, 45°, 90°, 135°…
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        }
        state.set(node.id, {
          kind: "line",
          px: c.px ?? 0, py: c.py ?? 0,
          dx, dy,
        });
      }

    } else if (
      node.kind === "radius_parameter" ||
      node.kind === "length_parameter" ||
      node.kind === "angle_parameter" ||
      node.kind === "line_parameter"
    ) {
      state.set(node.id, { kind: "param", value: node.value ?? 0 });

    }
    // Structural nodes (segment, triangle, angle) have no independent
    // solved value — skip them.
  }

  return state;
}
