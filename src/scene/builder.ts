/**
 * scene/builder.ts — Solved Geometry State → SceneGraph.
 *
 * Translates a fully-solved RuntimeGraph into the render-ready SceneGraph
 * (scene-graph/v1.3).  All coordinates stay in math-space (Y-up); the
 * scene/layout → scene/style pipeline will convert them to canvas-space.
 *
 * Mapping:
 *   RuntimePointNode      → ScenePoint  (interaction set by construction type)
 *   RuntimeLineNode       → SceneLine   (computed lines get an invisible anchor)
 *   RuntimeRayNode        → SceneRay
 *   RuntimeCircleNode     → SceneCircle (resizable circles carry interaction meta)
 *   RuntimeStructuralNode:
 *     segment  → SceneSegment
 *     triangle → SceneTriangle
 *     angle    → SceneAngleMark
 *   RuntimeParameterNode  → (no visual output)
 */

import type { RuntimeGraph, RuntimeStructuralNode, NodeId } from "../runtime/schema.js";
import type { SolvedState } from "../solver/recompute.js";
import type {
  SceneGraph, ScenePoint, SceneGeometryNode,
  SceneAngleMark, SceneRightAngleMark, SceneSegmentMark, SceneSegment, SceneTriangle,
} from "./schema.js";
import { buildAnnotations } from "./annotations.js";
import type { CanonicalGeometryIR } from "../canonical/schema.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a SceneGraph from a compiled + solved RuntimeGraph.
 *
 * @param graph  Topologically-sorted RuntimeGraph from runtime/compiler.ts
 * @param state  Fully-solved geometry state (call solveAll() before this)
 */
export function buildSceneGraph(
  graph: RuntimeGraph,
  state: SolvedState,
  ir?: CanonicalGeometryIR,
): SceneGraph {
  const points:     ScenePoint[]       = [];
  const geometry:   SceneGeometryNode[] = [];
  const angleMarks: SceneAngleMark[]   = [];

  for (const node of graph.nodes) {
    switch (node.kind) {

      // ── Point ─────────────────────────────────────────────────────────────
      case "point": {
        const v = state.get(node.id);
        if (!v || v.kind !== "point") break;

        // Implicit-origin points are structural anchors (e.g. hidden line endpoints) — skip
        if (node.origin === "implicit") break;

        const c           = node.construction;
        const isFree      = c.type === "free_point";
        const isAnglePt   = c.type === "point_on_circle" && !!(c.angle);

        points.push({
          kind:   "point",
          id:     node.id,
          label:  node.label,
          x:      v.x,
          y:      v.y,
          origin: isFree ? "explicit" : "derived",
          interaction: {
            hoverable: true,
            draggable: isFree || isAnglePt,
            editMode:  isFree ? "move_point" : isAnglePt ? "change_angle" : "none",
            kind:      isFree ? "free_point" : isAnglePt ? "parameter_handle" : "derived_point",
          },
        });
        break;
      }

      // ── Line ──────────────────────────────────────────────────────────────
      case "line": {
        const v = state.get(node.id);
        if (!v || v.kind !== "line") break;

        const c = node.construction;

        // Suppress an internally-created line_through_points(A,B) when a
        // segment between the exact same two endpoints already exists.
        // This prevents auxiliary reference lines (e.g. ln.CD created to
        // support foot_of_perpendicular) from rendering as infinite dashed
        // lines on top of their segment counterpart.
        if (c.type === "line_through_points") {
          const [pa, pb] = [c.a, c.b];
          const hasCoveringSegment = graph.nodes.some(
            n => n.kind === "segment" &&
                 ((n.refs[0] === pa && n.refs[1] === pb) ||
                  (n.refs[0] === pb && n.refs[1] === pa)),
          );
          if (hasCoveringSegment) {
            // Keep in geometry as invisible so geoById resolves it for
            // right-angle mark direction lookups, but don't render it.
            geometry.push({ kind: "line", id: node.id, label: node.label, a: pa, b: pb, visible: false });
            break;
          }
        }

        if (c.type === "free_line") {
          // Free line has no anchor points — use state's px/py + direction.
          const anchorId = `${node.id}__anchor`;
          points.push(invisiblePoint(anchorId, v.px, v.py));
          geometry.push({
            kind:           "line",
            id:             node.id,
            label:          node.label,
            throughPointId: anchorId,
            direction:      { x: v.dx, y: v.dy },
          });
        } else if (c.type === "line_through_points") {
          // If either endpoint is implicit (hidden anchor), fall back to the
          // anchor+direction form so the renderer doesn't need them in byId.
          const aNode = graph.nodes.find(n => n.id === c.a);
          const bNode = graph.nodes.find(n => n.id === c.b);
          const hasImplicit =
            (aNode?.kind === "point" && aNode.origin === "implicit") ||
            (bNode?.kind === "point" && bNode.origin === "implicit");
          if (hasImplicit) {
            const anchorId = `${node.id}__anchor`;
            points.push(invisiblePoint(anchorId, v.px, v.py));
            geometry.push({
              kind:           "line",
              id:             node.id,
              label:          node.label,
              throughPointId: anchorId,
              direction:      { x: v.dx, y: v.dy },
            });
          } else {
            // Both endpoints are named scene points; use the two-point form.
            geometry.push({ kind: "line", id: node.id, label: node.label, a: c.a, b: c.b });
          }
        } else {
          // Computed line — add an invisible anchor point for the renderer.
          const anchorId = `${node.id}__anchor`;
          points.push(invisiblePoint(anchorId, v.px, v.py));
          geometry.push({
            kind:          "line",
            id:            node.id,
            label:         node.label,
            throughPointId: anchorId,
            direction:     { x: v.dx, y: v.dy },
          });
        }
        break;
      }

      // ── Ray ───────────────────────────────────────────────────────────────
      case "ray": {
        const v = state.get(node.id);
        if (!v || v.kind !== "ray") break;

        const c = node.construction;

        if (c.type === "ray_from_point_through_point") {
          geometry.push({
            kind:        "ray",
            id:          node.id,
            label:       node.label,
            originPoint: c.origin,
            throughPoint: c.through,
          });
        } else {
          // angle_bisector — vertex is refs[1] of the angle structural node.
          const angleNode = graph.byId.get(c.angle) as RuntimeStructuralNode | undefined;
          const vertexId  = angleNode?.refs[1] ?? "";
          if (vertexId) {
            geometry.push({
              kind:        "ray",
              id:          node.id,
              label:       node.label,
              originPoint: vertexId,
              direction:   { x: v.dx, y: v.dy },
            });
          }
        }
        break;
      }

      // ── Circle ────────────────────────────────────────────────────────────
      case "circle": {
        const v = state.get(node.id);
        if (!v || v.kind !== "circle") break;

        const c = node.construction;
        let centerId: NodeId;
        let canResize = false;

        if (c.type === "circle_center_radius") {
          centerId  = c.center;
          canResize = true;
        } else if (c.type === "circle_center_through_point") {
          centerId = c.center;
        } else {
          // circumscribed / inscribed — reuse an existing named circumcenter/incenter
          // point if one is declared for the same triangle; otherwise synthesize one.
          const centerType = c.type === "circumcircle" ? "circumcenter" : "incenter";
          const namedCenter = graph.nodes.find(n => {
            if (n.kind !== "point") return false;
            const con = n.construction;
            return con.type === centerType && "triangle" in con && con.triangle === c.triangle;
          });
          if (namedCenter) {
            centerId = namedCenter.id;
          } else {
            centerId = `${node.id}__center`;
            points.push(invisiblePoint(centerId, v.cx, v.cy));
          }
        }

        geometry.push({
          kind:   "circle",
          id:     node.id,
          label:  node.label,
          center: centerId,
          radius: v.r,
          interaction: canResize
            ? { hoverable: true, editMode: "change_radius", hitTarget: "border" }
            : { hoverable: false, editMode: "none" },
        });
        break;
      }

      // ── Segment ───────────────────────────────────────────────────────────
      case "segment": {
        const seg: SceneSegment = {
          kind: "segment",
          id:   node.id,
          label: node.label,
          a:    node.refs[0],
          b:    node.refs[1],
        };
        geometry.push(seg);
        break;
      }

      // ── Triangle ──────────────────────────────────────────────────────────
      case "triangle": {
        const [a, b, c] = node.refs;
        // Auto-generate side segments so edges render with default stroke style.
        const side0: SceneSegment = { kind: "segment", id: `${node.id}__side_0`, a, b };
        const side1: SceneSegment = { kind: "segment", id: `${node.id}__side_1`, a: b, b: c };
        const side2: SceneSegment = { kind: "segment", id: `${node.id}__side_2`, a: c, b: a };
        geometry.push(side0, side1, side2);
        const tri: SceneTriangle = {
          kind:   "triangle",
          id:     node.id,
          label:  node.label,
          points: [a, b, c] as [string, string, string],
        };
        geometry.push(tri);
        break;
      }

      // ── Angle → AngleMark ─────────────────────────────────────────────────
      case "angle": {
        angleMarks.push({
          kind:      "angle_mark",
          markStyle: "single_arc",
          id:        node.id,
          label:     node.label,
          points:    [node.refs[0], node.refs[1], node.refs[2]] as [string, string, string],
        });
        break;
      }

      // ── Parameters / Vector — no visual output ──────────────────────────────────────
      case "radius_parameter":
      case "length_parameter":
      case "angle_parameter":
      case "vector":
        break;

      // ── Polygon ───────────────────────────────────────────────────────────────
      case "polygon": {
        geometry.push({
          kind:   "polygon",
          id:     node.id,
          label:  node.label,
          points: [...node.refs],
        });
        break;
      }
    }
  }

  // ── Annotation marks (second pass via annotations.ts) ──────────────────────
  const {
    angleMarks:      annoAngleMarks,
    rightAngleMarks,
    segmentMarks,
  } = buildAnnotations(graph, ir);

  return {
    version:         "scene-graph/v1.3",
    coordinateSystem: "math-y-up",
    points,
    geometry,
    angleMarks:      [...angleMarks, ...annoAngleMarks],
    rightAngleMarks,
    segmentMarks,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function invisiblePoint(id: NodeId, x: number, y: number): ScenePoint {
  return {
    kind:    "point",
    id,
    x,
    y,
    visible: false,
    interaction: { hoverable: false, draggable: false },
  };
}
