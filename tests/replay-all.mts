/**
 * replay-all.mts
 *
 * Runs all snapshot files in tests/snapshots/ through the geometry pipeline
 * (DSL → compiler → layout → solver → score) WITHOUT calling the LLM.
 *
 * Usage:
 *   npx tsx tests/replay-all.mts [--dir=path/to/snapshots] [--verbose]
 *
 * Exit code 0 = all PASS/WARN, 1 = at least one FAIL.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { dslToGeometryModel } from "../src/parsing/index.js";
import { buildLayout, refineLayoutWithSolver, renderSvg } from "../src/geometry/index.js";
import type { GeometryModel } from "../src/model/types.js";
import type { LayoutModel } from "../src/geometry/index.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirArg = args.find(a => a.startsWith("--dir="));
const SNAPSHOTS_DIR = dirArg ? dirArg.split("=")[1] : join(__dir, "snapshots");
const VERBOSE = args.includes("--verbose") || args.includes("-v");

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractMeta(src: string): { input: string; model: string } {
  const inputMatch = src.match(/\/\/\s*input:\s*"([^"]+)"/);
  const modelMatch = src.match(/\/\/\s*model:\s*(\S+)/);
  return {
    input: inputMatch ? inputMatch[1] : "",
    model: modelMatch ? modelMatch[1] : "",
  };
}

type Point = { id: string; x: number; y: number };
function dist(a: Point, b: Point) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }

function scoreLayout(model: GeometryModel, layout: LayoutModel): number {
  const byId = new Map(layout.points.map(p => [p.id, p]));
  let s = 0;

  for (const rel of model.pointsOnCircles) {
    const p = byId.get(rel.point), o = byId.get(rel.center);
    const circle = layout.circles.find(c => c.center === rel.center);
    if (!p || !o || !circle) { s += 5; continue; }
    s += Math.abs(dist(p, o) - circle.radius);
  }
  for (const dc of model.circlesByDiameter) {
    const a = byId.get(dc.a), b = byId.get(dc.b), cen = byId.get(dc.centerId ?? "");
    if (!a || !b || !cen) { s += 5; continue; }
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2, r = dist(a, b)/2;
    s += dist(cen, {id:"", x:mx, y:my}) + Math.abs(dist(cen,a)-r) + Math.abs(dist(cen,b)-r);
  }
  for (const mp of model.midpoints) {
    const p = byId.get(mp.point), a = byId.get(mp.a), b = byId.get(mp.b);
    if (!p || !a || !b) { s += 4; continue; }
    s += dist(p, {id:"", x:(a.x+b.x)/2, y:(a.y+b.y)/2});
  }
  for (const alt of model.altitudes) {
    const foot = byId.get(alt.foot), from = byId.get(alt.from);
    const base1 = byId.get(alt.base1), base2 = byId.get(alt.base2);
    if (!foot || !from || !base1 || !base2) { s += 3; continue; }
    const vx = base2.x-base1.x, vy = base2.y-base1.y;
    const len = Math.sqrt(vx*vx+vy*vy)||1;
    const dot = ((foot.x-from.x)*vx + (foot.y-from.y)*vy) / len;
    s += Math.abs(dot);
  }
  for (const med of model.medians) {
    const foot = byId.get(med.foot), base1 = byId.get(med.base1), base2 = byId.get(med.base2);
    if (!foot || !base1 || !base2) { s += 4; continue; }
    s += dist(foot, {id:"", x:(base1.x+base2.x)/2, y:(base1.y+base2.y)/2});
  }
  return s;
}

function runOne(filePath: string): { verdict: "PASS"|"WARN"|"FAIL"|"ERROR"; score: number; error?: string; input: string } {
  const raw = readFileSync(filePath, "utf8");
  const { input } = extractMeta(raw);
  try {
    const dsl = JSON.parse(stripComments(raw));
    const model = dslToGeometryModel(dsl, input);
    const base = buildLayout(model);
    const refined = refineLayoutWithSolver(model, base, { iterations: 180 });
    const bs = scoreLayout(model, base);
    const rs = scoreLayout(model, refined);
    const best = Math.min(bs, rs);
    const svg = renderSvg(rs <= bs ? refined : base);
    const hasContent = svg.includes("<circle") || svg.includes("<line") || svg.includes("<path");
    const verdict: "PASS"|"WARN"|"FAIL" = best <= 1 && hasContent ? "PASS" : best <= 5 ? "WARN" : "FAIL";
    return { verdict, score: best, input };
  } catch (err: any) {
    return { verdict: "ERROR", score: Infinity, error: err.message, input };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!existsSync(SNAPSHOTS_DIR)) {
  console.error(`Snapshots directory not found: ${SNAPSHOTS_DIR}`);
  console.error("Run  npx tsx tests/capture-llm.mts  first to generate snapshots.");
  process.exit(1);
}

const files = readdirSync(SNAPSHOTS_DIR)
  .filter(f => f.endsWith(".jsonc") || f.endsWith(".json"))
  .sort()
  .map(f => join(SNAPSHOTS_DIR, f));

if (files.length === 0) {
  console.error("No snapshot files found in", SNAPSHOTS_DIR);
  process.exit(1);
}

console.log(`Replaying ${files.length} snapshot(s) from ${SNAPSHOTS_DIR}\n`);

const results: { file: string; verdict: string; score: number; input: string; error?: string }[] = [];
let failCount = 0;

for (const file of files) {
  const name = basename(file);
  const r = runOne(file);
  results.push({ file: name, ...r });

  const icon = r.verdict === "PASS" ? "✅" : r.verdict === "WARN" ? "⚠️ " : "❌";
  const scoreStr = isFinite(r.score) ? r.score.toFixed(3) : "  N/A";
  console.log(`${icon} [${r.verdict.padEnd(4)}] score=${scoreStr}  ${name}`);
  if (VERBOSE || r.verdict !== "PASS") {
    console.log(`          input: "${r.input}"`);
    if (r.error) console.log(`          error: ${r.error}`);
  }

  if (r.verdict === "FAIL" || r.verdict === "ERROR") failCount++;
}

// ── Summary ───────────────────────────────────────────────────────────────────
const pass  = results.filter(r => r.verdict === "PASS").length;
const warn  = results.filter(r => r.verdict === "WARN").length;
const fail  = results.filter(r => r.verdict === "FAIL" || r.verdict === "ERROR").length;

console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${files.length}  ✅ PASS: ${pass}  ⚠️  WARN: ${warn}  ❌ FAIL: ${fail}`);

if (fail > 0) {
  console.log("\nFailed snapshots:");
  results.filter(r => r.verdict !== "PASS" && r.verdict !== "WARN")
    .forEach(r => console.log(`  ❌ ${r.file}  (${r.error ?? "score="+r.score.toFixed(3)})`));
  process.exit(1);
}
