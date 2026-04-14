/**
 * renderer/svg.ts — StyledScene → SVG string.
 *
 * Geometry kinds:
 *   segment  → <line> between two points
 *   ray      → <line> from origin, clipped to viewport edge
 *   line     → full infinite <line> clipped to viewport; solid if through two named points, dashed if computed
 *   circle   → <circle>, radius converted from world units via scene.scale
 *   triangle → <polygon> (filled area)
 *   polygon  → <polygon> (filled area)
 *
 * Mark kinds:
 *   angle_mark       → single / double / triple concentric arc
 *   right_angle_mark → square corner, directions resolved from geometry ids
 *   segment_mark     → single / double / triple tick on midpoint
 *
 * Labels in the `labels` array suppress the auto-generated point label.
 */
import type {
  StyledScene, StyledPoint,
  SceneGeometryNode, SceneAngleMark, SceneRightAngleMark, SceneSegmentMark, SceneLabel,
  InteractionMeta,
} from "../scene/schema.js";

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function interactionAttr(meta: InteractionMeta | undefined): string {
  if (!meta) return "";
  return ` data-interaction="${escAttr(JSON.stringify(meta))}"`;
}

/**
 * Liang-Barsky line-clipping.
 * tMin=0  → ray (starts at p1).
 * tMin=-∞ → full infinite line.
 */
function clipLine(
  x1: number, y1: number, x2: number, y2: number,
  W: number, H: number,
  tMin = -Infinity, tMax = Infinity,
): [number, number, number, number] | null {
  const dx = x2 - x1, dy = y2 - y1;
  let lo = tMin, hi = tMax;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > hi) return false; if (r > lo) lo = r; }
    else        { if (r < lo) return false; if (r < hi) hi = r; }
    return true;
  };

  if (!clip(-dx, x1) || !clip(dx, W - x1)) return null;
  if (!clip(-dy, y1) || !clip(dy, H - y1)) return null;
  if (lo >= hi) return null;

  return [x1 + lo * dx, y1 + lo * dy, x1 + hi * dx, y1 + hi * dy];
}

function renderGeometry(
  node: SceneGeometryNode,
  byId: Map<string, StyledPoint>,
  viewport: { width: number; height: number },
  scale: number,
): string {
  if (node.visible === false) return "";

  const rolesAttr  = node.roles?.length ? ` data-roles="${escAttr(node.roles.join(','))}"` : "";
  const interAttr  = interactionAttr(node.interaction);

  if (node.kind === "triangle" || node.kind === "polygon") {
    const pts = node.points.map((pid) => { const p = byId.get(pid); return p ? `${p.x},${p.y}` : null; });
    if (pts.some((p) => p === null)) return "";
    const fillAttr   = node.fill        ? ` fill="${escAttr(node.fill)}"` : ` fill="none"`;
    const strokeAttr = node.strokeStyle ? ` stroke="${escAttr(node.strokeStyle)}"` : ` stroke="none"`;
    return `<polygon data-id="${escAttr(node.id)}"${rolesAttr}${interAttr} points="${pts.join(' ')}"${fillAttr}${strokeAttr} />`;
  }

  if (node.kind === "segment") {
    const p1 = byId.get(node.a), p2 = byId.get(node.b);
    if (!p1 || !p2) return "";
    return `<line data-id="${escAttr(node.id)}" data-a="${escAttr(node.a)}" data-b="${escAttr(node.b)}"${rolesAttr}${interAttr} x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#1f2937" stroke-width="2" />`;
  }

  if (node.kind === "ray") {
    const p1 = byId.get(node.originPoint);
    if (!p1) return "";
    let dx: number, dy: number;
    if ('throughPoint' in node) {
      const p2 = byId.get(node.throughPoint);
      if (!p2) return "";
      dx = p2.x - p1.x; dy = p2.y - p1.y;
    } else {
      // direction is in math-space (Y-up); canvas flips Y
      dx = node.direction.x; dy = -node.direction.y;
    }
    const seg = clipLine(p1.x, p1.y, p1.x + dx, p1.y + dy, viewport.width, viewport.height, 0);
    if (!seg) return "";
    return `<line data-id="${escAttr(node.id)}"${rolesAttr}${interAttr} x1="${seg[0]}" y1="${seg[1]}" x2="${seg[2]}" y2="${seg[3]}" stroke="#1f2937" stroke-width="2" />`;
  }

  if (node.kind === "line") {
    let x1: number, y1: number, x2: number, y2: number;
    // line_through_points → two named point ids; computed lines → throughPointId + direction
    const isTwoPoint = 'a' in node;
    if (isTwoPoint) {
      const p1 = byId.get(node.a), p2 = byId.get(node.b);
      if (!p1 || !p2) return "";
      x1 = p1.x; y1 = p1.y; x2 = p2.x; y2 = p2.y;
    } else {
      const p = byId.get(node.throughPointId);
      if (!p) return "";
      // direction in math-space, flip Y for canvas
      const dir = node.direction;
      const len = Math.sqrt(dir.x ** 2 + dir.y ** 2) || 1;
      const ux = dir.x / len, uy = -dir.y / len;
      x1 = p.x - ux; y1 = p.y - uy; x2 = p.x + ux; y2 = p.y + uy;
    }
    const seg = clipLine(x1, y1, x2, y2, viewport.width, viewport.height);
    if (!seg) return "";
    // Lines through two named points render solid; computed construction lines render dashed.
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

function renderAngleMark(mark: SceneAngleMark, byId: Map<string, StyledPoint>, scale: number): string {
  const [aId, vId, bId] = mark.points;
  const a = byId.get(aId), v = byId.get(vId), b = byId.get(bId);
  if (!a || !v || !b) return "";

  const arcCount = mark.markStyle === "triple_arc" ? 3 : mark.markStyle === "double_arc" ? 2 : 1;
  const R0 = mark.radius != null ? mark.radius * scale : 18;

  const ax = a.x - v.x, ay = a.y - v.y;
  const bx = b.x - v.x, by = b.y - v.y;
  const la = Math.sqrt(ax * ax + ay * ay) || 1;
  const lb = Math.sqrt(bx * bx + by * by) || 1;
  const sweep = (ax * by - ay * bx) > 0 ? 0 : 1;

  return Array.from({ length: arcCount }, (_, i) => {
    const R  = R0 + i * 5;
    const sa = { x: v.x + (ax / la) * R, y: v.y + (ay / la) * R };
    const sb = { x: v.x + (bx / lb) * R, y: v.y + (by / lb) * R };
    return `<path data-id="${escAttr(mark.id)}" d="M ${sa.x} ${sa.y} A ${R} ${R} 0 0 ${sweep} ${sb.x} ${sb.y}" fill="none" stroke="#6366f1" stroke-width="1.5" />`;
  }).join("\n  ");
}

function getDirectionFromGeo(
  geoId: string, vertexId: string,
  byId: Map<string, StyledPoint>, geoById: Map<string, SceneGeometryNode>,
): { x: number; y: number } | null {
  const node = geoById.get(geoId), v = byId.get(vertexId);
  if (!node || !v) return null;

  let otherId: string | undefined;
  if (node.kind === "segment") otherId = node.a === vertexId ? node.b : node.a;
  else if (node.kind === "line" && 'a' in node) otherId = node.a === vertexId ? node.b : node.a;
  else if (node.kind === "ray"  && 'throughPoint' in node) otherId = node.originPoint === vertexId ? node.throughPoint : node.originPoint;
  if (!otherId) return null;

  const other = byId.get(otherId);
  if (!other) return null;
  const dx = other.x - v.x, dy = other.y - v.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

function renderRightAngleMark(
  mark: SceneRightAngleMark, byId: Map<string, StyledPoint>,
  geoById: Map<string, SceneGeometryNode>, scale: number,
): string {
  const v = byId.get(mark.pointId);
  if (!v) return "";
  const u1 = getDirectionFromGeo(mark.line1Id, mark.pointId, byId, geoById);
  const u2 = getDirectionFromGeo(mark.line2Id, mark.pointId, byId, geoById);
  if (!u1 || !u2) return "";
  const s = (mark.size ?? 0.18) * scale;
  const c1x = v.x + u1.x * s, c1y = v.y + u1.y * s;
  const c2x = v.x + u2.x * s, c2y = v.y + u2.y * s;
  const cx  = c1x + u2.x * s, cy  = c1y + u2.y * s;
  return `<polyline data-id="${escAttr(mark.id)}" points="${c1x},${c1y} ${cx},${cy} ${c2x},${c2y}" fill="none" stroke="#1f2937" stroke-width="1.5" />`;
}

function renderSegmentMark(mark: SceneSegmentMark, byId: Map<string, StyledPoint>, scale: number): string {
  const a = byId.get(mark.a), b = byId.get(mark.b);
  if (!a || !b) return "";
  const count   = mark.markStyle === "triple_tick" ? 3 : mark.markStyle === "double_tick" ? 2 : 1;
  const tickLen = (mark.size ?? 0.12) * scale;

  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len, py = dx / len;
  const ux =  dx / len, uy = dy / len;

  return Array.from({ length: count }, (_, i) => {
    const offset = (i - (count - 1) / 2) * 4;
    const ox = ux * offset, oy = uy * offset;
    return `<line data-id="${escAttr(mark.id)}" x1="${mx+ox-px*tickLen}" y1="${my+oy-py*tickLen}" x2="${mx+ox+px*tickLen}" y2="${my+oy+py*tickLen}" stroke="#6366f1" stroke-width="1.5" />`;
  }).join("\n  ");
}

function renderLabel(lbl: SceneLabel, byId: Map<string, StyledPoint>): string {
  const target = byId.get(lbl.targetId);
  if (!target) return "";
  return `<text data-id="${escAttr(lbl.id)}" x="${target.x + (lbl.dx ?? 8)}" y="${target.y + (lbl.dy ?? -8)}" font-family="sans-serif" font-size="14" fill="#111827">${escAttr(lbl.text)}</text>`;
}

export function renderSvg(scene: StyledScene): string {
  const { viewport: vp, scale } = scene;
  const byId    = new Map(scene.points.map((p) => [p.id, p]));
  const geoById = new Map(scene.geometry.map((g) => [g.id, g]));
  const explicitLabelTargets = new Set(scene.labels.map((l) => l.targetId));

  const geoEls           = scene.geometry.map((n) => renderGeometry(n, byId, vp, scale)).filter(Boolean).join("\n  ");
  const angleMarkEls     = scene.angleMarks.map((m) => renderAngleMark(m, byId, scale)).filter(Boolean).join("\n  ");
  const rightAngleMarkEls = scene.rightAngleMarks.map((m) => renderRightAngleMark(m, byId, geoById, scale)).filter(Boolean).join("\n  ");
  const segmentMarkEls   = scene.segmentMarks.map((m) => renderSegmentMark(m, byId, scale)).filter(Boolean).join("\n  ");
  const labelEls         = scene.labels.map((l) => renderLabel(l, byId)).filter(Boolean).join("\n  ");

  const pointEls = scene.points.map((p) => {    if (p.visible === false) return "";    const s = p.resolvedStyle;
    const interAttr  = interactionAttr(p.interaction);
    const labelEl = !explicitLabelTargets.has(p.id) && p.label
      ? `\n    <text x="${p.x + p.labelOffset.dx}" y="${p.y + p.labelOffset.dy}" font-family="${escAttr(s.labelFont)}" font-size="${s.labelSize}" fill="${escAttr(s.labelColor)}">${escAttr(p.label)}</text>`
      : "";
    return `<g data-point-id="${escAttr(p.id)}"${interAttr}>\n    <circle cx="${p.x}" cy="${p.y}" r="${s.radius}" fill="${escAttr(s.fill)}" stroke="${escAttr(s.stroke)}" stroke-width="${s.strokeWidth}" />${labelEl}\n  </g>`;
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
