/**
 * scene/layout.ts — Assign (x, y) to every point.
 *
 * Points that already carry coordinates are kept as-is.
 * Points without coordinates are auto-placed on a ring around the centroid.
 */
import type { SceneGraph, PositionedScene, PositionedPoint } from "./schema.js";

export function layout(scene: SceneGraph): PositionedScene {
  const hasCoords   = scene.points.filter((p) => typeof p.x === "number" && typeof p.y === "number");
  const needsCoords = scene.points.filter((p) => typeof p.x !== "number" || typeof p.y !== "number");

  const n     = needsCoords.length;
  const ringR = 3;
  const cx    = hasCoords.length ? hasCoords.reduce((s, p) => s + p.x, 0) / hasCoords.length : 0;
  const cy    = hasCoords.length ? hasCoords.reduce((s, p) => s + p.y, 0) / hasCoords.length : 0;

  const positioned: PositionedPoint[] = [
    ...hasCoords.map((p) => ({
      id:          p.id,
      x:           p.x,
      y:           p.y,
      visible:     p.visible,
      label:       p.label ?? p.id,
      labelOffset: { dx: 8, dy: -8 },
      interaction: p.interaction,
    })),
    ...needsCoords.map((p, i) => {
      const angle = (2 * Math.PI * i) / Math.max(n, 1);
      return {
        id:          p.id,
        x:           cx + ringR * Math.cos(angle),
        y:           cy + ringR * Math.sin(angle),
        visible:     p.visible,
        label:       p.label ?? p.id,
        labelOffset: { dx: 8, dy: -8 },
        interaction: p.interaction,
      };
    }),
  ];

  const xs = positioned.map((p) => p.x);
  const ys = positioned.map((p) => p.y);

  return {
    points:          positioned,
    geometry:        scene.geometry,
    angleMarks:      scene.angleMarks,
    rightAngleMarks: scene.rightAngleMarks,
    segmentMarks:    scene.segmentMarks,
    labels:          scene.labels ?? [],
    boundingBox: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
  };
}
