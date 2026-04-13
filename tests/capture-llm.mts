/**
 * capture-llm.mts
 *
 * Reads each line from resources/tests.txt, calls the real LLM, and saves the
 * raw LLM DSL output as a snapshot file in tests/snapshots/.
 *
 * Usage:
 *   npx tsx tests/capture-llm.mts [--from=N] [--to=M] [--input="single line"]
 *
 * Each snapshot is saved as:
 *   tests/snapshots/<padded-index>-<slug>.jsonc
 *
 * The first line of each snapshot is a comment with the original input, so it
 * doubles as a self-describing test fixture that run-jsonc.mts can consume.
 *
 * Options:
 *   --from=N    Start from line N (1-based, default: 1)
 *   --to=M      Stop after line M (1-based, default: all)
 *   --input="…" Test a single ad-hoc string instead of tests.txt
 *   --dry-run   Print what would be done without calling the LLM
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runGeometryPipeline } from "../src/pipeline/index.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const TESTS_TXT = join(ROOT, "resources", "tests.txt");
const SNAPSHOTS_DIR = join(__dir, "snapshots");

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fromArg  = args.find(a => a.startsWith("--from="));
const toArg    = args.find(a => a.startsWith("--to="));
const inputArg = args.find(a => a.startsWith("--input="));
const dryRun   = args.includes("--dry-run");

const fromLine = fromArg ? parseInt(fromArg.split("=")[1], 10) : 1;
const toLine   = toArg   ? parseInt(toArg.split("=")[1],   10) : Infinity;

// ── Build input list ────────────────────────────────────────────────────────
let lines: { idx: number; text: string }[];

if (inputArg) {
  lines = [{ idx: 1, text: inputArg.split("=").slice(1).join("=") }];
} else {
  // Split by blank lines — each paragraph (consecutive non-blank lines) is one problem
  const all = readFileSync(TESTS_TXT, "utf8")
    .split(/\n\s*\n/)
    .map(block => block.split("\n").map(l => l.trim()).filter(Boolean).join("\n"))
    .filter(Boolean);
  lines = all
    .map((text, i) => ({ idx: i + 1, text }))
    .filter(({ idx }) => idx >= fromLine && idx <= toLine);
}

// ── Ensure snapshots directory ──────────────────────────────────────────────
if (!existsSync(SNAPSHOTS_DIR)) mkdirSync(SNAPSHOTS_DIR, { recursive: true });

function pad(n: number, total: number): string {
  return String(n).padStart(String(total).length, "0");
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`Capturing ${lines.length} input(s) → ${SNAPSHOTS_DIR}\n`);

let passed = 0, failed = 0;

for (const { idx, text } of lines) {
  const paddedIdx = pad(idx, lines.length + fromLine - 1);
  const filename = `${paddedIdx}.jsonc`;
  const outPath = join(SNAPSHOTS_DIR, filename);

  console.log(`[${paddedIdx}] ${text.split("\n")[0]}`);

  if (dryRun) {
    console.log(`       → would write ${filename}\n`);
    continue;
  }

  try {
    const result = await runGeometryPipeline(text, {
      parserMode: "dsl-llm",
      parseOnly: true,
      fallbackToHeuristic: false,
    });

    if (!result.llmDebug) {
      console.log(`       ⚠  no LLM debug info (heuristic fallback?)\n`);
      failed++;
      continue;
    }

    // Raw LLM response — try to pretty-print it as JSON
    let rawJson: string;
    try {
      rawJson = JSON.stringify(JSON.parse(result.llmDebug.rawResponse), null, 2);
    } catch {
      rawJson = result.llmDebug.rawResponse;
    }

    const content = [
      `// input: "${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
      `// model: ${result.llmDebug.model}`,
      rawJson,
    ].join("\n") + "\n";

    writeFileSync(outPath, content, "utf8");
    console.log(`       ✓  saved ${filename}`);
    if (result.warnings.length) {
      result.warnings.forEach(w => console.log(`       ⚠  ${w}`));
    }
    passed++;
  } catch (err: any) {
    console.log(`       ✗  ERROR: ${err.message}`);
    failed++;
  }
  console.log();
}

console.log(`\nDone: ${passed} captured, ${failed} failed.`);
if (failed > 0) process.exit(1);
