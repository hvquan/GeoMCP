/**
 * pipeline/run-from-canonical.ts — Full pipeline from Canonical IR to SVG.
 *
 * Implements the complete engine-side flow described in the architecture spec:
 *
 *   Canonical IR
 *     ↓ compileToRuntimeGraph()
 *   Runtime Constraint Graph
 *     ↓ initSolvedState() + solveAll()
 *   Solved Geometry State
 *     ↓ buildSceneGraph()
 *   Scene Graph
 *     ↓ layout() + applyStyles()
 *   Styled Scene
 *     ↓ renderSvg()
 *   SVG
 *
 * Usage:
 *   import { runFromCanonical } from "./pipeline/run-from-canonical.js";
 *   const { scene, svg } = runFromCanonical(ir, {
 *     "pt.A": { x: 0, y: 0 },
 *     "pt.B": { x: 4, y: 0 },
 *     "pt.C": { x: 2, y: 3 },
 *   });
 */

import { compileToRuntimeGraph } from "../runtime/compiler.js";
import { initSolvedState }       from "../solver/state.js";
import { solveAll }              from "../solver/recompute.js";
import { buildSceneGraph }       from "../scene/builder.js";
import { layout }                from "../scene/layout.js";
import { computeViewport }       from "../scene/viewport.js";
import { applyStyles }           from "../scene/style.js";
import { renderSvg }             from "../renderer/svg.js";

import type { CanonicalGeometryIR } from "../canonical/schema.js";
import type { FreePointCoords }     from "../solver/state.js";
import type { InteractionResult }   from "../interaction/types.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full Canonical IR → SVG pipeline.
 *
 * @param ir           Canonical Geometry IR (output from parser / LLM adapter)
 * @param freePoints   Initial coordinates for all free_point entities
 * @param fixedScale   Optional locked scale (for stable interaction re-renders)
 * @param fixedOffX    Optional locked X offset
 * @param fixedOffY    Optional locked Y offset
 */
export function runFromCanonical(
  ir: CanonicalGeometryIR,
  freePoints: FreePointCoords = {},
  fixedScale?: number,
  fixedOffX?: number,
  fixedOffY?: number,
): InteractionResult {
  const graph      = compileToRuntimeGraph(ir);
  const state      = initSolvedState(graph, freePoints);
  solveAll(graph, state);

  const scene      = buildSceneGraph(graph, state, ir);
  const positioned = layout(scene);
  const vp         = computeViewport(positioned, fixedScale, fixedOffX, fixedOffY);
  const styled     = applyStyles(positioned, vp);
  const svg        = renderSvg(styled);

  return { scene, svg, errors: [], warnings: [] };
}
