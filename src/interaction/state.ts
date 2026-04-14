/**
 * interaction/state.ts — Initial interaction state factory.
 */
import type { InteractionState } from "./types.js";

export function initialInteractionState(): InteractionState {
  return {
    hover: { kind: "none" },
    drag:  null,
  };
}
