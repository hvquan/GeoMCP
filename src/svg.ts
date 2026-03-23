import { LayoutModel } from "./types.js";

interface Viewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeViewport(layout: LayoutModel): Viewport {
  // Ignore internal helper points when fitting viewport.
  const viewportPoints = layout.points.filter((p) => !p.id.startsWith("_"));
  const xs = viewportPoints.map((p) => p.x);
  const ys = viewportPoints.map((p) => p.y);

  for (const c of layout.circles) {
    const center = layout.points.find((p) => p.id === c.center);
    if (!center) {
      continue;
    }
    xs.push(center.x - c.radius, center.x + c.radius);
    ys.push(center.y - c.radius, center.y + c.radius);
  }

  const minX = Math.min(...xs, -1);
  const minY = Math.min(...ys, -1);
  const maxX = Math.max(...xs, 1);
  const maxY = Math.max(...ys, 1);

  return { minX, minY, maxX, maxY };
}

export function renderSvg(layout: LayoutModel): string {
  const vp = computeViewport(layout);
  const width = 800;
  const height = 600;
  const pad = 40;

  const scaleX = (width - 2 * pad) / (vp.maxX - vp.minX || 1);
  const scaleY = (height - 2 * pad) / (vp.maxY - vp.minY || 1);
  const scale = Math.min(scaleX, scaleY);

  const toCanvas = (x: number, y: number): { x: number; y: number } => ({
    x: pad + (x - vp.minX) * scale,
    y: height - (pad + (y - vp.minY) * scale)
  });

  const byId = new Map(layout.points.map((p) => [p.id, p]));
  const visiblePoints = layout.points.filter((p) => !p.id.startsWith("_"));

  const segmentLines = layout.segments
    .map((s) => {
      const a = byId.get(s.a);
      const b = byId.get(s.b);
      if (!a || !b) {
        return "";
      }
      const p1 = toCanvas(a.x, a.y);
      const p2 = toCanvas(b.x, b.y);
      return `<line x1=\"${p1.x}\" y1=\"${p1.y}\" x2=\"${p2.x}\" y2=\"${p2.y}\" stroke=\"#1f2937\" stroke-width=\"2\" />`;
    })
    .filter(Boolean)
    .join("\n");

  const circles = layout.circles
    .map((c) => {
      const center = byId.get(c.center);
      if (!center) {
        return "";
      }
      const cc = toCanvas(center.x, center.y);
      return `<circle cx=\"${cc.x}\" cy=\"${cc.y}\" r=\"${c.radius * scale}\" fill=\"none\" stroke=\"#dc2626\" stroke-width=\"2\" />`;
    })
    .filter(Boolean)
    .join("\n");

  const pointDots = visiblePoints
    .map((p) => {
      const c = toCanvas(p.x, p.y);
      return `<g><circle cx=\"${c.x}\" cy=\"${c.y}\" r=\"4\" fill=\"#111827\" /><text x=\"${c.x + 8}\" y=\"${c.y - 8}\" font-size=\"16\" font-family=\"Georgia, serif\" fill=\"#111827\">${p.id}</text></g>`;
    })
    .join("\n");

  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\">
  <rect width=\"100%\" height=\"100%\" fill=\"#ffffff\" />
  ${segmentLines}
  ${circles}
  ${pointDots}
</svg>`;
}
