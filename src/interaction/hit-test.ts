/**
 * interaction/hit-test.ts — Detect what the mouse is closest to.
 *
 * Works in the same coordinate space as scene.points[].x/y (math-space Y-up
 * after layout, or canvas-space after style — caller must ensure consistency).
 *
 * Priority:
 *   1. Points (small radius, checked first)
 *   2. Circle borders (checked if no point was hit)
 *   3. none
 *
 * Only objects that opt in via interaction metadata are considered:
 *   - point:         interaction.hoverable !== false  (default: hittable)
 *   - circle border: interaction.hitTarget === "border"
 */
import type { SceneGraph, ScenePoint, SceneCircle } from "../scene/schema.js";
import type { HitResult } from "./types.js";

export interface HitTestOptions {
  /** Max distance from point centre to register a hit. Default 10. */
  pointRadius?: number;
  /** Max distance from circle circumference to register a hit. Default 8. */
  circleBorderTolerance?: number;
}

const DEFAULTS: Required<HitTestOptions> = {
  pointRadius:           10,
  circleBorderTolerance: 8,
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function hitPoint(p: ScenePoint, mx: number, my: number, r: number): boolean {
  return dist(p.x, p.y, mx, my) <= r;
}

function hitCircleBorder(
  circle: SceneCircle, center: ScenePoint,
  mx: number, my: number, tol: number,
): boolean {
  return Math.abs(dist(center.x, center.y, mx, my) - circle.radius) <= tol;
}

export function hitTestScene(
  scene: SceneGraph,
  mouseX: number,
  mouseY: number,
  options?: HitTestOptions,
): HitResult {
  const opts = { ...DEFAULTS, ...options };

  // 1. Points — checked first; a small visible dot takes priority over large circles.
  for (const p of scene.points) {
    if (p.visible === false) continue;
    if (p.interaction?.hoverable === false) continue;
    if (hitPoint(p, mouseX, mouseY, opts.pointRadius)) {
      return { kind: "point", pointId: p.id };
    }
  }

  // 2. Circle borders — only those that explicitly enable border interaction.
  for (const g of scene.geometry) {
    if (g.kind !== "circle")                    continue;
    if (g.visible === false)                    continue;
    if (g.interaction?.hoverable === false)     continue;
    if (g.interaction?.hitTarget !== "border")  continue;

    const center = scene.points.find((p) => p.id === g.center);
    if (!center) continue;

    if (hitCircleBorder(g, center, mouseX, mouseY, opts.circleBorderTolerance)) {
      return { kind: "circle-border", circleId: g.id };
    }
  }

  return { kind: "none" };
}
