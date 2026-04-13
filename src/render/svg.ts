import { AngleMark, LayoutModel, LineNode, CircleNode, RightAngleMark, SegmentMark } from "../model/types.js";
import { fitToViewport, toCanvasPoint, CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_PADDING } from "./viewport.js";
import { displayLabel } from "../model/normalize.js";

export interface CanvasPoint { id: string; x: number; y: number; }
export interface CanvasSegment { a: string; b: string; dashed?: boolean; }
export interface CanvasCircle { centerId: string; r: number; }

// ── Angle-arc markers ─────────────────────────────────────────────────────────

/**
 * Render small arc + tick marks for a list of AngleMark visual annotations.
 * Each AngleMark { points:[P, vertex, Q], group? } renders one arc at vertex.
 * Marks sharing the same `group` get a consistent tick count (1 tick per unique
 * group index within the input array, incrementing for repeated group names).
 */
function renderAngleArcMarks(
  angleMarks: AngleMark[],
  byId: Map<string, { x: number; y: number }>,
  tc: (x: number, y: number) => { x: number; y: number }
): string {
  if (angleMarks.length === 0) return "";

  const ARC_R   = 22;   // arc radius in SVG pixels
  const TICK_L  = 5;    // half-length of each tick mark
  const TICK_SP = 4;    // spacing between tick marks

  // Assign tick counts: groups at ordinal 0 → 1 tick, 1 → 2 ticks, etc.
  const groupOrdinal = new Map<string, number>();
  for (const m of angleMarks) {
    if (m.group && !groupOrdinal.has(m.group)) {
      groupOrdinal.set(m.group, groupOrdinal.size);
    }
  }

  function norm(dx: number, dy: number): [number, number] {
    const len = Math.hypot(dx, dy);
    return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
  }

  function arcMark(
    vx: number, vy: number,
    px: number, py: number,
    qx: number, qy: number,
    ticks: number
  ): string {
    const [dpx, dpy] = norm(px - vx, py - vy);
    const [dqx, dqy] = norm(qx - vx, qy - vy);
    if (dpx === 0 && dpy === 0) return "";
    if (dqx === 0 && dqy === 0) return "";

    const cross = dpx * dqy - dpy * dqx;
    if (Math.abs(cross) < 1e-6) return "";

    const sweep = cross > 0 ? 1 : 0;
    const sx = vx + ARC_R * dpx, sy = vy + ARC_R * dpy;
    const ex = vx + ARC_R * dqx, ey = vy + ARC_R * dqy;
    const arc = `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${ARC_R} ${ARC_R} 0 0 ${sweep} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="#1f2937" stroke-width="1.2" />`;

    let [dbx, dby] = norm(dpx + dqx, dpy + dqy);
    if (dbx === 0 && dby === 0) { dbx = -dpy; dby = dpx; }
    const pwx = -dby, pwy = dbx;

    const offsets: number[] = [];
    if (ticks === 1) offsets.push(0);
    else if (ticks === 2) offsets.push(-TICK_SP / 2, TICK_SP / 2);
    else for (let i = 0; i < ticks; i++) offsets.push((i - (ticks - 1) / 2) * TICK_SP);

    const tickLines = offsets.map((off) => {
      const mx = vx + ARC_R * dbx + off * dbx;
      const my = vy + ARC_R * dby + off * dby;
      return `<line x1="${(mx - TICK_L * pwx).toFixed(1)}" y1="${(my - TICK_L * pwy).toFixed(1)}" x2="${(mx + TICK_L * pwx).toFixed(1)}" y2="${(my + TICK_L * pwy).toFixed(1)}" stroke="#1f2937" stroke-width="1.2" />`;
    }).join("");

    return arc + tickLines;
  }

  const lookup = (id: string, byId: Map<string, { x: number; y: number }>) => {
    const raw = byId.get(id) ?? byId.get(id.replace(/^point:/, "").toUpperCase());
    return raw ? tc(raw.x, raw.y) : null;
  };

  const parts: string[] = [];
  for (const m of angleMarks) {
    const ticks = m.group !== undefined ? (groupOrdinal.get(m.group)! + 1) : 1;
    const [pid, vid, qid] = m.points;
    const p = lookup(pid, byId), v = lookup(vid, byId), q = lookup(qid, byId);
    if (p && v && q) parts.push(arcMark(v.x, v.y, p.x, p.y, q.x, q.y, ticks));
  }

  const inner = parts.filter(Boolean).join("\n  ");
  return inner ? `<g data-constraint="equal-angle">\n  ${inner}\n</g>` : "";
}

/**
 * Render small square box marks at perpendicular junctions.
 * Each `RightAngleMark { pointId, line1Id, line2Id }` draws a square at the
 * corner formed by the two lines meeting at `pointId`.
 * `line1Id` / `line2Id` are canonical edge keys "A:B" resolved via `lineNodes`.
 */
function renderRightAngleMarks(
  marks: RightAngleMark[],
  lineNodes: LineNode[],
  byId: Map<string, { x: number; y: number }>,
  tc: (x: number, y: number) => { x: number; y: number }
): string {
  if (marks.length === 0) return "";

  // Build a lookup from canonical edge key → LineNode.
  const lineByKey = new Map<string, LineNode>();
  for (const n of lineNodes) {
    const key = [n.a, n.b].sort().join(":");
    lineByKey.set(key, n);
  }

  const BOX_SIZE = 12;

  function normVec(dx: number, dy: number): [number, number] {
    const len = Math.hypot(dx, dy);
    return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
  }

  function lookupPt(id: string) {
    const raw = byId.get(id) ?? byId.get(id.replace(/^point:/, "").toUpperCase());
    return raw ? tc(raw.x, raw.y) : null;
  }

  // Given a line node and the vertex point, return the endpoint that gives the
  // best direction away from the vertex. When the vertex IS one of the endpoints,
  // return the other. When the vertex is an interior foot (not an endpoint —
  // e.g. altitude foot E on line AC), return the FARTHER endpoint so the
  // direction vector is never near-zero.
  function rayPoint(line: LineNode, vertexId: string): { x: number; y: number } | null {
    if (line.a === vertexId) return lookupPt(line.b);
    if (line.b === vertexId) return lookupPt(line.a);
    // Interior vertex: pick the endpoint farther from vertexId for a stable direction.
    const V = lookupPt(vertexId);
    const pA = lookupPt(line.a);
    const pB = lookupPt(line.b);
    if (!pA || !pB) return pA ?? pB;
    if (!V) return pA;
    const dA = Math.hypot(pA.x - V.x, pA.y - V.y);
    const dB = Math.hypot(pB.x - V.x, pB.y - V.y);
    return dA >= dB ? pA : pB;
  }

  const parts: string[] = [];
  for (const m of marks) {
    const V = lookupPt(m.pointId);
    const line1 = lineByKey.get(m.line1Id);
    const line2 = lineByKey.get(m.line2Id);
    if (!V || !line1 || !line2) continue;

    const P = rayPoint(line1, m.pointId);
    const Q = rayPoint(line2, m.pointId);
    if (!P || !Q) continue;

    const size = m.size ?? BOX_SIZE;
    const [d1x, d1y] = normVec(P.x - V.x, P.y - V.y);
    const [d2x, d2y] = normVec(Q.x - V.x, Q.y - V.y);
    if (d1x === 0 && d1y === 0) continue;
    if (d2x === 0 && d2y === 0) continue;

    const x1 = (V.x + size * d1x).toFixed(1);
    const y1 = (V.y + size * d1y).toFixed(1);
    const xc = (V.x + size * d1x + size * d2x).toFixed(1);
    const yc = (V.y + size * d1y + size * d2y).toFixed(1);
    const x2 = (V.x + size * d2x).toFixed(1);
    const y2 = (V.y + size * d2y).toFixed(1);

    parts.push(`<path d="M ${x1} ${y1} L ${xc} ${yc} L ${x2} ${y2}" fill="none" stroke="#1f2937" stroke-width="1.2" />`);
  }

  const inner = parts.join("\n  ");
  return inner ? `<g data-constraint="right-angle">\n  ${inner}\n</g>` : "";
}

/**
 * Render perpendicular tick marks at the midpoint of each annotated segment.
 * Marks sharing the same `group` receive the same tick count (1 tick for group
 * ordinal 0, 2 ticks for 1, etc.).
 */
function renderSegmentMarks(
  marks: SegmentMark[],
  byId: Map<string, { x: number; y: number }>,
  tc: (x: number, y: number) => { x: number; y: number }
): string {
  if (marks.length === 0) return "";

  const TICK_L = 5;   // half-length of each tick
  const TICK_SP = 4;  // spacing between multiple ticks

  const groupOrdinal = new Map<string, number>();
  for (const m of marks) {
    if (m.group && !groupOrdinal.has(m.group)) {
      groupOrdinal.set(m.group, groupOrdinal.size);
    }
  }

  function norm(dx: number, dy: number): [number, number] {
    const len = Math.hypot(dx, dy);
    return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
  }

  function lookup(id: string) {
    const raw = byId.get(id) ?? byId.get(id.replace(/^point:/, "").toUpperCase());
    return raw ? tc(raw.x, raw.y) : null;
  }

  const parts: string[] = [];
  for (const m of marks) {
    const A = lookup(m.a);
    const B = lookup(m.b);
    if (!A || !B) continue;

    // Segment midpoint and direction
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    const [dx, dy] = norm(B.x - A.x, B.y - A.y);
    if (dx === 0 && dy === 0) continue;
    // Perpendicular direction
    const [px, py] = [-dy, dx];

    const ordinal = m.group !== undefined ? (groupOrdinal.get(m.group) ?? 0) : 0;
    const ticks = ordinal + 1;
    const offsets: number[] = [];
    if (ticks === 1) offsets.push(0);
    else if (ticks === 2) offsets.push(-TICK_SP / 2, TICK_SP / 2);
    else for (let i = 0; i < ticks; i++) offsets.push((i - (ticks - 1) / 2) * TICK_SP);

    for (const off of offsets) {
      const cx = mx + off * dx;
      const cy = my + off * dy;
      parts.push(
        `<line x1="${(cx - TICK_L * px).toFixed(1)}" y1="${(cy - TICK_L * py).toFixed(1)}" ` +
        `x2="${(cx + TICK_L * px).toFixed(1)}" y2="${(cy + TICK_L * py).toFixed(1)}" ` +
        `stroke="#1f2937" stroke-width="1.2" />`
      );
    }
  }

  const inner = parts.join("\n  ");
  return inner ? `<g data-constraint="equal-length">\n  ${inner}\n</g>` : "";
}

/**
 * Render SVG directly from pre-computed SVG canvas coordinates.
 * Use this for incremental patches where existing point positions are known.
 * No coordinate transformation is applied — x/y are used as-is in SVG space.
 */
export function renderSvgFromCanvasCoords(
  points: CanvasPoint[],
  segments: CanvasSegment[],
  circles: CanvasCircle[]
): string {
  const width = 800;
  const height = 600;
  const byId = new Map(points.map((p) => [p.id.toUpperCase(), p]));

  const segLines = segments
    .map((s) => {
      const a = byId.get(s.a.toUpperCase());
      const b = byId.get(s.b.toUpperCase());
      if (!a || !b) return "";
      const dashAttr = s.dashed ? ` stroke-dasharray="6,4"` : "";
      return `<line data-a="${s.a}" data-b="${s.b}" x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="#1f2937" stroke-width="2"${dashAttr} />`;
    })
    .filter(Boolean)
    .join("\n  ");

  const circleEls = circles
    .map((c) => {
      const p = byId.get(c.centerId.toUpperCase());
      if (!p) return "";
      return `<circle data-center-id="${c.centerId}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${c.r.toFixed(2)}" fill="none" stroke="#dc2626" stroke-width="2" />`;
    })
    .filter(Boolean)
    .join("\n  ");

  const pointEls = points
    .filter((p) => !p.id.startsWith("len:") && !displayLabel(p.id).startsWith("t_"))
    .map((p) => {
      if (displayLabel(p.id).startsWith("_")) {
        // Hidden helper point: render as invisible group for live segment updates.
        return `<g data-point-id="${p.id}" style="display:none"><circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="none" /><text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}"></text></g>`;
      }
      return `<g data-point-id="${p.id}"><circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="#111827" /><text x="${(p.x + 8).toFixed(2)}" y="${(p.y - 8).toFixed(2)}" font-size="16" font-family="Georgia, serif" fill="#111827">${displayLabel(p.id)}</text></g>`;
    })
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  ${segLines}
  ${circleEls}
  ${pointEls}
</svg>`;
}

export function renderSvg(layout: LayoutModel): string {
  const { transform: t } = fitToViewport(layout, CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_PADDING);
  const width  = t.canvasWidth;
  const height = t.canvasHeight;

  const tc = (x: number, y: number) => toCanvasPoint(x, y, t);

  const byId = new Map(layout.points.map((p) => [p.id, p]));
  // Only render actual geometry points — skip scalar lengths (len:) and tangent direction helpers (t_).
  const visiblePoints = layout.points.filter((p) => !p.id.startsWith("len:") && !displayLabel(p.id).startsWith("t_"));
  const isHiddenHelper = (p: { id: string }) => displayLabel(p.id).startsWith("_");

  // Render using the typed SceneNode list (authoritative source).
  const lineNodes   = layout.nodes.filter((n): n is LineNode   => n.kind === "line");
  const circleNodes = layout.nodes.filter((n): n is CircleNode => n.kind === "circle");

  console.log("[renderSvg] scene nodes:", JSON.stringify(
    layout.nodes.map(n =>
      n.kind === "line"
        ? { kind: "line", a: (n as LineNode).a, b: (n as LineNode).b, dashed: (n as LineNode).dashed, constraint: (n as LineNode).constraint }
        : { kind: n.kind, ...(n as any) }
    ), null, 2
  ));

  const segmentLines = lineNodes
    .map((n) => {
      const a = byId.get(n.a);
      const b = byId.get(n.b);
      if (!a || !b) return "";
      const p1 = tc(a.x, a.y);
      const p2 = tc(b.x, b.y);
      const dashAttr = n.dashed ? ` stroke-dasharray=\"6,4\"` : "";
      const constraintAttr = n.constraint ? ` data-constraint=\"${n.constraint}\"` : "";
      return `<line data-a=\"${n.a}\" data-b=\"${n.b}\"${constraintAttr} x1=\"${p1.x}\" y1=\"${p1.y}\" x2=\"${p2.x}\" y2=\"${p2.y}\" stroke=\"#1f2937\" stroke-width=\"2\"${dashAttr} />`;
    })
    .filter(Boolean)
    .join("\n");

  const circles = circleNodes
    .map((n) => {
      const center = byId.get(n.center);
      if (!center) return "";
      const cc = tc(center.x, center.y);
      const constraintAttr = n.constraint ? ` data-constraint=\"${n.constraint}\"` : "";
      return `<circle data-center-id=\"${n.center}\"${constraintAttr} cx=\"${cc.x}\" cy=\"${cc.y}\" r=\"${n.radius * t.scale}\" fill=\"none\" stroke=\"#dc2626\" stroke-width=\"2\" />`;
    })
    .filter(Boolean)
    .join("\n");

  const pointDots = visiblePoints
    .map((p) => {
      const c = tc(p.x, p.y);      if (isHiddenHelper(p)) {
        // Hidden helper point: render as invisible group so the frontend can
        // register it in pointById and update segment endpoints live on drag.
        return `<g data-point-id="${p.id}" style="display:none"><circle cx="${c.x}" cy="${c.y}" r="4" fill="none" /><text x="${c.x}" y="${c.y}"></text></g>`;
      }      return `<g data-point-id=\"${p.id}\"><circle cx=\"${c.x}\" cy=\"${c.y}\" r=\"4\" fill=\"#111827\" /><text x=\"${c.x + 8}\" y=\"${c.y - 8}\" font-size=\"16\" font-family=\"Georgia, serif\" fill=\"#111827\">${displayLabel(p.id)}</text></g>`;
    })
    .join("\n");

  const angleArcs = renderAngleArcMarks(layout.angleMarks ?? [], byId, tc);
  const rightAngleBoxes = renderRightAngleMarks(layout.rightAngleMarks ?? [], lineNodes, byId, tc);
  const segmentTicks = renderSegmentMarks(layout.segmentMarks ?? [], byId, tc);

  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\">
  <rect width=\"100%\" height=\"100%\" fill=\"#ffffff\" />
  ${segmentLines}
  ${circles}
  ${segmentTicks}
  ${angleArcs}
  ${rightAngleBoxes}
  ${pointDots}
</svg>`;
}
