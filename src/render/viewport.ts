import type { LayoutModel } from '../model/types.js';
import { displayLabel } from '../model/normalize.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Axis-aligned bounding box over all visible points and circle extents
 * in world (layout) coordinates.
 */
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  center: { x: number; y: number };
}

/**
 * Parameters of the scale + translate transform that maps world coordinates
 * to SVG canvas coordinates.
 *
 * canvas_x =  offsetX + (world_x − bbMinX) * scale
 * canvas_y =  canvasHeight − (offsetY + (world_y − bbMinY) * scale)   ← Y-flip
 */
export interface ViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  bbMinX: number;
  bbMinY: number;
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
}

/** Full result of fitting a layout to a canvas viewport. */
export interface FitInfo {
  boundingBox: BoundingBox;
  transform: ViewportTransform;
}

// ─── Canvas size constants ─────────────────────────────────────────────────

export const CANVAS_WIDTH   = 800;
export const CANVAS_HEIGHT  = 600;
// 5% margin on each side → content fills 90% of the canvas.
export const CANVAS_PADDING_X = CANVAS_WIDTH  * 0.05;  // 40
export const CANVAS_PADDING_Y = CANVAS_HEIGHT * 0.05;  // 30
/** @deprecated Use CANVAS_PADDING_X / CANVAS_PADDING_Y for non-square padding. */
export const CANVAS_PADDING = CANVAS_PADDING_X;

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Compute the bounding box of all visible features in a LayoutModel.
 * Internal helper points (ids starting with "_") are excluded.
 * Circle extents (center ± radius) are included.
 */
export function computeBoundingBox(layout: LayoutModel): BoundingBox {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const p of layout.points) {
    if (displayLabel(p.id).startsWith('_') || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    xs.push(p.x);
    ys.push(p.y);
  }

  for (const c of layout.circles) {
    const center = layout.points.find((p) => p.id === c.center);
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;
    xs.push(center.x - c.radius, center.x + c.radius);
    ys.push(center.y - c.radius, center.y + c.radius);
  }

  if (xs.length === 0) {
    return { minX: -1, minY: -1, maxX: 1, maxY: 1, width: 2, height: 2, center: { x: 0, y: 0 } };
  }

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width  = maxX - minX || 1;
  const height = maxY - minY || 1;

  return {
    minX, minY, maxX, maxY, width, height,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/**
 * Compute the viewport transform that fits `layout` into a canvas of size
 * `canvasWidth × canvasHeight` with uniform `padding` on all sides.
 *
 * Strategy:
 *   1. Compute bounding box of all features (points + circle extents).
 *   2. scale = min(availableW / bbWidth, availableH / bbHeight)   — preserves aspect ratio.
 *   3. Center the scaled content: offsetX = (W − bbWidth·scale) / 2,
 *                                 offsetY = (H − bbHeight·scale) / 2.
 */
export function fitToViewport(
  layout: LayoutModel,
  canvasWidth  = CANVAS_WIDTH,
  canvasHeight = CANVAS_HEIGHT,
  padding      = CANVAS_PADDING,
): FitInfo {
  const bb = computeBoundingBox(layout);

  // Respect non-square padding: if caller passes a single padding value, apply it
  // uniformly; internally use separate X/Y margins so 800×600 fills 90%.
  const padX = (canvasWidth  === CANVAS_WIDTH  && padding === CANVAS_PADDING) ? CANVAS_PADDING_X : padding;
  const padY = (canvasHeight === CANVAS_HEIGHT && padding === CANVAS_PADDING) ? CANVAS_PADDING_Y : padding;

  const scaleX = (canvasWidth  - 2 * padX) / bb.width;
  const scaleY = (canvasHeight - 2 * padY) / bb.height;
  const scale  = Math.min(scaleX, scaleY);

  const scaledW = bb.width  * scale;
  const scaledH = bb.height * scale;
  const offsetX = (canvasWidth  - scaledW) / 2;
  const offsetY = (canvasHeight - scaledH) / 2;

  return {
    boundingBox: bb,
    transform: {
      scale,
      offsetX,
      offsetY,
      bbMinX: bb.minX,
      bbMinY: bb.minY,
      canvasWidth,
      canvasHeight,
      padding,
    },
  };
}

/**
 * Apply a ViewportTransform to a single world-space point, producing
 * SVG canvas coordinates (Y-axis flipped: math-Y up → SVG-Y down).
 */
export function toCanvasPoint(
  x: number,
  y: number,
  t: ViewportTransform,
): { x: number; y: number } {
  return {
    x: t.offsetX + (x - t.bbMinX) * t.scale,
    y: t.canvasHeight - (t.offsetY + (y - t.bbMinY) * t.scale),
  };
}
