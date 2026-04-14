/**
 * scene/style.ts — Math-space → canvas-space coordinate conversion + default point styles.
 *
 * Applies a ViewportTransform (from scene/viewport.ts) to convert every point
 * from world-space (Y-up) to canvas-space (Y-down), then attaches default
 * visual styles to each point.
 *
 * NOT responsible for:
 *   - Computing scale / offset / padding  → scene/viewport.ts
 *   - Deciding canvas dimensions          → scene/viewport.ts
 */
import type { PositionedScene, StyledScene, PointStyle, StyledPoint } from "./schema.js";
import type { ViewportTransform } from "./viewport.js";

const DEFAULT_POINT: PointStyle = {
  radius:      4,
  fill:        "#1d4ed8",
  stroke:      "#1d4ed8",
  strokeWidth: 1.5,
  labelFont:   "sans-serif",
  labelSize:   14,
  labelColor:  "#111827",
};

export function applyStyles(scene: PositionedScene, vp: ViewportTransform): StyledScene {
  const { scale, offX, offY, width, height } = vp;

  const toCanvas = (x: number, y: number) => ({
    x: Math.round((offX + x * scale) * 100) / 100,
    y: Math.round((height - (offY + y * scale)) * 100) / 100,  // flip Y: math Y-up → SVG Y-down
  });

  const points: StyledPoint[] = scene.points.map((p) => {
    const { x, y } = toCanvas(p.x, p.y);
    return { ...p, x, y, resolvedStyle: { ...DEFAULT_POINT } };
  });

  return {
    points,
    geometry:        scene.geometry,
    angleMarks:      scene.angleMarks,
    rightAngleMarks: scene.rightAngleMarks,
    segmentMarks:    scene.segmentMarks,
    labels:          scene.labels,
    viewport: { width, height, viewBox: `0 0 ${width} ${height}` },
    scale,
  };
}
