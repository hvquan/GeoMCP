/**
 * replay-all.mts
 *
 * Runs all snapshot files in tests/snapshots/ through the GeoRender pipeline
 * (normalizeRawDsl → adaptDsl → compile → solve → scene → SVG) WITHOUT calling the LLM.
 *
 * Usage:
 *   npx tsx tests/replay-all.mts [--dir=path/to/snapshots] [--verbose]
 *
 * Exit code 0 = all PASS/WARN, 1 = at least one FAIL.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { runFromGeomcpDsl } from "../src/georender/pipeline/run-from-geomcp-dsl.js";

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

function runOne(filePath: string): { verdict: "PASS"|"WARN"|"FAIL"|"ERROR"; score: number; error?: string; input: string } {
  const raw = readFileSync(filePath, "utf8");
  const { input } = extractMeta(raw);
  try {
    const dsl = JSON.parse(stripComments(raw));
    const { svg, warnings, errors } = runFromGeomcpDsl(dsl);
    const hasContent = svg.includes("<circle") || svg.includes("<line") || svg.includes("<path");
    const allWarnings = [...warnings, ...errors];
    if (!hasContent && errors.length > 0) {
      return { verdict: "FAIL", score: errors.length, error: errors[0], input };
    }
    if (!hasContent) {
      return { verdict: "FAIL", score: 1, error: "SVG has no geometry content", input };
    }
    const verdict: "PASS"|"WARN" = allWarnings.length > 0 ? "WARN" : "PASS";
    return { verdict, score: allWarnings.length, input };
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
  const scoreStr = isFinite(r.score) ? r.score.toString().padStart(3) : "N/A";
  console.log(`${icon} [${r.verdict.padEnd(5)}] warnings=${scoreStr}  ${name}`);
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
    .forEach(r => console.log(`  ❌ ${r.file}  (${r.error ?? ""})`));
  process.exit(1);
}

