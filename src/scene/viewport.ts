/**
 * scene/viewport.ts — World-space → screen-space transform computation.
 *
 * Computes the uniform scale and canvas offsets that fit a PositionedScene
 * (math Y-up coordinates) into a fixed-size SVG canvas with padding.
 *
 * Responsibilities:
 *   - Extend the geometry bounding box to include circle extents (center ± radius)
 *     so circle-dominant scenes aren't assigned an absurdly large auto-scale
 *   - Compute a uniform scale that fits the extended bbox into the canvas
 *   - Produce (offX, offY) so the geometry is centered and padded
 *
 * NOT responsible for:
 *   - Applying the Y-flip or converting individual point coords → scene/style.ts
 *   - Attaching visual styles (colors, stroke widths)            → scene/style.ts
 *   - SVG serialization                                          → renderer/svg.ts
 */

import type { PositionedScene } from "./schema.js";

// ── Canvas constants ──────────────────────────────────────────────────────────

export const CANVAS_W = 1200;
export const CANVAS_H = 1200;
export const PADDING  = 20;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The computed screen-space transform parameters.
 *
 * Conversion formulas (applied in scene/style.ts):
 *   canvas_x = offX + math_x * scale
 *   canvas_y = height − (offY + math_y * scale)   ← Y-flip: math Y-up → SVG Y-down
 */
export interface ViewportTransform {
  /** Pixels-per-world-unit uniform scale. */
  scale:  number;
  /** Canvas pixels from the left edge to the math-space x=0 axis. */
  offX:   number;
  /** Canvas pixels from the bottom edge to the math-space y=0 axis (pre-flip). */
  offY:   number;
  /** SVG canvas width in pixels. */
  width:  number;
  /** SVG canvas height in pixels. */
  height: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the viewport transform that fits `scene` into the canvas.
 *
 * If `fixedScale / fixedOffX / fixedOffY` are supplied (e.g., locked during
 * interactive drag to prevent the canvas jumping) they are returned as-is
 * without recomputation.
 *
 * @param scene       Positioned scene (math Y-up coordinates + bounding box).
 * @param fixedScale  Optional locked scale from a previous render.
 * @param fixedOffX   Optional locked X offset from a previous render.
 * @param fixedOffY   Optional locked Y offset from a previous render.
 */
export function computeViewport(
  scene:       PositionedScene,
  fixedScale?: number,
  fixedOffX?:  number,
  fixedOffY?:  number,
): ViewportTransform {
  const { boundingBox: bb } = scene;

  // Extend the bounding box to include circle extents (center ± radius).
  // Without this, a scene with a single free point (e.g. circle center) has a
  // near-zero bbox → enormous auto-scale → circle fills the entire canvas.
  const pointById = new Map(scene.points.map(p => [p.id, p]));
  let { minX, minY, maxX, maxY } = bb;

  for (const geo of scene.geometry) {
    if (geo.kind === "circle" && typeof (geo as { radius?: unknown }).radius === "number") {
      const c = pointById.get((geo as { center: string }).center);
      if (c) {
        const r = (geo as { radius: number }).radius;
        minX = Math.min(minX, c.x - r);
        maxX = Math.max(maxX, c.x + r);
        minY = Math.min(minY, c.y - r);
        maxY = Math.max(maxY, c.y + r);
      }
    }
  }

  const bbW = maxX - minX || 1;
  const bbH = maxY - minY || 1;

  const scale = fixedScale ?? Math.min(
    (CANVAS_W - 2 * PADDING) / bbW,
    (CANVAS_H - 2 * PADDING) / bbH,
  );
  const offX = fixedOffX ?? (PADDING - minX * scale);
  const offY = fixedOffY ?? (PADDING - minY * scale);

  return { scale, offX, offY, width: CANVAS_W, height: CANVAS_H };
}
