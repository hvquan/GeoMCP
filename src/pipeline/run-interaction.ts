/**
 * pipeline/run-interaction.ts — Apply an interaction event and re-run the pipeline.
 *
 * POST /api/interact body:  { scene: SceneGraph, event: InteractionEvent }
 * Response:                 InteractionResult  (updated scene JSON + fresh SVG)
 *
 * Input is validated with Zod at the schema boundary; only v1.3 scenes are
 * accepted via this endpoint.  Earlier versions fall back to the legacy
 * parse/validate pipeline in run.ts.
 */
import { SceneGraphV13Schema } from "../scene/schema.zod.js";
import { layout }          from "../scene/layout.js";
import { computeViewport } from "../scene/viewport.js";
import { applyStyles }     from "../scene/style.js";
import { renderSvg }       from "../renderer/svg.js";
import { applyInteraction } from "../interaction/update.js";
import type { InteractionEvent, InteractionResult } from "../interaction/types.js";
import type { SceneGraph } from "../scene/schema.js";

export function runInteraction(rawScene: unknown, event: InteractionEvent, fixedScale?: number, fixedOffX?: number, fixedOffY?: number): InteractionResult {
  // Validate at the boundary with Zod (v1.3 only).
  const parsed = SceneGraphV13Schema.safeParse(rawScene);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({
      message: i.message,
      path: i.path.join("."),
    }));
    return { scene: rawScene, svg: "", errors, warnings: [] };
  }

  // applyInteraction works on SceneGraph (superset of SceneGraphV13Input).
  const scene   = parsed.data as unknown as SceneGraph;
  const updated = applyInteraction(scene, event);

  const positioned = layout(updated);
  const vp         = computeViewport(positioned, fixedScale, fixedOffX, fixedOffY);
  const styled     = applyStyles(positioned, vp);
  const svg        = renderSvg(styled);

  return { scene: updated, svg, errors: [], warnings: [] };
}

