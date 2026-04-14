/**
 * scene/parse.ts — Raw JSON → SceneGraph.
 */
import type { SceneGraph } from "./schema.js";

export function parseSceneGraph(raw: unknown): SceneGraph {
  if (!raw || typeof raw !== "object") throw new Error("Input must be a JSON object");
  const obj = raw as Record<string, unknown>;
  const v = String(obj.version ?? "");
  const version = (v === "scene-graph/v1.1" ? "scene-graph/v1.1"
    : v === "scene-graph/v1.2" ? "scene-graph/v1.2"
    : v === "scene-graph/v1.3" ? "scene-graph/v1.3"
    : "scene-graph/v1") as "scene-graph/v1" | "scene-graph/v1.1" | "scene-graph/v1.2" | "scene-graph/v1.3";

  return {
    version,
    coordinateSystem: "math-y-up",
    points:           Array.isArray(obj.points)           ? obj.points           : [],
    geometry:         Array.isArray(obj.geometry)         ? obj.geometry         : [],
    angleMarks:       Array.isArray(obj.angleMarks)       ? obj.angleMarks       : [],
    rightAngleMarks:  Array.isArray(obj.rightAngleMarks)  ? obj.rightAngleMarks  : [],
    segmentMarks:     Array.isArray(obj.segmentMarks)     ? obj.segmentMarks     : [],
    labels:           Array.isArray(obj.labels)           ? obj.labels           : [],
  };
}
