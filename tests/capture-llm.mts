/**
 * capture-llm.mts
 *
 * Reads each paragraph from resources/tests.txt, calls the LLM using the same
 * pipeline as the web app, and writes results back into
 * src/llm/examples/dsl-examples.ts (updating `input` + `expected` for each id).
 *
 * Existing entries whose ids are NOT in the current run range are preserved.
 *
 * Usage:
 *   npx tsx tests/capture-llm.mts [--from=N] [--to=M] [--dry-run]
 *
 * Options:
 *   --from=N   Start from paragraph N (1-based, default: 1)
 *   --to=M     Stop after paragraph M (1-based, default: all)
 *   --dry-run  Print what would be done without calling the LLM
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runGeometryPipeline } from "../src/pipeline/index.js";
import { DSL_EXAMPLES } from "../src/llm/examples/dsl-examples.js";
import type { DslExample } from "../src/llm/examples/dsl-examples.js";

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, "..");
const TESTS  = join(ROOT, "resources", "tests.txt");
const OUTFILE = join(ROOT, "src", "llm", "examples", "dsl-examples.ts");

// ── CLI args ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const fromArg = args.find(a => a.startsWith("--from="));
const toArg   = args.find(a => a.startsWith("--to="));
const dryRun  = args.includes("--dry-run");
const fromN   = fromArg ? parseInt(fromArg.split("=")[1], 10) : 1;
const toN     = toArg   ? parseInt(toArg.split("=")[1],   10) : Infinity;

// ── Parse tests.txt into {id, text} array ────────────────────────────────────
function pad2(n: number) { return String(n).padStart(2, "0"); }

const paragraphs: { id: string; text: string }[] = readFileSync(TESTS, "utf8")
  .split(/\n\s*\n/)
  .map(b => b.split("\n").map(l => l.trim()).filter(Boolean).join("\n"))
  .filter(Boolean)
  .map((text, i) => ({ id: pad2(i + 1), text }));

const toCapture = paragraphs.filter(({ id }) => {
  const n = parseInt(id, 10);
  return n >= fromN && n <= toN;
});

// ── Build mutable map from current DSL_EXAMPLES ──────────────────────────────
const examplesMap = new Map<string, DslExample>(DSL_EXAMPLES.map(e => [e.id, e]));

// ── Run LLM captures ─────────────────────────────────────────────────────────
console.log(`Capturing ${toCapture.length} inputs → ${OUTFILE}\n`);
let passed = 0, failed = 0;

for (const { id, text } of toCapture) {
  const firstLine = text.split("\n")[0];
  console.log(`[${id}] ${firstLine}`);

  if (dryRun) {
    console.log(`       → dry-run, skipping\n`);
    continue;
  }

  try {
    const result = await runGeometryPipeline(text, { parseOnly: true });

    const rawJson = result.rawDslJson ?? result.llmDebug?.rawJson;
    if (!rawJson) {
      console.warn(`       ⚠  no raw JSON captured (LLM debug missing)\n`);
      failed++;
      continue;
    }

    const expected = rawJson as DslExample["expected"];
    examplesMap.set(id, { id, input: text, expected });
    console.log(`       ✓  captured\n`);
    passed++;
  } catch (err: any) {
    console.error(`       ✗  ${err.message}\n`);
    failed++;
  }
}

console.log(`Done: ${passed} captured, ${failed} failed.\n`);

if (dryRun) {
  console.log("Dry-run: no files written.");
  process.exit(0);
}

// ── Serialise back to dsl-examples.ts ────────────────────────────────────────
const allExamples = [...examplesMap.values()].sort((a, b) => a.id.localeCompare(b.id));

function serializeEntry(ex: DslExample): string {
  const expectedStr = JSON.stringify(ex.expected, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : "      " + line))
    .join("\n");

  return [
    `  {`,
    `    id: ${JSON.stringify(ex.id)},`,
    `    input: ${JSON.stringify(ex.input)},`,
    `    expected: ${expectedStr},`,
    `  },`,
  ].join("\n");
}

const fileContent = [
  `/**`,
  ` * src/llm/examples/dsl-examples.ts`,
  ` *`,
  ` * LLM captures: each entry's input comes from resources/tests.txt and`,
  ` * expected is the raw JSON the LLM produced for that input.`,
  ` * Regenerate with: npm run test:capture`,
  ` */`,
  ``,
  `export interface DslExample {`,
  `  id: string;`,
  `  input: string;`,
  `  expected: {`,
  `    objects: unknown[];`,
  `    constraints: unknown[];`,
  `    constructions: unknown[];`,
  `    targets: unknown[];`,
  `  };`,
  `}`,
  ``,
  `export const DSL_EXAMPLES: DslExample[] = [`,
  ...allExamples.map(serializeEntry),
  `];`,
  ``,
].join("\n");

writeFileSync(OUTFILE, fileContent, "utf8");
console.log(`Written: ${OUTFILE}`);
if (failed > 0) process.exit(1);

