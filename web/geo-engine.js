"use strict";
var GeoEngine = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/pipeline/run-from-canonical.ts
  var run_from_canonical_exports = {};
  __export(run_from_canonical_exports, {
    runFromCanonical: () => runFromCanonical
  });

  // src/runtime/compiler.ts
  function compileToRuntimeGraph(ir) {
    const rawNodes = [];
    const edges = [];
    for (const entity of ir.entities) {
      const { node, deps } = compileEntity(entity);
      rawNodes.push(node);
      for (const dep of deps) {
        edges.push({ from: dep, to: node.id });
      }
    }
    const nodes = topoSort(rawNodes, edges);
    const byId = /* @__PURE__ */ new Map();
    for (const n of nodes) byId.set(n.id, n);
    const downstream = /* @__PURE__ */ new Map();
    for (const { from, to } of edges) {
      if (!downstream.has(from)) downstream.set(from, []);
      downstream.get(from).push(to);
    }
    return { nodes, edges, byId, downstream };
  }
  function compileEntity(entity) {
    switch (entity.kind) {
      case "point":
        return compilePoint(entity);
      case "line":
        return compileLine(entity);
      case "ray":
        return compileRay(entity);
      case "circle":
        return compileCircle(entity);
      case "vector":
        return compileVector(entity);
      case "angle": {
        const pts = entity.construction.points;
        return {
          node: {
            id: entity.id,
            kind: "angle",
            refs: [...pts],
            label: entity.label
          },
          deps: [...pts]
        };
      }
      case "segment": {
        const { a, b } = entity.construction;
        return {
          node: {
            id: entity.id,
            kind: "segment",
            refs: [a, b],
            label: entity.label
          },
          deps: [a, b]
        };
      }
      case "triangle": {
        const verts = entity.construction.vertices;
        return {
          node: {
            id: entity.id,
            kind: "triangle",
            refs: [...verts],
            label: entity.label
          },
          deps: [...verts]
        };
      }
      case "polygon": {
        const verts = entity.construction.vertices;
        const polyNode = {
          id: entity.id,
          kind: "polygon",
          refs: [...verts],
          label: entity.label
        };
        return { node: polyNode, deps: [...verts] };
      }
      case "radius_parameter":
      case "length_parameter":
      case "angle_parameter":
      case "line_parameter": {
        const param = {
          id: entity.id,
          kind: entity.kind,
          value: entity.construction.value,
          min: entity.min,
          max: entity.max,
          label: entity.label
        };
        return { node: param, deps: [] };
      }
    }
  }
  function compilePoint(e) {
    const c = e.construction;
    if (!c || c.type === "free_point") {
      return { node: {
        id: e.id,
        kind: "point",
        construction: { type: "free_point" },
        label: e.label,
        origin: e.origin
      }, deps: [] };
    }
    switch (c.type) {
      case "midpoint":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.a, c.b]
        };
      case "line_intersection":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.line1, c.line2]
        };
      case "foot_of_perpendicular":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.fromPoint, c.toLine]
        };
      case "angle_bisector_foot":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.vertex, c.angle, c.toSegment]
        };
      case "circumcenter":
      case "incenter":
      case "centroid":
      case "orthocenter":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.triangle]
        };
      case "point_on_circle":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: c.angle ? [c.circle, c.angle] : [c.circle]
        };
      case "point_on_line": {
        const deps = c.parameter ? [c.line, c.parameter] : [c.line];
        return { node: {
          id: e.id,
          kind: "point",
          construction: { ...c },
          label: e.label,
          origin: e.origin
        }, deps };
      }
      case "antipode":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.circle, c.point]
        };
      case "reflect":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.point, c.line]
        };
      case "translate":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.point, c.vector]
        };
      case "rotate":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.point, c.center, c.angle]
        };
      case "projection":
        return {
          node: { id: e.id, kind: "point", construction: c, label: e.label },
          deps: [c.point, c.toLine]
        };
    }
  }
  function compileLine(e) {
    const c = e.construction;
    switch (c.type) {
      case "free_line":
        return {
          node: { id: e.id, kind: "line", construction: c, label: e.label },
          deps: []
        };
      case "line_through_points":
        return {
          node: { id: e.id, kind: "line", construction: c, label: e.label },
          deps: [c.a, c.b]
        };
      case "parallel_through_point":
      case "perpendicular_through_point":
        return {
          node: { id: e.id, kind: "line", construction: c, label: e.label },
          deps: [c.point, c.toLine]
        };
      case "tangent_at_point":
        return {
          node: { id: e.id, kind: "line", construction: c, label: e.label },
          deps: [c.circle, c.point]
        };
      case "perpendicular_bisector":
        return {
          node: { id: e.id, kind: "line", construction: c, label: e.label },
          deps: [c.segment]
        };
      case "angle_bisector_line":
        return {
          node: { id: e.id, kind: "line", construction: c, label: e.label },
          deps: [c.angle]
        };
    }
  }
  function compileRay(e) {
    const c = e.construction;
    switch (c.type) {
      case "ray_from_point_through_point":
        return {
          node: { id: e.id, kind: "ray", construction: c, label: e.label },
          deps: [c.origin, c.through]
        };
      case "angle_bisector_ray":
        return {
          node: { id: e.id, kind: "ray", construction: c, label: e.label },
          deps: [c.angle]
        };
    }
  }
  function compileCircle(e) {
    const c = e.construction;
    switch (c.type) {
      case "circle_center_radius":
        return {
          node: { id: e.id, kind: "circle", construction: c, label: e.label },
          deps: [c.center, c.radius]
        };
      case "circle_center_through_point":
        return {
          node: { id: e.id, kind: "circle", construction: c, label: e.label },
          deps: [c.center, c.through]
        };
      case "circumcircle":
      case "incircle":
        return {
          node: { id: e.id, kind: "circle", construction: c, label: e.label },
          deps: [c.triangle]
        };
    }
  }
  function compileVector(e) {
    const c = e.construction;
    switch (c.type) {
      case "vector_from_points":
        return {
          node: { id: e.id, kind: "vector", construction: c, label: e.label },
          deps: [c.from, c.to]
        };
      case "direction_of_line":
        return {
          node: { id: e.id, kind: "vector", construction: c, label: e.label },
          deps: [c.line]
        };
    }
  }
  function topoSort(nodes, edges) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const inDeg = new Map(nodes.map((n) => [n.id, 0]));
    const adjOut = new Map(nodes.map((n) => [n.id, []]));
    for (const { from, to } of edges) {
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
      adjOut.get(from)?.push(to);
    }
    const queue = [];
    for (const [id, deg] of inDeg) {
      if (deg === 0) queue.push(id);
    }
    const sorted = [];
    while (queue.length > 0) {
      const id = queue.shift();
      const node = byId.get(id);
      if (node) sorted.push(node);
      for (const next of adjOut.get(id) ?? []) {
        const deg = (inDeg.get(next) ?? 0) - 1;
        inDeg.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }
    if (sorted.length !== nodes.length) {
      const cycle = nodes.filter((n) => !sorted.includes(n)).map((n) => n.id);
      throw new Error(`Cycle detected in constraint graph. Involved nodes: ${cycle.join(", ")}`);
    }
    return sorted;
  }

  // src/solver/state.ts
  function initSolvedState(graph, freePoints = {}) {
    const state = /* @__PURE__ */ new Map();
    for (const node of graph.nodes) {
      if (node.kind === "point") {
        if (node.construction.type === "free_point") {
          const coords = freePoints[node.id] ?? { x: 0, y: 0 };
          state.set(node.id, { kind: "point", x: coords.x, y: coords.y });
        }
      } else if (node.kind === "line") {
        if (node.construction.type === "free_line") {
          const c = node.construction;
          let dx = c.dx, dy = c.dy;
          if (dx == null || dy == null) {
            const freeLineIdx = [...state.keys()].filter((k) => {
              const v = state.get(k);
              return v && v.kind === "line";
            }).length;
            const angle = freeLineIdx * (Math.PI / 4);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
          }
          state.set(node.id, {
            kind: "line",
            px: c.px ?? 0,
            py: c.py ?? 0,
            dx,
            dy
          });
        }
      } else if (node.kind === "radius_parameter" || node.kind === "length_parameter" || node.kind === "angle_parameter" || node.kind === "line_parameter") {
        state.set(node.id, { kind: "param", value: node.value ?? 0 });
      }
    }
    return state;
  }

  // src/solver/recompute.ts
  function solveAll(graph, state) {
    for (const node of graph.nodes) {
      if (state.has(node.id)) continue;
      const val = solveNode(node, state, graph);
      if (val !== null) state.set(node.id, val);
    }
    return state;
  }
  function solveNode(node, state, graph) {
    switch (node.kind) {
      case "point":
        return solvePoint(node, state, graph);
      case "line":
        return solveLine(node, state, graph);
      case "ray":
        return solveRay(node, state, graph);
      case "circle":
        return solveCircle(node, state, graph);
      case "vector":
        return solveVector(node, state, graph);
      case "radius_parameter":
      case "length_parameter":
      case "angle_parameter":
      case "line_parameter":
        return null;
      // parameters are set externally
      case "segment":
      case "triangle":
      case "angle":
      case "polygon":
        return null;
    }
  }
  function getPoint(id, state) {
    const v = state.get(id);
    if (!v || v.kind !== "point") throw new Error(`Expected point for "${id}"`);
    return { x: v.x, y: v.y };
  }
  function getLine(id, state) {
    const v = state.get(id);
    if (!v || v.kind !== "line") throw new Error(`Expected line for "${id}"`);
    return v;
  }
  function getCircle(id, state) {
    const v = state.get(id);
    if (!v || v.kind !== "circle") throw new Error(`Expected circle for "${id}"`);
    return v;
  }
  function getParam(id, state) {
    const v = state.get(id);
    if (!v || v.kind !== "param") throw new Error(`Expected param for "${id}"`);
    return v.value;
  }
  function getVector(id, state) {
    const v = state.get(id);
    if (!v || v.kind !== "vector") throw new Error(`Expected vector for "${id}"`);
    return v;
  }
  function getStructuralRefs(id, graph) {
    const n = graph.byId.get(id);
    if (!n) throw new Error(`Node not found: "${id}"`);
    if (n.kind !== "segment" && n.kind !== "triangle" && n.kind !== "angle") {
      throw new Error(`Expected structural node for "${id}", got "${n.kind}"`);
    }
    return n.refs;
  }
  function solvePoint(node, state, graph) {
    const c = node.construction;
    switch (c.type) {
      case "free_point":
        throw new Error(`free_point "${node.id}" reached solver unexpectedly`);
      case "midpoint": {
        const a = getPoint(c.a, state), b = getPoint(c.b, state);
        return pt((a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      case "line_intersection": {
        const l1 = getLine(c.line1, state), l2 = getLine(c.line2, state);
        return pt(...lineLineIntersection(l1, l2));
      }
      case "foot_of_perpendicular": {
        const p = getPoint(c.fromPoint, state), l = getLine(c.toLine, state);
        return pt(...footOnLine(p, l));
      }
      case "angle_bisector_foot": {
        const v = getPoint(c.vertex, state);
        const segRefs = getStructuralRefs(c.toSegment, graph);
        const a = getPoint(segRefs[0], state);
        const b = getPoint(segRefs[1], state);
        const ra = dist(v, a), rb = dist(v, b);
        const total = ra + rb;
        if (total < 1e-12) return pt(a.x, a.y);
        const t = ra / total;
        return pt(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
      }
      case "circumcenter": {
        const [A, B, C] = triPoints(c.triangle, graph, state);
        return pt(...circumcenter(A, B, C));
      }
      case "incenter": {
        const [A, B, C] = triPoints(c.triangle, graph, state);
        return pt(...incenter(A, B, C));
      }
      case "centroid": {
        const [A, B, C] = triPoints(c.triangle, graph, state);
        return pt((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3);
      }
      case "orthocenter": {
        const [A, B, C] = triPoints(c.triangle, graph, state);
        return pt(...orthocenter(A, B, C));
      }
      case "point_on_circle": {
        const circ2 = getCircle(c.circle, state);
        const theta = c.angle ? getParam(c.angle, state) : 0;
        return pt(
          circ2.cx + circ2.r * Math.cos(theta),
          circ2.cy + circ2.r * Math.sin(theta)
        );
      }
      case "point_on_line": {
        const l = getLine(c.line, state);
        const t = c.parameter ? getParam(c.parameter, state) : c.t ?? 0.4;
        const len = Math.hypot(l.dx, l.dy) || 1;
        return pt(l.px + t / len * l.dx, l.py + t / len * l.dy);
      }
      case "antipode": {
        const circ2 = getCircle(c.circle, state);
        const p = getPoint(c.point, state);
        return pt(2 * circ2.cx - p.x, 2 * circ2.cy - p.y);
      }
      case "reflect": {
        const p = getPoint(c.point, state);
        const axis = getLine(c.line, state);
        const [fx, fy] = footOnLine(p, axis);
        return pt(2 * fx - p.x, 2 * fy - p.y);
      }
      case "translate": {
        const p = getPoint(c.point, state);
        const vec = getVector(c.vector, state);
        return pt(p.x + vec.dx, p.y + vec.dy);
      }
      case "rotate": {
        const p = getPoint(c.point, state);
        const center = getPoint(c.center, state);
        const theta = getParam(c.angle, state);
        const dx = p.x - center.x, dy = p.y - center.y;
        return pt(
          center.x + dx * Math.cos(theta) - dy * Math.sin(theta),
          center.y + dx * Math.sin(theta) + dy * Math.cos(theta)
        );
      }
      case "projection": {
        const p = getPoint(c.point, state);
        const l = getLine(c.toLine, state);
        return pt(...footOnLine(p, l));
      }
      default: {
        const _ = c;
        throw new Error(`Unhandled point construction: ${_.type}`);
      }
    }
  }
  function solveLine(node, state, graph) {
    const c = node.construction;
    switch (c.type) {
      case "free_line":
        return null;
      // position/direction set externally via initSolvedState
      case "line_through_points": {
        const a = getPoint(c.a, state), b = getPoint(c.b, state);
        return ln(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      case "parallel_through_point": {
        const p = getPoint(c.point, state);
        const ref = getLine(c.toLine, state);
        return ln(p.x, p.y, ref.dx, ref.dy);
      }
      case "perpendicular_through_point": {
        const p = getPoint(c.point, state);
        const ref = getLine(c.toLine, state);
        return ln(p.x, p.y, -ref.dy, ref.dx);
      }
      case "tangent_at_point": {
        const circ2 = getCircle(c.circle, state);
        const p = getPoint(c.point, state);
        const rx = p.x - circ2.cx, ry2 = p.y - circ2.cy;
        return ln(p.x, p.y, -ry2, rx);
      }
      case "angle_bisector_line": {
        const refs = getStructuralRefs(c.angle, graph);
        const arm1 = getPoint(refs[0], state);
        const v = getPoint(refs[1], state);
        const arm2 = getPoint(refs[2], state);
        const d1 = normalize(sub(arm1, v));
        const d2 = normalize(sub(arm2, v));
        return ln(v.x, v.y, d1.x + d2.x, d1.y + d2.y);
      }
      case "perpendicular_bisector": {
        const [aId, bId] = getStructuralRefs(c.segment, graph);
        const a = getPoint(aId, state), b = getPoint(bId, state);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = -(b.y - a.y), dy = b.x - a.x;
        return ln(mx, my, dx, dy);
      }
      default: {
        const _ = c;
        throw new Error(`Unhandled line construction: ${_.type}`);
      }
    }
  }
  function solveRay(node, state, graph) {
    const c = node.construction;
    switch (c.type) {
      case "ray_from_point_through_point": {
        const o = getPoint(c.origin, state), t = getPoint(c.through, state);
        return ry(o.x, o.y, t.x - o.x, t.y - o.y);
      }
      case "angle_bisector_ray": {
        const refs = getStructuralRefs(c.angle, graph);
        const arm1 = getPoint(refs[0], state);
        const v = getPoint(refs[1], state);
        const arm2 = getPoint(refs[2], state);
        const d1 = normalize(sub(arm1, v));
        const d2 = normalize(sub(arm2, v));
        return ry(v.x, v.y, d1.x + d2.x, d1.y + d2.y);
      }
      default: {
        const _ = c;
        throw new Error(`Unhandled ray construction: ${_.type}`);
      }
    }
  }
  function solveCircle(node, state, graph) {
    const c = node.construction;
    switch (c.type) {
      case "circle_center_radius": {
        const center = getPoint(c.center, state);
        const r = getParam(c.radius, state);
        return circ(center.x, center.y, r);
      }
      case "circle_center_through_point": {
        const center = getPoint(c.center, state);
        const through = getPoint(c.through, state);
        return circ(center.x, center.y, dist(center, through));
      }
      case "circumcircle": {
        const [A, B, C] = triPoints(c.triangle, graph, state);
        const [cx, cy] = circumcenter(A, B, C);
        return circ(cx, cy, dist({ x: cx, y: cy }, A));
      }
      case "incircle": {
        const [A, B, C] = triPoints(c.triangle, graph, state);
        const [ix, iy] = incenter(A, B, C);
        const a = dist(B, C), b = dist(C, A), cLen = dist(A, B);
        const s = (a + b + cLen) / 2;
        const area = Math.abs(cross2(sub(B, A), sub(C, A))) / 2;
        return circ(ix, iy, area / s);
      }
      default: {
        const _ = c;
        throw new Error(`Unhandled circle construction: ${_.type}`);
      }
    }
  }
  function solveVector(node, state, graph) {
    const c = node.construction;
    switch (c.type) {
      case "vector_from_points": {
        const from = getPoint(c.from, state), to = getPoint(c.to, state);
        return { kind: "vector", dx: to.x - from.x, dy: to.y - from.y };
      }
      case "direction_of_line": {
        const l = getLine(c.line, state);
        const len = Math.hypot(l.dx, l.dy) || 1;
        return { kind: "vector", dx: l.dx / len, dy: l.dy / len };
      }
      default: {
        const _ = c;
        throw new Error(`Unhandled vector construction: ${_.type}`);
      }
    }
  }
  var pt = (x, y) => ({ kind: "point", x, y });
  var ln = (px, py, dx, dy) => ({ kind: "line", px, py, dx, dy });
  var ry = (px, py, dx, dy) => ({ kind: "ray", px, py, dx, dy });
  var circ = (cx, cy, r) => ({ kind: "circle", cx, cy, r });
  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }
  function cross2(a, b) {
    return a.x * b.y - a.y * b.x;
  }
  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function normalize(v) {
    const m = Math.hypot(v.x, v.y);
    return m < 1e-12 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
  }
  function footOnLine(p, l) {
    const dd = dot({ x: l.dx, y: l.dy }, { x: l.dx, y: l.dy });
    if (dd < 1e-24) return [l.px, l.py];
    const t = dot(sub(p, { x: l.px, y: l.py }), { x: l.dx, y: l.dy }) / dd;
    return [l.px + t * l.dx, l.py + t * l.dy];
  }
  function lineLineIntersection(l1, l2) {
    const d1 = { x: l1.dx, y: l1.dy }, d2 = { x: l2.dx, y: l2.dy };
    const denom = cross2(d1, d2);
    if (Math.abs(denom) < 1e-12) {
      return [(l1.px + l2.px) / 2, (l1.py + l2.py) / 2];
    }
    const diff = sub({ x: l2.px, y: l2.py }, { x: l1.px, y: l1.py });
    const t = cross2(diff, d2) / denom;
    return [l1.px + t * l1.dx, l1.py + t * l1.dy];
  }
  function triPoints(triId, graph, state) {
    const refs = getStructuralRefs(triId, graph);
    return [getPoint(refs[0], state), getPoint(refs[1], state), getPoint(refs[2], state)];
  }
  function circumcenter(A, B, C) {
    const midAB = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const midAC = { x: (A.x + C.x) / 2, y: (A.y + C.y) / 2 };
    const AB = sub(B, A), AC = sub(C, A);
    const bisAB = { kind: "line", px: midAB.x, py: midAB.y, dx: -AB.y, dy: AB.x };
    const bisAC = { kind: "line", px: midAC.x, py: midAC.y, dx: -AC.y, dy: AC.x };
    return lineLineIntersection(bisAB, bisAC);
  }
  function incenter(A, B, C) {
    const a = dist(B, C), b = dist(C, A), c = dist(A, B);
    const s = a + b + c;
    return [
      (a * A.x + b * B.x + c * C.x) / s,
      (a * A.y + b * B.y + c * C.y) / s
    ];
  }
  function orthocenter(A, B, C) {
    const [ox, oy] = circumcenter(A, B, C);
    return [
      A.x + B.x + C.x - 2 * ox,
      A.y + B.y + C.y - 2 * oy
    ];
  }

  // src/scene/annotations.ts
  var TICK_STYLES = ["single_tick", "double_tick", "triple_tick"];
  var ARC_STYLES = ["single_arc", "double_arc", "triple_arc"];
  function pairKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }
  function buildAnnotations(graph, ir) {
    const angleMarks = [];
    const rightAngleMarks = [];
    const segmentMarks = [];
    const seenSeg = /* @__PURE__ */ new Set();
    const seenRA = /* @__PURE__ */ new Set();
    const seenAngle = /* @__PURE__ */ new Set();
    const segByPair = /* @__PURE__ */ new Map();
    for (const node of graph.nodes) {
      if (node.kind === "segment") {
        const [a, b] = node.refs;
        segByPair.set(pairKey(a, b), node.id);
      }
    }
    function addSegMark(a, b, group, style) {
      const key = pairKey(a, b) + "|" + group;
      if (seenSeg.has(key)) return;
      seenSeg.add(key);
      segmentMarks.push({
        kind: "segment_mark",
        id: `smk_${a}_${b}_${group}`,
        a,
        b,
        group,
        markStyle: style
      });
    }
    function addAngleMark(p1, vertex, p2, group, style) {
      const key = `${p1}:${vertex}:${p2}|${group}`;
      if (seenAngle.has(key)) return;
      seenAngle.add(key);
      angleMarks.push({
        kind: "angle_mark",
        id: `amk_${p1}_${vertex}_${p2}_${group}`,
        points: [p1, vertex, p2],
        group,
        markStyle: style
      });
    }
    function addRightAngleMark(vertexId, line1Id, line2Id) {
      if (seenRA.has(vertexId)) return;
      seenRA.add(vertexId);
      rightAngleMarks.push({
        kind: "right_angle_mark",
        id: `ram_${vertexId}`,
        pointId: vertexId,
        line1Id,
        line2Id
      });
    }
    function angleRefs(angleId) {
      const n = graph.byId.get(angleId);
      if (n?.refs?.length === 3) return n.refs;
      return null;
    }
    for (const node of graph.nodes) {
      if (node.kind !== "point") continue;
      const c = node.construction;
      if (c.type === "midpoint" && segByPair.has(pairKey(c.a, c.b))) {
        const group = `midpt_${node.id}`;
        addSegMark(c.a, node.id, group, "single_tick");
        addSegMark(node.id, c.b, group, "single_tick");
      }
      if (c.type === "foot_of_perpendicular" || c.type === "projection") {
        const fromPt = c.type === "foot_of_perpendicular" ? c.fromPoint : c.point;
        const segId = segByPair.get(pairKey(fromPt, node.id));
        if (segId) addRightAngleMark(node.id, segId, c.toLine);
      }
      if (c.type === "angle_bisector_foot") {
        const refs = angleRefs(c.angle);
        if (refs) {
          const [sideA, vertex, sideB] = refs;
          const group = `bisect_${node.id}`;
          addAngleMark(sideA, vertex, node.id, group, "double_arc");
          addAngleMark(node.id, vertex, sideB, group, "double_arc");
        }
      }
    }
    for (const node of graph.nodes) {
      if (node.kind !== "line" && node.kind !== "ray") continue;
      const c = node.construction;
      if (node.kind === "line" && c.type === "angle_bisector_line" || node.kind === "ray" && c.type === "angle_bisector_ray") {
        const angleId = c.angle;
        const refs = angleRefs(angleId);
        if (!refs) continue;
        const [sideA, vertex, sideB] = refs;
        const footNode = graph.nodes.find(
          (n) => n.kind === "point" && n.construction.type === "angle_bisector_foot" && n.construction.angle === angleId
        );
        if (footNode) {
          const group = `bisect_${node.id}`;
          addAngleMark(sideA, vertex, footNode.id, group, "double_arc");
          addAngleMark(footNode.id, vertex, sideB, group, "double_arc");
        }
      }
      if (node.kind === "line" && c.type === "perpendicular_bisector") {
        const segNode = graph.byId.get(c.segment);
        if (segNode?.refs?.length === 2) {
          const [a, b] = segNode.refs;
          const midNode = graph.nodes.find((n) => {
            if (n.kind !== "point") return false;
            const mc = n.construction;
            return mc.type === "midpoint" && (mc.a === a && mc.b === b || mc.a === b && mc.b === a);
          });
          if (midNode) {
            const segId = segByPair.get(pairKey(a, midNode.id)) ?? segByPair.get(pairKey(midNode.id, b));
            if (segId) addRightAngleMark(midNode.id, segId, node.id);
          }
        }
      }
    }
    if (ir?.relations) {
      let eqLenIdx = 0;
      let eqAngIdx = 0;
      for (const rel of ir.relations) {
        if (rel.type === "equal_length") {
          const style = TICK_STYLES[Math.min(eqLenIdx, TICK_STYLES.length - 1)];
          const group = `eq_len_${eqLenIdx}`;
          const s1 = graph.byId.get(rel.seg1);
          const s2 = graph.byId.get(rel.seg2);
          if (s1 && s1.refs && s1.refs.length >= 2) addSegMark(s1.refs[0], s1.refs[1], group, style);
          if (s2 && s2.refs && s2.refs.length >= 2) addSegMark(s2.refs[0], s2.refs[1], group, style);
          eqLenIdx++;
        }
        if (rel.type === "equal_angle") {
          const style = ARC_STYLES[Math.min(eqAngIdx, ARC_STYLES.length - 1)];
          const group = `eq_ang_${eqAngIdx}`;
          const a1 = graph.byId.get(rel.ang1);
          const a2 = graph.byId.get(rel.ang2);
          if (a1?.refs?.length === 3) addAngleMark(a1.refs[0], a1.refs[1], a1.refs[2], group, style);
          if (a2?.refs?.length === 3) addAngleMark(a2.refs[0], a2.refs[1], a2.refs[2], group, style);
          eqAngIdx++;
        }
      }
    }
    return { angleMarks, rightAngleMarks, segmentMarks };
  }

  // src/scene/builder.ts
  function buildSceneGraph(graph, state, ir) {
    const points = [];
    const geometry = [];
    const angleMarks = [];
    for (const node of graph.nodes) {
      switch (node.kind) {
        // ── Point ─────────────────────────────────────────────────────────────
        case "point": {
          const v = state.get(node.id);
          if (!v || v.kind !== "point") break;
          if (node.origin === "implicit") break;
          const c = node.construction;
          const isFree = c.type === "free_point";
          const isAnglePt = c.type === "point_on_circle" && !!c.angle;
          points.push({
            kind: "point",
            id: node.id,
            label: node.label,
            x: v.x,
            y: v.y,
            origin: isFree ? "explicit" : "derived",
            interaction: {
              hoverable: true,
              draggable: isFree || isAnglePt,
              editMode: isFree ? "move_point" : isAnglePt ? "change_angle" : "none",
              kind: isFree ? "free_point" : isAnglePt ? "parameter_handle" : "derived_point",
              ...(isAnglePt ? { constrainedToCircle: c.circle } : {}),
            }
          });
          break;
        }
        // ── Line ──────────────────────────────────────────────────────────────
        case "line": {
          const v = state.get(node.id);
          if (!v || v.kind !== "line") break;
          const c = node.construction;
          if (c.type === "line_through_points") {
            const [pa, pb] = [c.a, c.b];
            const hasCoveringSegment = graph.nodes.some(
              (n) => n.kind === "segment" && (n.refs[0] === pa && n.refs[1] === pb || n.refs[0] === pb && n.refs[1] === pa)
            );
            if (hasCoveringSegment) {
              geometry.push({ kind: "line", id: node.id, label: node.label, a: pa, b: pb, visible: false });
              break;
            }
          }
          if (c.type === "free_line") {
            const anchorId = `${node.id}__anchor`;
            points.push(invisiblePoint(anchorId, v.px, v.py));
            geometry.push({
              kind: "line",
              id: node.id,
              label: node.label,
              throughPointId: anchorId,
              direction: { x: v.dx, y: v.dy }
            });
          } else if (c.type === "line_through_points") {
            const aNode = graph.nodes.find((n) => n.id === c.a);
            const bNode = graph.nodes.find((n) => n.id === c.b);
            const hasImplicit = aNode?.kind === "point" && aNode.origin === "implicit" || bNode?.kind === "point" && bNode.origin === "implicit";
            if (hasImplicit) {
              const anchorId = `${node.id}__anchor`;
              points.push(invisiblePoint(anchorId, v.px, v.py));
              geometry.push({
                kind: "line",
                id: node.id,
                label: node.label,
                throughPointId: anchorId,
                direction: { x: v.dx, y: v.dy }
              });
            } else {
              geometry.push({ kind: "line", id: node.id, label: node.label, a: c.a, b: c.b });
            }
          } else {
            const anchorId = `${node.id}__anchor`;
            points.push(invisiblePoint(anchorId, v.px, v.py));
            geometry.push({
              kind: "line",
              id: node.id,
              label: node.label,
              throughPointId: anchorId,
              direction: { x: v.dx, y: v.dy }
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
              kind: "ray",
              id: node.id,
              label: node.label,
              originPoint: c.origin,
              throughPoint: c.through
            });
          } else {
            const angleNode = graph.byId.get(c.angle);
            const vertexId = angleNode?.refs[1] ?? "";
            if (vertexId) {
              geometry.push({
                kind: "ray",
                id: node.id,
                label: node.label,
                originPoint: vertexId,
                direction: { x: v.dx, y: v.dy }
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
          let centerId;
          let canResize = false;
          if (c.type === "circle_center_radius") {
            centerId = c.center;
            canResize = true;
          } else if (c.type === "circle_center_through_point") {
            centerId = c.center;
          } else {
            const centerType = c.type === "circumcircle" ? "circumcenter" : "incenter";
            const namedCenter = graph.nodes.find((n) => {
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
            kind: "circle",
            id: node.id,
            label: node.label,
            center: centerId,
            radius: v.r,
            interaction: canResize ? { hoverable: true, editMode: "change_radius", hitTarget: "border" } : { hoverable: false, editMode: "none" }
          });
          break;
        }
        // ── Segment ───────────────────────────────────────────────────────────
        case "segment": {
          const seg = {
            kind: "segment",
            id: node.id,
            label: node.label,
            a: node.refs[0],
            b: node.refs[1]
          };
          geometry.push(seg);
          break;
        }
        // ── Triangle ──────────────────────────────────────────────────────────
        case "triangle": {
          const [a, b, c] = node.refs;
          const side0 = { kind: "segment", id: `${node.id}__side_0`, a, b };
          const side1 = { kind: "segment", id: `${node.id}__side_1`, a: b, b: c };
          const side2 = { kind: "segment", id: `${node.id}__side_2`, a: c, b: a };
          geometry.push(side0, side1, side2);
          const tri = {
            kind: "triangle",
            id: node.id,
            label: node.label,
            points: [a, b, c]
          };
          geometry.push(tri);
          break;
        }
        // ── Angle → AngleMark ─────────────────────────────────────────────────
        case "angle": {
          angleMarks.push({
            kind: "angle_mark",
            markStyle: "single_arc",
            id: node.id,
            label: node.label,
            points: [node.refs[0], node.refs[1], node.refs[2]]
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
            kind: "polygon",
            id: node.id,
            label: node.label,
            points: [...node.refs]
          });
          break;
        }
      }
    }
    const {
      angleMarks: annoAngleMarks,
      rightAngleMarks,
      segmentMarks
    } = buildAnnotations(graph, ir);
    return {
      version: "scene-graph/v1.3",
      coordinateSystem: "math-y-up",
      points,
      geometry,
      angleMarks: [...angleMarks, ...annoAngleMarks],
      rightAngleMarks,
      segmentMarks
    };
  }
  function invisiblePoint(id, x, y) {
    return {
      kind: "point",
      id,
      x,
      y,
      visible: false,
      interaction: { hoverable: false, draggable: false }
    };
  }

  // src/scene/layout.ts
  function layout(scene) {
    const hasCoords = scene.points.filter((p) => typeof p.x === "number" && typeof p.y === "number");
    const needsCoords = scene.points.filter((p) => typeof p.x !== "number" || typeof p.y !== "number");
    const n = needsCoords.length;
    const ringR = 3;
    const cx = hasCoords.length ? hasCoords.reduce((s, p) => s + p.x, 0) / hasCoords.length : 0;
    const cy = hasCoords.length ? hasCoords.reduce((s, p) => s + p.y, 0) / hasCoords.length : 0;
    const positioned = [
      ...hasCoords.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        visible: p.visible,
        label: p.label ?? p.id,
        labelOffset: { dx: 8, dy: -8 },
        interaction: p.interaction
      })),
      ...needsCoords.map((p, i) => {
        const angle = 2 * Math.PI * i / Math.max(n, 1);
        return {
          id: p.id,
          x: cx + ringR * Math.cos(angle),
          y: cy + ringR * Math.sin(angle),
          visible: p.visible,
          label: p.label ?? p.id,
          labelOffset: { dx: 8, dy: -8 },
          interaction: p.interaction
        };
      })
    ];
    const xs = positioned.map((p) => p.x);
    const ys = positioned.map((p) => p.y);
    return {
      points: positioned,
      geometry: scene.geometry,
      angleMarks: scene.angleMarks,
      rightAngleMarks: scene.rightAngleMarks,
      segmentMarks: scene.segmentMarks,
      labels: scene.labels ?? [],
      boundingBox: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      }
    };
  }

  // src/scene/viewport.ts
  var CANVAS_W = 1200;
  var CANVAS_H = 1200;
  var PADDING = 20;
  function computeViewport(scene, fixedScale, fixedOffX, fixedOffY) {
    const { boundingBox: bb } = scene;
    const pointById = new Map(scene.points.map((p) => [p.id, p]));
    let { minX, minY, maxX, maxY } = bb;
    for (const geo of scene.geometry) {
      if (geo.kind === "circle" && typeof geo.radius === "number") {
        const c = pointById.get(geo.center);
        if (c) {
          const r = geo.radius;
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
      (CANVAS_H - 2 * PADDING) / bbH
    );
    const offX = fixedOffX ?? PADDING - minX * scale;
    const offY = fixedOffY ?? PADDING - minY * scale;
    return { scale, offX, offY, width: CANVAS_W, height: CANVAS_H };
  }

  // src/scene/style.ts
  var DEFAULT_POINT = {
    radius: 4,
    fill: "#1d4ed8",
    stroke: "#1d4ed8",
    strokeWidth: 1.5,
    labelFont: "sans-serif",
    labelSize: 14,
    labelColor: "#111827"
  };
  function applyStyles(scene, vp) {
    const { scale, offX, offY, width, height } = vp;
    const toCanvas = (x, y) => ({
      x: Math.round((offX + x * scale) * 100) / 100,
      y: Math.round((height - (offY + y * scale)) * 100) / 100
      // flip Y: math Y-up → SVG Y-down
    });
    const points = scene.points.map((p) => {
      const { x, y } = toCanvas(p.x, p.y);
      return { ...p, x, y, resolvedStyle: { ...DEFAULT_POINT } };
    });
    return {
      points,
      geometry: scene.geometry,
      angleMarks: scene.angleMarks,
      rightAngleMarks: scene.rightAngleMarks,
      segmentMarks: scene.segmentMarks,
      labels: scene.labels,
      viewport: { width, height, viewBox: `0 0 ${width} ${height}` },
      scale
    };
  }

  // src/renderer/svg.ts
  function escAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }
  function interactionAttr(meta) {
    if (!meta) return "";
    return ` data-interaction="${escAttr(JSON.stringify(meta))}"`;
  }
  function clipLine(x1, y1, x2, y2, W, H, tMin = -Infinity, tMax = Infinity) {
    const dx = x2 - x1, dy = y2 - y1;
    let lo = tMin, hi = tMax;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > hi) return false;
        if (r > lo) lo = r;
      } else {
        if (r < lo) return false;
        if (r < hi) hi = r;
      }
      return true;
    };
    if (!clip(-dx, x1) || !clip(dx, W - x1)) return null;
    if (!clip(-dy, y1) || !clip(dy, H - y1)) return null;
    if (lo >= hi) return null;
    return [x1 + lo * dx, y1 + lo * dy, x1 + hi * dx, y1 + hi * dy];
  }
  function renderGeometry(node, byId, viewport, scale) {
    if (node.visible === false) return "";
    const rolesAttr = node.roles?.length ? ` data-roles="${escAttr(node.roles.join(","))}"` : "";
    const interAttr = interactionAttr(node.interaction);
    if (node.kind === "triangle" || node.kind === "polygon") {
      const pts = node.points.map((pid) => {
        const p = byId.get(pid);
        return p ? `${p.x},${p.y}` : null;
      });
      if (pts.some((p) => p === null)) return "";
      const fillAttr = node.fill ? ` fill="${escAttr(node.fill)}"` : ` fill="none"`;
      const strokeAttr = node.strokeStyle ? ` stroke="${escAttr(node.strokeStyle)}"` : ` stroke="none"`;
      return `<polygon data-id="${escAttr(node.id)}"${rolesAttr}${interAttr} points="${pts.join(" ")}"${fillAttr}${strokeAttr} />`;
    }
    if (node.kind === "segment") {
      const p1 = byId.get(node.a), p2 = byId.get(node.b);
      if (!p1 || !p2) return "";
      return `<line data-id="${escAttr(node.id)}" data-a="${escAttr(node.a)}" data-b="${escAttr(node.b)}"${rolesAttr}${interAttr} x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#1f2937" stroke-width="2" />`;
    }
    if (node.kind === "ray") {
      const p1 = byId.get(node.originPoint);
      if (!p1) return "";
      let dx, dy;
      if ("throughPoint" in node) {
        const p2 = byId.get(node.throughPoint);
        if (!p2) return "";
        dx = p2.x - p1.x;
        dy = p2.y - p1.y;
      } else {
        dx = node.direction.x;
        dy = -node.direction.y;
      }
      const seg = clipLine(p1.x, p1.y, p1.x + dx, p1.y + dy, viewport.width, viewport.height, 0);
      if (!seg) return "";
      return `<line data-id="${escAttr(node.id)}"${rolesAttr}${interAttr} x1="${seg[0]}" y1="${seg[1]}" x2="${seg[2]}" y2="${seg[3]}" stroke="#1f2937" stroke-width="2" />`;
    }
    if (node.kind === "line") {
      let x1, y1, x2, y2;
      const isTwoPoint = "a" in node;
      if (isTwoPoint) {
        const p1 = byId.get(node.a), p2 = byId.get(node.b);
        if (!p1 || !p2) return "";
        x1 = p1.x;
        y1 = p1.y;
        x2 = p2.x;
        y2 = p2.y;
      } else {
        const p = byId.get(node.throughPointId);
        if (!p) return "";
        const dir = node.direction;
        const len = Math.sqrt(dir.x ** 2 + dir.y ** 2) || 1;
        const ux = dir.x / len, uy = -dir.y / len;
        x1 = p.x - ux;
        y1 = p.y - uy;
        x2 = p.x + ux;
        y2 = p.y + uy;
      }
      const seg = clipLine(x1, y1, x2, y2, viewport.width, viewport.height);
      if (!seg) return "";
      const dashAttr = isTwoPoint ? "" : ` stroke-dasharray="8,4"`;
      return `<line data-id="${escAttr(node.id)}"${rolesAttr}${interAttr} x1="${seg[0]}" y1="${seg[1]}" x2="${seg[2]}" y2="${seg[3]}" stroke="#374151" stroke-width="1.5"${dashAttr} />`;
    }
    if (node.kind === "circle") {
      const cp = byId.get(node.center);
      if (!cp) return "";
      return `<circle data-id="${escAttr(node.id)}" data-center-id="${escAttr(node.center)}"${rolesAttr}${interAttr} cx="${cp.x}" cy="${cp.y}" r="${node.radius * scale}" fill="none" stroke="#dc2626" stroke-width="2" />`;
    }
    return "";
  }
  function renderAngleMark(mark, byId, scale) {
    const [aId, vId, bId] = mark.points;
    const a = byId.get(aId), v = byId.get(vId), b = byId.get(bId);
    if (!a || !v || !b) return "";
    const arcCount = mark.markStyle === "triple_arc" ? 3 : mark.markStyle === "double_arc" ? 2 : 1;
    const R0 = mark.radius != null ? mark.radius * scale : 18;
    const ax = a.x - v.x, ay = a.y - v.y;
    const bx = b.x - v.x, by = b.y - v.y;
    const la = Math.sqrt(ax * ax + ay * ay) || 1;
    const lb = Math.sqrt(bx * bx + by * by) || 1;
    const sweep = ax * by - ay * bx > 0 ? 0 : 1;
    return Array.from({ length: arcCount }, (_, i) => {
      const R = R0 + i * 5;
      const sa = { x: v.x + ax / la * R, y: v.y + ay / la * R };
      const sb = { x: v.x + bx / lb * R, y: v.y + by / lb * R };
      return `<path data-id="${escAttr(mark.id)}" d="M ${sa.x} ${sa.y} A ${R} ${R} 0 0 ${sweep} ${sb.x} ${sb.y}" fill="none" stroke="#6366f1" stroke-width="1.5" />`;
    }).join("\n  ");
  }
  function getDirectionFromGeo(geoId, vertexId, byId, geoById) {
    const node = geoById.get(geoId), v = byId.get(vertexId);
    if (!node || !v) return null;
    let otherId;
    if (node.kind === "segment") otherId = node.a === vertexId ? node.b : node.a;
    else if (node.kind === "line" && "a" in node) otherId = node.a === vertexId ? node.b : node.a;
    else if (node.kind === "ray" && "throughPoint" in node) otherId = node.originPoint === vertexId ? node.throughPoint : node.originPoint;
    if (!otherId) return null;
    const other = byId.get(otherId);
    if (!other) return null;
    const dx = other.x - v.x, dy = other.y - v.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  }
  function renderRightAngleMark(mark, byId, geoById, scale) {
    const v = byId.get(mark.pointId);
    if (!v) return "";
    const u1 = getDirectionFromGeo(mark.line1Id, mark.pointId, byId, geoById);
    const u2 = getDirectionFromGeo(mark.line2Id, mark.pointId, byId, geoById);
    if (!u1 || !u2) return "";
    const s = (mark.size ?? 0.18) * scale;
    const c1x = v.x + u1.x * s, c1y = v.y + u1.y * s;
    const c2x = v.x + u2.x * s, c2y = v.y + u2.y * s;
    const cx = c1x + u2.x * s, cy = c1y + u2.y * s;
    return `<polyline data-id="${escAttr(mark.id)}" points="${c1x},${c1y} ${cx},${cy} ${c2x},${c2y}" fill="none" stroke="#1f2937" stroke-width="1.5" />`;
  }
  function renderSegmentMark(mark, byId, scale) {
    const a = byId.get(mark.a), b = byId.get(mark.b);
    if (!a || !b) return "";
    const count = mark.markStyle === "triple_tick" ? 3 : mark.markStyle === "double_tick" ? 2 : 1;
    const tickLen = (mark.size ?? 0.12) * scale;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = -dy / len, py = dx / len;
    const ux = dx / len, uy = dy / len;
    return Array.from({ length: count }, (_, i) => {
      const offset = (i - (count - 1) / 2) * 4;
      const ox = ux * offset, oy = uy * offset;
      return `<line data-id="${escAttr(mark.id)}" x1="${mx + ox - px * tickLen}" y1="${my + oy - py * tickLen}" x2="${mx + ox + px * tickLen}" y2="${my + oy + py * tickLen}" stroke="#6366f1" stroke-width="1.5" />`;
    }).join("\n  ");
  }
  function renderLabel(lbl, byId) {
    const target = byId.get(lbl.targetId);
    if (!target) return "";
    return `<text data-id="${escAttr(lbl.id)}" x="${target.x + (lbl.dx ?? 8)}" y="${target.y + (lbl.dy ?? -8)}" font-family="sans-serif" font-size="14" fill="#111827">${escAttr(lbl.text)}</text>`;
  }
  function renderSvg(scene) {
    const { viewport: vp, scale } = scene;
    const byId = new Map(scene.points.map((p) => [p.id, p]));
    const geoById = new Map(scene.geometry.map((g) => [g.id, g]));
    const explicitLabelTargets = new Set(scene.labels.map((l) => l.targetId));
    const geoEls = scene.geometry.map((n) => renderGeometry(n, byId, vp, scale)).filter(Boolean).join("\n  ");
    const angleMarkEls = scene.angleMarks.map((m) => renderAngleMark(m, byId, scale)).filter(Boolean).join("\n  ");
    const rightAngleMarkEls = scene.rightAngleMarks.map((m) => renderRightAngleMark(m, byId, geoById, scale)).filter(Boolean).join("\n  ");
    const segmentMarkEls = scene.segmentMarks.map((m) => renderSegmentMark(m, byId, scale)).filter(Boolean).join("\n  ");
    const labelEls = scene.labels.map((l) => renderLabel(l, byId)).filter(Boolean).join("\n  ");
    const pointEls = scene.points.map((p) => {
      if (p.visible === false) return "";
      const s = p.resolvedStyle;
      const interAttr = interactionAttr(p.interaction);
      const labelEl = !explicitLabelTargets.has(p.id) && p.label ? `
    <text x="${p.x + p.labelOffset.dx}" y="${p.y + p.labelOffset.dy}" font-family="${escAttr(s.labelFont)}" font-size="${s.labelSize}" fill="${escAttr(s.labelColor)}">${escAttr(p.label)}</text>` : "";
      return `<g data-point-id="${escAttr(p.id)}"${interAttr}>
    <circle cx="${p.x}" cy="${p.y}" r="${s.radius}" fill="${escAttr(s.fill)}" stroke="${escAttr(s.stroke)}" stroke-width="${s.strokeWidth}" />${labelEl}
  </g>`;
    }).join("\n  ");
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vp.width}" height="${vp.height}" viewBox="${vp.viewBox}">
  <rect width="100%" height="100%" fill="#ffffff" />
  ${geoEls}
  ${angleMarkEls}
  ${rightAngleMarkEls}
  ${segmentMarkEls}
  ${labelEls}
  ${pointEls}
</svg>`;
  }

  // src/pipeline/run-from-canonical.ts
  function runFromCanonical(ir, freePoints = {}, fixedScale, fixedOffX, fixedOffY) {
    const graph = compileToRuntimeGraph(ir);
    const state = initSolvedState(graph, freePoints);
    solveAll(graph, state);
    const scene = buildSceneGraph(graph, state, ir);
    const positioned = layout(scene);
    const vp = computeViewport(positioned, fixedScale, fixedOffX, fixedOffY);
    const styled = applyStyles(positioned, vp);
    const svg = renderSvg(styled);
    return { scene, svg, errors: [], warnings: [] };
  }
  return __toCommonJS(run_from_canonical_exports);
})();
