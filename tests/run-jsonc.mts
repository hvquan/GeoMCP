/**
 * run-jsonc.mts  — manual pipeline test for a single snapshot / JSONC file.
 *
 * Usage:
 *   npx tsx tests/run-jsonc.mts <file.jsonc>
 *
 * The file format is JSONC (JSON with // comments).
 * Use the first comment line to declare the original input text:
 *   // input: "Cho đường tròn tâm O, bán kính OA"
 *   { "objects": [...], "constraints": [...], ... }
 *
 * This lets you paste raw LLM output (step [3] from the pipeline log), save it
 * as a .jsonc file, and test the pipeline WITHOUT going through the LLM again.
 */

import { readFileSync } from "fs";
import { dslToGeometryModel } from "../src/parsing/index.js";
import { buildLayout, refineLayoutWithSolver, renderSvg } from "../src/geometry/index.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx tests/run-jsonc.mts <file.jsonc>");
  console.error("       npx tsx tests/run-jsonc.mts tests/snapshots/001-cho-duong-tron.jsonc");
  process.exit(1);
}

// Strip // and /* */ comments
const raw = readFileSync(filePath, "utf8");
const stripped = raw
  .replace(/\/\/[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const inputMatch = raw.match(/\/\/\s*"?input"?\s*:\s*"([^"]+)"/);
const input = inputMatch ? inputMatch[1] : "";

const dsl = JSON.parse(stripped);
console.log("Input:", input || "(none)");
console.log("DSL objects:", dsl.objects?.map((o: any) => `${o.type}(${o.center ?? o.name ?? o.points?.join(",") ?? ""})`).join(", "));
console.log("Constraints:", dsl.constraints?.map((c: any) => c.type).join(", ") || "(none)");

const model = dslToGeometryModel(dsl, input);
console.log("\nGeometryModel:");
console.log("  points:", model.points);
console.log("  circles:", JSON.stringify(model.circles));
console.log("  pointsOnCircles:", JSON.stringify(model.pointsOnCircles));
console.log("  circlesByDiameter:", JSON.stringify(model.circlesByDiameter));
console.log("  tangents:", JSON.stringify(model.tangents));

const base = buildLayout(model);
const refined = refineLayoutWithSolver(model, base, { iterations: 180 });

function dist(a: {x:number,y:number}, b: {x:number,y:number}) {
  return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
}
function scoreLayout(m: typeof model, layout: typeof base) {
  const byId = new Map(layout.points.map(p => [p.id, p]));
  let s = 0;
  for (const rel of m.pointsOnCircles) {
    const p = byId.get(rel.point), o = byId.get(rel.center);
    const circle = layout.circles.find(c => c.center === rel.center);
    if (!p || !o || !circle) { s += 5; continue; }
    s += Math.abs(dist(p, o) - circle.radius);
  }
  for (const dc of m.circlesByDiameter) {
    const a = byId.get(dc.a), b = byId.get(dc.b), cen = byId.get(dc.centerId ?? "");
    if (!a || !b || !cen) { s += 5; continue; }
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2, r = dist(a,b)/2;
    s += dist(cen, {x:mx,y:my}) + Math.abs(dist(cen,a)-r) + Math.abs(dist(cen,b)-r);
  }
  return s;
}

const bs = scoreLayout(model, base);
const rs = scoreLayout(model, refined);
const winner = rs <= bs ? refined : base;
const winnerScore = Math.min(bs, rs);

console.log(`\nScore → base=${bs.toFixed(3)}, refined=${rs.toFixed(3)}, winner=${rs<=bs?"refined":"base"}`);

const svg = renderSvg(winner);
console.log("SVG length:", svg.length, "| <circle>:", svg.includes("<circle"), "| <line>:", svg.includes("<line"));

const verdict = winnerScore <= 1 ? "PASS" : winnerScore <= 5 ? "WARN" : "FAIL";
console.log(`\nRESULT: ${verdict} (score=${winnerScore.toFixed(3)})`);
if (verdict !== "PASS") {
  console.log("\nLayout points:", JSON.stringify(winner.points, null, 2));
  console.log("Layout circles:", JSON.stringify(winner.circles, null, 2));
}
