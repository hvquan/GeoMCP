/**
 * pipeline/run.ts — Orchestrates the five scene→SVG stages.
 *
 *   1. parse       raw JSON       → SceneGraph
 *   2. validate    SceneGraph     → ValidatedScene
 *   3. layout      SceneGraph     → PositionedScene
 *   4. style       PositionedScene → StyledScene
 *   5. render      StyledScene    → SVG string
 */
import { parseSceneGraph } from "../scene/parse.js";
import { validate }         from "../scene/validate.js";
import { layout }           from "../scene/layout.js";
import { computeViewport }  from "../scene/viewport.js";
import { applyStyles }      from "../scene/style.js";
import { renderSvg }        from "../renderer/svg.js";
import type { PipelineResult, PipelineStep } from "../scene/schema.js";

export function runPipeline(rawInput: unknown): PipelineResult {
  const steps: PipelineStep[] = [];
  let   n = 0;
  const log = (label: string, data: unknown) => steps.push({ step: ++n, label, data });

  // 1. Parse
  const scene = parseSceneGraph(rawInput);
  log("parse — SceneGraph", {
    version:             scene.version,
    pointCount:          scene.points.length,
    geometryCount:       scene.geometry.length,
    angleMarkCount:      scene.angleMarks.length,
    rightAngleMarkCount: scene.rightAngleMarks.length,
    segmentMarkCount:    scene.segmentMarks.length,
    labelCount:          (scene.labels ?? []).length,
    points:              scene.points,
    geometry:            scene.geometry,
    angleMarks:          scene.angleMarks,
    rightAngleMarks:     scene.rightAngleMarks,
    segmentMarks:        scene.segmentMarks,
    labels:              scene.labels ?? [],
  });

  // 2. Validate
  const validated = validate(scene);
  log("validate — errors + warnings", { errors: validated.errors, warnings: validated.warnings });
  if (validated.errors.length > 0)
    return { steps, svg: "", errors: validated.errors, warnings: validated.warnings };

  // 3. Layout
  const positioned = layout(scene);
  log("layout — positioned points + bounding box", {
    points: positioned.points.map((p) => ({
      id: p.id, x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, label: p.label,
    })),
    boundingBox: positioned.boundingBox,
  });

  // 4. Viewport
  const vp = computeViewport(positioned);

  // 5. Style
  const styled = applyStyles(positioned, vp);
  log("style — canvas coords + scale", {
    viewport: styled.viewport,
    scale:    Math.round(styled.scale * 100) / 100,
    points:   styled.points.map((p) => ({ id: p.id, canvasX: p.x, canvasY: p.y, style: p.resolvedStyle })),
  });

  // 6. Render
  const svg = renderSvg(styled);
  log("render — SVG output", { length: svg.length, preview: svg.slice(0, 300) + "..." });

  return { steps, svg, errors: [], warnings: validated.warnings };
}
