/**
 * interaction/types.ts — Types for the interaction layer.
 *
 * The interaction layer sits between raw pointer events and the scene graph.
 * It is intentionally free of DOM / SVG concerns; those live in web/app.js.
 */

// ── Hit-test result ───────────────────────────────────────────────────────────

export type HitResult =
  | { kind: "point";         pointId: string }
  | { kind: "circle-border"; circleId: string }
  | { kind: "none" };

// ── Drag state ────────────────────────────────────────────────────────────────

export type DragState =
  | { kind: "move_point";    pointId: string }
  | { kind: "change_radius"; circleId: string }
  | null;

// ── Interaction state (hover + active drag) ───────────────────────────────────

export interface InteractionState {
  hover: HitResult;
  drag:  DragState;
}

// ── Interaction events (server-facing) ────────────────────────────────────────

/** Move a free point to a new position (math-space coordinates). */
export interface DragPointEvent {
  type: "drag_point";
  pointId: string;
  newX: number;   // math-space (Y-up)
  newY: number;
}

/** Change a circle's radius by dragging its border. */
export interface DragCircleRadiusEvent {
  type: "drag_radius";
  circleId: string;
  /** Mouse position in math-space (Y-up). Server computes distance to center. */
  mouseX: number;
  mouseY: number;
}

export type InteractionEvent = DragPointEvent | DragCircleRadiusEvent;

// ── Interaction result ────────────────────────────────────────────────────────

export interface InteractionResult {
  scene: unknown;  // updated SceneGraph (as plain object, ready for JSON)
  svg: string;
  errors: { message: string; path?: string }[];
  warnings: string[];
}

