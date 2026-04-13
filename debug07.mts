import { readFileSync } from "fs";
import { parse as jsoncParse } from "jsonc-parser";
import { canonicalToGeometryModel } from "./src/model/v2Model.js";
import { buildLayout, refineLayoutWithSolver, renderSvg } from "./src/geometry/index.js";

const raw = readFileSync("./tests/snapshots/07.jsonc","utf-8");
const snap = jsoncParse(raw);
const model = canonicalToGeometryModel(snap.canonical);
console.log("equalAngles in model:", model.equalAngles?.length, JSON.stringify(model.equalAngles?.slice(0,1)));

const base = buildLayout(model);
console.log("equalAngles in base layout:", base.equalAngles?.length);

const refined = refineLayoutWithSolver(model, base);
console.log("equalAngles in refined layout:", refined.equalAngles?.length);

const svg = renderSvg(refined);
console.log("SVG has equal-angle:", svg.includes("equal-angle"));
console.log("SVG has path:", svg.includes("<path"));
