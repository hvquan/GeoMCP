/**
 * runtime/compiler.ts — Canonical Geometry IR → Runtime Constraint Graph.
 *
 * What it does:
 *   1. Converts each CanonicalEntity to a RuntimeNode.
 *   2. Extracts dependency edges from construction fields.
 *   3. Topologically sorts nodes (roots first).
 *   4. Builds fast-lookup indexes (byId, downstream).
 *
 * What it does NOT do:
 *   • No geometry math (no x/y computation).
 *   • No validation of referenced ids (that is the IR validator's job).
 *   • No render concerns.
 *
 * Usage:
 *   import { compileToRuntimeGraph } from "./compiler.js";
 *   const graph = compileToRuntimeGraph(ir);
 */

import type {
  CanonicalGeometryIR,
  CanonicalEntity,
  CanonicalPoint,
  CanonicalLine,
  CanonicalRay,
  CanonicalCircle,
  CanonicalVector,
} from "../canonical/schema.js";

import type {
  RuntimeGraph,
  RuntimeNode,
  RuntimePointNode,
  RuntimeLineNode,
  RuntimeRayNode,
  RuntimeCircleNode,
  RuntimeParameterNode,
  RuntimeStructuralNode,
  RuntimeVectorNode,
  RuntimePolygonNode,
  DependencyEdge,
  NodeId,
} from "./schema.js";

// ── Public API ────────────────────────────────────────────────────────────────

export function compileToRuntimeGraph(ir: CanonicalGeometryIR): RuntimeGraph {
  const rawNodes: RuntimeNode[]  = [];
  const edges:    DependencyEdge[] = [];

  for (const entity of ir.entities) {
    const { node, deps } = compileEntity(entity);
    rawNodes.push(node);
    for (const dep of deps) {
      edges.push({ from: dep, to: node.id });
    }
  }

  // Topological sort so solvers can iterate nodes in dependency order.
  const nodes = topoSort(rawNodes, edges);

  // Index: id → node
  const byId = new Map<NodeId, RuntimeNode>();
  for (const n of nodes) byId.set(n.id, n);

  // Index: id → downstream node ids (for dirty propagation)
  const downstream = new Map<NodeId, NodeId[]>();
  for (const { from, to } of edges) {
    if (!downstream.has(from)) downstream.set(from, []);
    downstream.get(from)!.push(to);
  }

  return { nodes, edges, byId, downstream };
}

// ── Entity dispatch ───────────────────────────────────────────────────────────

function compileEntity(entity: CanonicalEntity): { node: RuntimeNode; deps: NodeId[] } {
  switch (entity.kind) {
    case "point":     return compilePoint(entity);
    case "line":      return compileLine(entity);
    case "ray":       return compileRay(entity);
    case "circle":    return compileCircle(entity);
    case "vector":    return compileVector(entity);
    case "angle": {
      const pts = entity.construction.points;
      return {
        node: { id: entity.id, kind: "angle",
                 refs: [...pts], label: entity.label } satisfies RuntimeStructuralNode,
        deps: [...pts],
      };
    }
    case "segment": {
      const { a, b } = entity.construction;
      return {
        node: { id: entity.id, kind: "segment",
                 refs: [a, b], label: entity.label } satisfies RuntimeStructuralNode,
        deps: [a, b],
      };
    }
    case "triangle": {
      const verts = entity.construction.vertices;
      return {
        node: { id: entity.id, kind: "triangle",
                 refs: [...verts], label: entity.label } satisfies RuntimeStructuralNode,
        deps: [...verts],
      };
    }
    case "polygon": {
      const verts = entity.construction.vertices;
      const polyNode: RuntimePolygonNode = {
        id: entity.id, kind: "polygon", refs: [...verts], label: entity.label,
      };
      return { node: polyNode, deps: [...verts] };
    }
    case "radius_parameter":
    case "length_parameter":
    case "angle_parameter":
    case "line_parameter": {
      const param: RuntimeParameterNode = {
        id: entity.id, kind: entity.kind,
        value: entity.construction.value, min: entity.min, max: entity.max, label: entity.label,
      };
      return { node: param, deps: [] };
    }
  }
}

// ── Point ─────────────────────────────────────────────────────────────────────

function compilePoint(e: CanonicalPoint): { node: RuntimePointNode; deps: NodeId[] } {
  const c = e.construction;

  if (!c || c.type === "free_point") {
    return { node: { id: e.id, kind: "point",
                     construction: { type: "free_point" }, label: e.label, origin: e.origin }, deps: [] };
  }

  switch (c.type) {
    case "midpoint":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.a, c.b] };

    case "line_intersection":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.line1, c.line2] };

    case "foot_of_perpendicular":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.fromPoint, c.toLine] };

    case "angle_bisector_foot":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.vertex, c.angle, c.toSegment] };

    case "circumcenter":
    case "incenter":
    case "centroid":
    case "orthocenter":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.triangle] };

    case "point_on_circle":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: c.angle ? [c.circle, c.angle] : [c.circle] };

    case "point_on_line":  {
      const deps: string[] = c.parameter ? [c.line, c.parameter] : [c.line];
      return { node: { id: e.id, kind: "point",
               construction: { ...c },
               label: e.label, origin: e.origin }, deps };
    }

    case "antipode":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.circle, c.point] };

    case "reflect":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.point, c.line] };

    case "translate":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.point, c.vector] };

    case "rotate":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.point, c.center, c.angle] };

    case "projection":
      return { node: { id: e.id, kind: "point", construction: c, label: e.label },
               deps: [c.point, c.toLine] };
  }
}

// ── Line ──────────────────────────────────────────────────────────────────────

function compileLine(e: CanonicalLine): { node: RuntimeLineNode; deps: NodeId[] } {
  const c = e.construction;

  switch (c.type) {
    case "free_line":
      return { node: { id: e.id, kind: "line", construction: c, label: e.label },
               deps: [] };

    case "line_through_points":
      return { node: { id: e.id, kind: "line", construction: c, label: e.label },
               deps: [c.a, c.b] };

    case "parallel_through_point":
    case "perpendicular_through_point":
      return { node: { id: e.id, kind: "line", construction: c, label: e.label },
               deps: [c.point, c.toLine] };

    case "tangent_at_point":
      return { node: { id: e.id, kind: "line", construction: c, label: e.label },
               deps: [c.circle, c.point] };

    case "perpendicular_bisector":
      return { node: { id: e.id, kind: "line", construction: c, label: e.label },
               deps: [c.segment] };

    case "angle_bisector_line":
      return { node: { id: e.id, kind: "line", construction: c, label: e.label },
               deps: [c.angle] };
  }
}

// ── Ray ───────────────────────────────────────────────────────────────────────

function compileRay(e: CanonicalRay): { node: RuntimeRayNode; deps: NodeId[] } {
  const c = e.construction;

  switch (c.type) {
    case "ray_from_point_through_point":
      return { node: { id: e.id, kind: "ray", construction: c, label: e.label },
               deps: [c.origin, c.through] };

    case "angle_bisector_ray":
      return { node: { id: e.id, kind: "ray", construction: c, label: e.label },
               deps: [c.angle] };
  }
}

// ── Circle ────────────────────────────────────────────────────────────────────

function compileCircle(e: CanonicalCircle): { node: RuntimeCircleNode; deps: NodeId[] } {
  const c = e.construction;

  switch (c.type) {
    case "circle_center_radius":
      return { node: { id: e.id, kind: "circle", construction: c, label: e.label },
               deps: [c.center, c.radius] };

    case "circle_center_through_point":
      return { node: { id: e.id, kind: "circle", construction: c, label: e.label },
               deps: [c.center, c.through] };

    case "circumcircle":
    case "incircle":
      return { node: { id: e.id, kind: "circle", construction: c, label: e.label },
               deps: [c.triangle] };
  }
}

// ── Vector ──────────────────────────────────────────────────────────────────────

function compileVector(e: CanonicalVector): { node: RuntimeVectorNode; deps: NodeId[] } {
  const c = e.construction;
  switch (c.type) {
    case "vector_from_points":
      return { node: { id: e.id, kind: "vector", construction: c, label: e.label },
               deps: [c.from, c.to] };
    case "direction_of_line":
      return { node: { id: e.id, kind: "vector", construction: c, label: e.label },
               deps: [c.line] };
  }
}

// ── Topological sort ──────────────────────────────────────────────────────────
//
// Kahn's algorithm.  Nodes with no dependencies come first (correct for a
// solver that resolves nodes in order).
// Throws if the graph has a cycle.

function topoSort(nodes: RuntimeNode[], edges: DependencyEdge[]): RuntimeNode[] {
  const byId   = new Map(nodes.map(n => [n.id, n]));
  const inDeg  = new Map<NodeId, number>(nodes.map(n => [n.id, 0]));
  const adjOut = new Map<NodeId, NodeId[]>(nodes.map(n => [n.id, []]));

  for (const { from, to } of edges) {
    inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
    adjOut.get(from)?.push(to);
  }

  const queue: NodeId[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  const sorted: RuntimeNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node) sorted.push(node);
    for (const next of (adjOut.get(id) ?? [])) {
      const deg = (inDeg.get(next) ?? 0) - 1;
      inDeg.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (sorted.length !== nodes.length) {
    const cycle = nodes.filter(n => !sorted.includes(n)).map(n => n.id);
    throw new Error(`Cycle detected in constraint graph. Involved nodes: ${cycle.join(", ")}`);
  }

  return sorted;
}
