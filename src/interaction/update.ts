/**
 * interaction/update.ts — Apply an InteractionEvent to a SceneGraph.
 *
 * Returns a new SceneGraph plain object with the mutation applied.
 * All other fields are left unchanged (shallow copy).
 *
 * Permission rules (enforced here, not in the transport layer):
 *   drag_point  — allowed only when point.interaction.draggable === true
 *                 AND point.interaction.editMode === "move_point"
 *   drag_radius — allowed only when circle.interaction.editMode === "change_radius"
 *                 AND circle.interaction.hitTarget === "border"
 */
import type { SceneGraph, ScenePoint, SceneGeometryNode } from "../scene/schema.js";
import type { InteractionEvent } from "./types.js";

const MIN_RADIUS = 0.05;
const MAX_RADIUS = 1_000_000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function applyInteraction(scene: SceneGraph, event: InteractionEvent): SceneGraph {
  if (event.type === "drag_point") {
    const { pointId, newX, newY } = event;

    const target = scene.points.find((p: ScenePoint) => p.id === pointId);
    if (!target) return scene;

    // Both flags must be set — a derived point may have draggable:false but no editMode.
    const canDrag =
      target.interaction?.draggable === true &&
      target.interaction?.editMode === "move_point";
    if (!canDrag) return scene;

    return {
      ...scene,
      points: scene.points.map((p: ScenePoint) =>
        p.id === pointId ? { ...p, x: newX, y: newY } : p
      ),
    };
  }

  if (event.type === "drag_radius") {
    const { circleId, mouseX, mouseY } = event;

    const circle = scene.geometry.find(
      (g: SceneGeometryNode) => g.kind === "circle" && g.id === circleId
    );
    if (!circle || circle.kind !== "circle") return scene;

    // Require explicit opt-in for both edit mode and hit target.
    const canResize =
      circle.interaction?.editMode  === "change_radius" &&
      circle.interaction?.hitTarget === "border";
    if (!canResize) return scene;

    const center = scene.points.find((p: ScenePoint) => p.id === circle.center);
    if (!center) return scene;

    const newRadius = clamp(
      Math.hypot(mouseX - center.x, mouseY - center.y),
      MIN_RADIUS,
      MAX_RADIUS,
    );

    return {
      ...scene,
      geometry: scene.geometry.map((g: SceneGeometryNode) =>
        g.kind === "circle" && g.id === circleId ? { ...g, radius: newRadius } : g
      ),
    };
  }

  return scene;
}

