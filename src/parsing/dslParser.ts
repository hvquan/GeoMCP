/**
 * DSL Parser — Layer 8 (Normalization Orchestrator)
 *
 * Orchestrates the full LLM-based parsing pipeline:
 *   L2/L3: Language normalization (language/index) + dynamic prompt (ai/prompt-builder)
 *   L3: callLlm (ai/llm-adapter)
 *   L4:    extractJsonObject (ai/output-extractor)
 *   L5:    repairDslJson (ai/repair)
 *   L6:    dslSchema validation (dsl/schema)
 *   L7:    normalizeDsl — fixes common LLM output mistakes
 *
 * normalizeDsl lives here (not in dsl/canonicalizer) because it is tightly
 * coupled to the quirks of LLM output rather than to general DSL semantics.
 */

import type { GeometryDsl } from "../dsl/dsl.js";
import { callLlm, type LlmCallOptions } from "../ai/llm-adapter.js";
import { GEOMETRY_SYSTEM_PROMPT, buildDynamicGeometrySystemPrompt } from "../ai/prompt-builder.js";
import { extractJsonObject } from "../ai/output-extractor.js";
import { dslSchema } from "../dsl/schema.js";
import { repairDslJson, buildRepairPrompt as buildLlmRepairPrompt } from "../ai/repair.js";
import type { NormalizedGeometryInput } from "../language/canonical-language.js";

type DslParseOptions = LlmCallOptions & {
  /** Optional language normalization context from src/language/index.ts. */
  normalized?: NormalizedGeometryInput;
};

function normalizeDsl(raw: any, problemText?: string): any {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const obj: any = { ...raw };

  if (!Array.isArray(obj.objects)) {
    if (obj.objects && typeof obj.objects === "object") {
      obj.objects = Object.keys(obj.objects).map((name) => {
        const upper = String(name).toUpperCase();
        if (/^[A-Z]$/.test(upper)) {
          return { type: "point", name: upper };
        }
        if (upper.length === 2 || /[A-Z]/.test(upper)) {
          return { type: "line", name };
        }
        return { type: "line", name };
      });
    } else {
      obj.objects = [];
    }
  }

  // Normalize individual objects: fix alternative key names that LLMs commonly use
  obj.objects = obj.objects
    .filter((o: any) => o && typeof o === "object")
    .map((o: any) => {
      const t = String(o.type || "").toLowerCase();
      // "segment" with endpoints/a+b instead of points array
      if (t === "segment") {
        if (!Array.isArray(o.points)) {
          if (Array.isArray(o.endpoints) && o.endpoints.length >= 2) {
            o = { ...o, points: [String(o.endpoints[0]).toUpperCase().slice(0,1), String(o.endpoints[1]).toUpperCase().slice(0,1)] };
          } else if (o.a && o.b) {
            o = { ...o, points: [String(o.a).toUpperCase().slice(0,1), String(o.b).toUpperCase().slice(0,1)] };
          } else if (o.from && o.to) {
            o = { ...o, points: [String(o.from).toUpperCase().slice(0,1), String(o.to).toUpperCase().slice(0,1)] };
          }
        }
      }
      // "point" with no name: try id/label fallback
      if (t === "point" && !o.name) {
        const n = String(o.id ?? o.label ?? o.vertex ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (n) o = { ...o, name: n };
      }
      // "circle" with diameter/through as an array [C,D] → treat as diameter definition
      if (t === "circle" && (Array.isArray(o.through) || Array.isArray(o.diameter)) && !o._diameterInjected) {
        const arr = o.through ?? o.diameter;
        const p1 = String(arr[0]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const p2 = String(arr[1]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const circName = o.name ?? o.center ?? "O";
        if (!Array.isArray(obj.constraints)) obj.constraints = [];
        obj.constraints.unshift({ type: "diameter", circle: circName, points: [p1, p2] });
        o = { ...o, through: undefined, diameter: undefined };
      }
      // "arc" type — not a supported geometry object; convert to on_circle constraint for
      // the endpoint, and inject a chord segment CE into objects.
      if (t === "arc") {
        const circName = String(o.circle ?? o.center ?? "O");
        const start = String(o.start_point ?? o.startPoint ?? o.from ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const end = String(o.end_point ?? o.endPoint ?? o.to ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (!Array.isArray(obj.constraints)) obj.constraints = [];
        if (end) obj.constraints.push({ type: "on_circle", point: end, circle: circName });
        // Inject a chord segment from start to end into objects list
        if (start && end) obj.objects.push({ type: "segment", points: [start, end] });
        // Replace arc with a point object for the new endpoint
        if (end) return { type: "point", name: end };
        return null;
      }
      // "circle" with radius expressed as a point key instead of numeric radius or "through"
      // Handle all known LLM key variants:
      // - radiusPoint, radius_point, throughPoint, through_point, radiusEndpoint, radius_endpoint
      // - endpoint, point_on_circle, onCircle, passes_through, passesThrough
      // - radius as a STRING like "OA" or "A" (not a number) → extract non-center letter
      if (t === "circle" && !o.through) {
        const rp = o.radiusPoint ?? o.radius_point ?? o.throughPoint ?? o.through_point
          ?? o.radiusEndpoint ?? o.radius_endpoint ?? o.endpoint ?? o.point_on_circle
          ?? o.onCircle ?? o.passes_through ?? o.passesThrough;
        if (rp) {
          const pt = String(rp).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
          if (pt) o = { ...o, through: pt };
        } else if (typeof o.radius === "string") {
          // e.g. radius: "OA" or radius: "A" — pick the non-center letter
          const center = String(o.center ?? o.name ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
          const letters = o.radius.toUpperCase().replace(/[^A-Z]/g, "").split("");
          const pt = letters.find((l: string) => l !== center) ?? letters[0];
          if (pt) o = { ...o, through: pt, radius: undefined };
        }
      }
      return o;
    });

  // Deduplicate circles with the same center: keep only the first occurrence.
  // A second circle for the same center is typically an LLM mistake when
  // expressing a diameter — the diameter constraint already handles both points.
  {
    const seenCircleCenters = new Set<string>();
    obj.objects = obj.objects.filter((o: any) => {
      if (!o || String(o.type || "").toLowerCase() !== "circle") return true;
      const ctr = String(o.center ?? o.name ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
      if (!ctr || seenCircleCenters.has(ctr)) return false;
      seenCircleCenters.add(ctr);
      return true;
    });
  }

  if (!Array.isArray(obj.constraints)) obj.constraints = [];

  if (!Array.isArray(obj.constructions)) {
    if (Array.isArray(obj.construct)) {
      obj.constructions = obj.construct;
    } else {
      obj.constructions = [];
    }
  }

  if (!Array.isArray(obj.targets)) {
    if (Array.isArray(obj.prove)) {
      obj.targets = obj.prove.map((text: any) => ({ type: "statement", text: String(text) }));
    } else {
      obj.targets = [];
    }
  }

  obj.constraints = obj.constraints
    .map((c: any) => {
      if (!c || typeof c !== "object") {
        return null;
      }

      const t = String(c.type || "").toLowerCase();

      // Misplaced object types — rescue them into obj.objects and drop from constraints
      if (["segment", "point", "line", "triangle", "circle", "arc"].includes(t)) {
        obj.objects.push(c);
        return null;
      }

      const objects = Array.isArray(c.objects) ? c.objects.map((x: any) => String(x)) : [];

      if (t === "tangency") {
        const line = String(c.line ?? objects[0] ?? "");
        const circle = String(c.circle ?? objects[1] ?? "").toUpperCase().slice(0, 1);
        const at = String(c.at ?? line).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "C";
        return { type: "tangent", line, circle, at };
      }

      if (t === "tangent") {
        const line = String(c.line ?? c.line1 ?? c.line2 ?? objects[0] ?? "");
        const circle = String(c.circle ?? objects[1] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        // "at" = touch point. Fall back to first letter of the line name if not given.
        const atRaw = c.at ?? c.point ?? objects[2] ?? line;
        const at = String(atRaw).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)
          || line.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)
          || "C";
        return { type: "tangent", line, circle: circle || "O", at };
      }

      if (t === "collinearity") {
        const points = objects.map((x: string) => x.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)).filter(Boolean);
        return { type: "collinear", points };
      }

      if (t === "perpendicularity") {
        const line1 = String(c.line1 ?? objects[0] ?? "");
        const line2 = String(c.line2 ?? objects[1] ?? "");
        return { type: "perpendicular", line1, line2 };
      }

      if (t === "perpendicular") {
        const line1 = String(c.line1 ?? objects[0] ?? "");
        const line2 = String(c.line2 ?? objects[1] ?? "");
        return { type: "perpendicular", line1, line2 };
      }

      if (t === "diameter") {
        const circle = String(c.circle ?? objects[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "O";
        const p1 = String((c.points && c.points[0]) ?? objects[1] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const p2 = String((c.points && c.points[1]) ?? objects[2] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (p1 && p2) {
          // Guard: LLM confused "bán kính OA" with diameter → one point is the center.
          // Convert to on_circle for the non-center point instead.
          if (p1 === circle) return { type: "on_circle", point: p2, circle };
          if (p2 === circle) return { type: "on_circle", point: p1, circle };
          return { type: "diameter", circle, points: [p1, p2] };
        }
      }

      if (t === "on_circle") {
        const point = String(c.point ?? objects[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const circle = String(c.circle ?? objects[1] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        return { type: "on_circle", point, circle };
      }

      // "radius" / "radius_point" / "defines_radius" / "radius_segment" / etc. constraint:
      // All forms meaning "point A lies on circle O, defining its radius":
      //   {"type":"radius","circle":"O","point":"A"}
      //   {"type":"radius","circle":"O","segment":["O","A"]}
      //   {"type":"radius","circle":"O","line":"OA"}       ← line as 2-char string
      //   {"type":"radius","circle":"O","from":"O","to":"A"}
      //   {"type":"radius_point","circle":"O","point":"A"}
      //   {"type":"defines_radius","circle":"O","point":"A"}
      //   any unknown type that has both "circle" and "point" fields → treat as on_circle
      if (t === "radius" || t === "radius_point" || t === "defines_radius"
          || t === "radius_segment" || t === "circle_radius" || t === "on_radius"
          || t === "has_radius" || t === "radius_endpoint" || t === "circle_passes_through") {
        const circle = String(c.circle ?? objects[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        let point = String(c.point ?? c.endpoint ?? c.radius_point ?? c.to ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        // line as string e.g. "OA" → pick non-center letter
        if (!point && typeof c.line === "string" && c.line.length >= 2) {
          const letters = c.line.toUpperCase().replace(/[^A-Z]/g, "").split("");
          point = letters.find((l: string) => l !== circle) ?? letters[0] ?? "";
        }
        if (!point && Array.isArray(c.segment) && c.segment.length >= 2) {
          const ends = c.segment.map((x: any) => String(x).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1));
          point = ends.find((p: string) => p !== circle) ?? ends[1] ?? "";
        }
        if (!point && Array.isArray(c.points) && c.points.length >= 1) {
          const ends = c.points.map((x: any) => String(x).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1));
          point = ends.find((p: string) => p !== circle) ?? ends[0] ?? "";
        }
        if (point && circle) return { type: "on_circle", point, circle };
      }

      // Catch-all: unknown constraint type that carries both "circle" and "point" → on_circle
      // This covers any future LLM invention like "placed_on", "belongs_to", etc.
      if (c.point && c.circle && !["tangent","diameter","on_circle","passes_through"].includes(t)) {
        const point = String(c.point).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const circle = String(c.circle).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (point && circle && /^[A-Z]$/.test(point) && /^[A-Z]$/.test(circle)) {
          return { type: "on_circle", point, circle };
        }
      }

      // "inscribed" / "circumscribed" / "on_circle_triangle" etc.:
      // {type:"inscribed", triangle:"ABC", circle:"O"}
      // → expand to on_circle for each vertex + inject a triangle object
      if (t === "inscribed" || t === "circumscribed" || t === "circumscribed_circle"
          || t === "inscribed_in" || t === "on_circle_triangle" || t === "triangle_on_circle"
          || t === "circumcircle" || t === "noi_tiep") {
        const circleId = String(c.circle ?? objects[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "O";
        // Extract vertices from triangle field (string like "ABC") or vertices/points array
        let verts: string[] = [];
        const triRaw = c.triangle ?? c.vertices ?? c.points ?? objects.slice(1).join("");
        if (typeof triRaw === "string") {
          verts = triRaw.toUpperCase().replace(/[^A-Z]/g, "").split("").slice(0, 3);
        } else if (Array.isArray(triRaw)) {
          verts = triRaw.map((v: any) => String(v).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)).filter(Boolean).slice(0, 3);
        }
        if (verts.length === 3) {
          // Ensure triangle object exists
          const hasTriangle = obj.objects.some((o: any) =>
            o && String(o.type || "").toLowerCase() === "triangle" &&
            Array.isArray(o.points) && o.points.join("") === verts.join("")
          );
          if (!hasTriangle) {
            obj.objects.push({ type: "triangle", points: verts as [string, string, string] });
          }
          return verts.map((v: string) => ({ type: "on_circle", point: v, circle: circleId }));
        }
      }

      if (t === "intersection") {
        const point = String(c.point ?? objects[2] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const l1 = String((c.of && c.of[0]) ?? objects[0] ?? "");
        const l2 = String((c.of && c.of[1]) ?? objects[1] ?? "");
        return { type: "intersection", point, of: [l1, l2] };
      }

      // Non-standard triangle-line constraint types LLMs commonly invent.
      // Each is expanded into multiple valid constraints returned as an array.

      // angle_bisector: {type,point,vertex,opposite_side:[B,C]}
      //   or {type,bisects,of:[A,B,C],foot:K}  → equal_angle + on_line on opposite side
      if (t === "angle_bisector" || t === "bisector" || t === "angle_bisects") {
        const foot = String(c.point ?? c.foot ?? objects[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const from = String(c.vertex ?? c.from ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const side = Array.isArray(c.opposite_side) ? c.opposite_side
          : Array.isArray(c.side) ? c.side
          : Array.isArray(c.base) ? c.base : [];
        const sA = String(side[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const sB = String(side[1] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (foot && from && sA && sB) {
          return [
            { type: "equal_angle", angles: [[sA, from, foot], [foot, from, sB]] },
            { type: "point_on_line", point: foot, line: `${sA}${sB}` }
          ];
        }
      }

      // median: {type,point,vertex,opposite_side:[B,C]}
      //   → midpoint on opposite side
      if (t === "median" || t === "midpoint_line") {
        const foot = String(c.point ?? c.foot ?? objects[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const side = Array.isArray(c.opposite_side) ? c.opposite_side
          : Array.isArray(c.side) ? c.side
          : Array.isArray(c.base) ? c.base : [];
        const sA = String(side[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const sB = String(side[1] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (foot && sA && sB) {
          return { type: "midpoint", point: foot, segment: [sA, sB] };
        }
      }

      // altitude: {type,point,vertex,opposite_side:[B,C]}
      //   → perpendicular + on_line on opposite side
      if (t === "altitude" || t === "height" || t === "perpendicular_foot") {
        const foot = String(c.point ?? c.foot ?? objects[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const from = String(c.vertex ?? c.from ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const side = Array.isArray(c.opposite_side) ? c.opposite_side
          : Array.isArray(c.side) ? c.side
          : Array.isArray(c.base) ? c.base : [];
        const sA = String(side[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const sB = String(side[1] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (foot && from && sA && sB) {
          const altLine = `${from}${foot}`;
          return [
            { type: "perpendicular", line1: altLine, line2: `${sA}${sB}` },
            { type: "point_on_line", point: foot, line: `${sA}${sB}` }
          ];
        }
      }

      return c;
    })
    .flat()
    .filter(Boolean)
    .filter((c: any) => {
      if (!c || typeof c !== "object") return false;
      if (c.type === "tangent") return Boolean(c.line && c.circle && c.at);
      if (c.type === "perpendicular") return Boolean(c.line1 && c.line2);
      if (c.type === "intersection") return Boolean(c.point && Array.isArray(c.of) && c.of[0] && c.of[1]);
      if (c.type === "diameter") return Boolean(c.circle && Array.isArray(c.points) && c.points[0] && c.points[1]);
      if (c.type === "on_circle") return Boolean(c.point && c.circle);
      if (c.type === "passes_through") return Boolean(c.line && c.point);
      if (c.type === "midpoint") return Boolean(c.point && c.segment);
      if (c.type === "point_on_line") return Boolean(c.point && c.line);
      if (c.type === "on_line") return Boolean(c.point);
      if (c.type === "collinear") return Array.isArray(c.points) && c.points.length >= 2;
      if (c.type === "right_angle") return Boolean(Array.isArray(c.points) && c.points.length >= 3);
      if (c.type === "equal_length") return Boolean(c.segments);
      if (c.type === "equal_angle") return Boolean(c.angles);
      if (c.type === "parallel") return Boolean(c.line1 && c.line2);
      return false;
    });

  obj.constructions = obj.constructions
    .map((s: any) => {
      if (!s || typeof s !== "object") {
        return null;
      }
      const t = String(s.type || "").toLowerCase();
      if (t === "intersection_of_lines") {
        const lines = Array.isArray(s.lines) ? s.lines : [];
        const point = String(s.point ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        return { type: "intersection", point, of: [String(lines[0] ?? ""), String(lines[1] ?? "")] };
      }
      if (t === "line_through_point_perpendicular_to_line" || t === "line_perpendicular_to_line_through_point") {
        const line = String(s.name ?? s.newLine ?? s.lineName ?? "l1");
        const to = String(s.line ?? s.to ?? "");
        const through = String((Array.isArray(s.points) ? s.points[0] : s.through) ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        return { type: "draw_perpendicular", line, to, through };
      }
      // Tangent that ended up in constructions (LLM mistake) → move to constraints.
      // {type:"tangent",at:"D",line:"DB",circle:"O"} is a constraint, not a construction.
      if (t === "tangent") {
        const line = String(s.line ?? s.line1 ?? "");
        const circle = String(s.circle ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) || "O";
        const atRaw = s.at ?? s.point ?? line;
        const at = String(atRaw).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)
          || line.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        if (line && at) {
          if (!Array.isArray(obj.constraints)) obj.constraints = [];
          obj.constraints.push({ type: "tangent", line, circle, at });
        }
        return null;
      }
      // Perpendicular constraint that ended up in constructions array (LLM mistake).
      // {type:"perpendicular",line1:"l1",line2:"CE"} — convert to draw_perpendicular
      // by inferring the "through" point from whatever named point is not on the ref line.
      if (t === "perpendicular" && s.line1 && s.line2) {
        const line1 = String(s.line1).trim();
        const line2 = String(s.line2).trim();
        const anonPattern = /^l\d+$/i;
        const anonLine = anonPattern.test(line1) ? line1 : anonPattern.test(line2) ? line2 : null;
        const refLine = anonLine === line1 ? line2 : line1;
        // Also push a perpendicular constraint so downstream layout can use it
        if (!Array.isArray(obj.constraints)) obj.constraints = [];
        obj.constraints.push({ type: "perpendicular", line1, line2 });
        if (anonLine) {
          // Infer "through" point: first known point not appearing in refLine
          const refEndpoints = new Set(refLine.toUpperCase().replace(/[^A-Z]/g, "").split(""));
          const candidates: string[] = [];
          for (const o of obj.objects) {
            if (!o) continue;
            if (o.center) candidates.push(String(o.center).toUpperCase().slice(0, 1));
            if (o.name && !Array.isArray(o.name)) candidates.push(String(o.name).toUpperCase().slice(0, 1));
            if (Array.isArray(o.points)) o.points.forEach((p: any) => candidates.push(String(p).toUpperCase().slice(0, 1)));
          }
          const through = candidates.find(p => p && /^[A-Z]$/.test(p) && !refEndpoints.has(p));
          if (through) {
            return { type: "draw_perpendicular", line: anonLine, to: refLine, through };
          }
        }
        return null;
      }
      return s;
    })
    .filter(Boolean);

  obj.targets = obj.targets
    .map((t: any) => {
      if (typeof t === "string") {
        return { type: "statement", text: t };
      }
      if (t && typeof t === "object" && typeof t.statement === "string") {
        return { type: "statement", text: t.statement };
      }
      if (t && typeof t === "object" && String(t.type || "").toLowerCase() === "right_angle") {
        const triangle = Array.isArray(t.triangle)
          ? t.triangle
          : Array.isArray(t.points)
            ? t.points
            : undefined;
        const at = String(t.at ?? (Array.isArray(triangle) ? triangle[1] : "") ?? "")
          .toUpperCase()
          .replace(/[^A-Z]/g, "")
          .slice(0, 1);
        if (at) {
          return {
            type: "right_angle",
            at,
            triangle: Array.isArray(triangle) && triangle.length === 3
              ? [
                  String(triangle[0]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1),
                  String(triangle[1]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1),
                  String(triangle[2]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)
                ]
              : undefined
          };
        }
      }
      if (t && typeof t === "object" && String(t.type || "").toLowerCase() === "midpoint") {
        const point = String(t.point ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
        const segment = Array.isArray(t.segment)
          ? [
              String(t.segment[0]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1),
              String(t.segment[1]).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)
            ]
          : t.segment;
        if (point && segment) {
          return { type: "midpoint", point, segment, where: t.where };
        }
      }
      return t;
    })
    .filter(Boolean)
    .filter((t: any) => {
      // Strip invalid target types (e.g. "point" that LLMs sometimes place in targets)
      const validTargetTypes = new Set(["tangent","equation","right_angle","midpoint","parallel","perpendicular","statement"]);
      return t && typeof t === "object" && validTargetTypes.has(String(t.type || "").toLowerCase());
    });

  // Rescue perpendicular foot: for perpendicular(XY, L2) where XY is a two-letter line
  // and Y is not yet in objects, auto-inject point Y + intersection(Y, XY∩L2).
  // e.g. perpendicular(EH, CD) → inject point H + intersection(H, EH∩CD)
  {
    const existingPointIds = new Set<string>(
      obj.objects
        .filter((o: any) => o && typeof o === "object")
        .flatMap((o: any) => {
          const t = String(o.type || "").toLowerCase();
          if (t === "point" && o.name) return [String(o.name)];
          if (t === "circle" && o.center) return [String(o.center)];
          if (t === "triangle" && Array.isArray(o.points)) return o.points.map(String);
          return [];
        })
    );
    // Also collect diameter endpoints
    for (const c of obj.constraints) {
      if (!c || typeof c !== "object") continue;
      if (String(c.type || "").toLowerCase() === "diameter" && Array.isArray(c.points)) {
        c.points.forEach((p: any) => existingPointIds.add(String(p)));
      }
    }

    for (const c of obj.constraints) {
      if (!c || typeof c !== "object") continue;
      if (String(c.type || "").toLowerCase() !== "perpendicular") continue;
      const line1 = String(c.line1 ?? "");
      const line2 = String(c.line2 ?? "");
      if (line1.length !== 2) continue;
      const foot = line1[1].toUpperCase();
      // Only rescue if line1 looks like "XY" (two uppercase letters) — not construction
      // helpers like "l1", "l2". foot must be a single uppercase letter [A-Z].
      if (!/^[A-Z]$/.test(foot) || !/^[A-Z]$/.test(line1[0].toUpperCase())) continue;
      if (!existingPointIds.has(foot)) {
        // Inject the foot point and the intersection constraint
        obj.objects.push({ type: "point", name: foot });
        existingPointIds.add(foot);
        // Only add intersection if not already present
        const alreadyHasIntersection = obj.constraints.some(
          (ic: any) => ic && String(ic.type || "") === "intersection" && String(ic.point || "") === foot
        );
        if (!alreadyHasIntersection) {
          obj.constraints.push({ type: "intersection", point: foot, of: [line1, line2] });
        }
      }
    }
  }

  // Auto-inject missing segments/lines: scan problem text and construction references
  // for two-letter uppercase names (like "AD", "BC", "EH") not yet in objects.
  // NOTE: we intentionally do NOT scan LLM target text, as the LLM may hallucinate
  // targets from examples (e.g. copy "AD and BC meet at midpoint" even when not asked).
  // Only the original problem text (user input) is the ground truth.
  {
    const existingNames = new Set<string>();
    for (const o of obj.objects) {
      if (!o || typeof o !== "object") continue;
      const t = String(o.type || "").toLowerCase();
      if (t === "segment" && Array.isArray(o.points) && o.points.length >= 2) {
        existingNames.add(o.points[0] + o.points[1]);
        existingNames.add(o.points[1] + o.points[0]);
      }
      if ((t === "line" || t === "segment") && o.name) existingNames.add(String(o.name));
    }

    const candidateNames = new Set<string>();
    // Scan constraint "of" arrays for line references (these come from parsed DSL, not hallucinated)
    for (const c of obj.constraints) {
      if (Array.isArray(c?.of)) c.of.forEach((n: any) => { if (/^[A-Z]{2}$/.test(String(n))) candidateNames.add(String(n)); });
    }
    // Scan the original problem text (ground truth — user input only)
    if (problemText) {
      const matches = problemText.match(/\b[A-Z]{2}\b/g);
      if (matches) matches.forEach(m => candidateNames.add(m));
    }

    // Known single-letter circle/point centers — skip names that are not lines
    const pointNames = new Set(obj.objects.filter((o: any) => o?.type === "point").map((o: any) => String(o.name || "")));

    for (const name of candidateNames) {
      if (existingNames.has(name)) continue;
      const a = name[0], b = name[1];
      // Skip if either letter is a circle center (O etc.) and name looks like a radius
      if (existingNames.has(b + a)) continue;
      // Add as segment (two defined points) or line
      const bothArePoints = pointNames.has(a) || pointNames.has(b);
      obj.objects.push(bothArePoints
        ? { type: "segment", points: [a, b] }
        : { type: "line", name }
      );
      existingNames.add(name);
      existingNames.add(b + a);
    }
  }

  // Inscribed triangle rescue: when problem text says "tam giác XYZ nội tiếp đường tròn (O)"
  // or "triangle XYZ inscribed in circle O", ensure all three vertices have on_circle constraints.
  // The LLM often omits these or uses non-standard forms that get stripped by normalization.
  if (problemText && /n[oộ]i\s*ti[eế]p|inscribed\s+in|inskriven/i.test(problemText)) {
    // Find circle center
    const circleObj = obj.objects.find((o: any) => String(o.type || "").toLowerCase() === "circle");
    const circleCenter = String(circleObj?.center ?? circleObj?.name ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
    if (circleCenter) {
      // Extract triangle vertex letters: "tam giác ABC" / "triangle ABC" / "△ABC"
      const triMatch = problemText.match(/(?:tam\s*gi[aá]c|triangle|△)\s*([A-Z]{3})/i);
      const verts: string[] = triMatch
        ? triMatch[1].toUpperCase().split("")
        : [];
      // Also collect any points already declared in objects
      if (verts.length === 0) {
        for (const o of obj.objects) {
          if (o && String(o.type || "").toLowerCase() === "point" && /^[A-Z]$/.test(String(o.name || ""))) {
            verts.push(String(o.name));
          }
        }
      }
      for (const v of verts.slice(0, 3)) {
        if (v === circleCenter) continue;
        const alreadyOnCircle = obj.constraints.some(
          (c: any) => String(c.type || "") === "on_circle" && String(c.point || "") === v
        );
        if (!alreadyOnCircle) {
          obj.constraints.push({ type: "on_circle", point: v, circle: circleCenter });
        }
        // Ensure the point exists in objects
        const hasPoint = obj.objects.some(
          (o: any) => String(o.type || "").toLowerCase() === "point" && String(o.name || "") === v
        );
        if (!hasPoint) {
          obj.objects.push({ type: "point", name: v });
        }
      }
    }
  }

  return obj;
}

export type DslLlmDebug = {
  prompt: string;
  rawResponse: string;
  model: string;
  repairAttempted?: boolean;
  repairedResponse?: string;
};

export async function parseGeometryDslWithLLM(
  problem: string,
  options: DslParseOptions = {}
): Promise<GeometryDsl & { _llmDebug?: DslLlmDebug }> {
  // Use dynamic few-shot prompt when language context is available
  const systemPrompt = options.normalized
    ? buildDynamicGeometrySystemPrompt(options.normalized)
    : GEOMETRY_SYSTEM_PROMPT;

  // Build user message: append canonical phrase hints when available (Section 5/6 of
  // the multilingual architecture spec: the normalized representation feeds into parsing,
  // not just few-shot selection).
  const langNorm = options.normalized;
  const phraseHint =
    langNorm && langNorm.canonicalPhrases.length > 0
      ? `\n\nDetected geometry concepts (${langNorm.language}): ${langNorm.canonicalPhrases.map(p => p.type).join(", ")}`
      : "";
  const userContent = `Problem:\n${problem}${phraseHint}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent }
  ];

  const debugInfo: DslLlmDebug = { prompt: "", rawResponse: "", model: "" };

  try {
    const t0 = Date.now();
    const { text: contentText, model: selectedModel } = await callLlm(messages, options);
    console.log(`[LLM] call #1 done in ${((Date.now() - t0) / 1000).toFixed(1)}s (model=${selectedModel})`);
    console.log(`[LLM] raw response (first 500 chars):\n${contentText.slice(0, 500)}`);
    debugInfo.prompt = `[system]\n${systemPrompt}\n\n[user]\n${userContent}`;
    debugInfo.rawResponse = contentText;
    debugInfo.model = selectedModel;

    const jsonObj = extractJsonObject(contentText);
    // Apply lightweight structural repairs before schema validation.
    // This fixes common LLM output issues (missing arrays, string numbers, etc.)
    // locally, avoiding an expensive LLM retry round-trip for trivial structural problems.
    const repairResult = repairDslJson(jsonObj);
    const jsonToNormalize = repairResult.ok ? repairResult.repaired : jsonObj;
    const normalized = normalizeDsl(jsonToNormalize, problem);

    // Try strict parse first; on failure, attempt one LLM repair, then strip unrecognised objects
    let result: GeometryDsl & { _llmDebug?: DslLlmDebug };
    const strict = dslSchema.safeParse(normalized);
    if (strict.success) {
      result = strict.data as GeometryDsl & { _llmDebug?: DslLlmDebug };
    } else {
      // ── Repair attempt: re-ask LLM with the validation errors ──────────────
      console.warn(`[LLM] First response failed validation — triggering repair call. Issues: ${strict.error.issues.slice(0,3).map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}`);
      let repairedText = "";
      try {
        const repairMessages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userContent },
          { role: "assistant" as const, content: contentText },
          { role: "user" as const, content: buildLlmRepairPrompt(
            contentText,
            strict.error.issues.slice(0, 6)
              .map(i => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
              .join("\n")
          ) },
        ];
        const t1 = Date.now();
        const { text: rText } = await callLlm(repairMessages, options);
        console.log(`[LLM] call #2 (repair) done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
        repairedText = rText;
        const repairedJson = extractJsonObject(rText);
        const repairedNorm = normalizeDsl(repairedJson, problem);
        const repairedStrict = dslSchema.safeParse(repairedNorm);
        if (repairedStrict.success) {
          debugInfo.repairAttempted = true;
          debugInfo.repairedResponse = repairedText;
          result = repairedStrict.data as GeometryDsl & { _llmDebug?: DslLlmDebug };
          result._llmDebug = debugInfo;
          return result;
        }
        // Repair produced different (potentially cleaner) JSON — use it for cleanup below
        if (repairedNorm && typeof repairedNorm === "object") {
          if (Array.isArray((repairedNorm as any).objects)) (normalized as any).objects = (repairedNorm as any).objects;
          if (Array.isArray((repairedNorm as any).constraints)) (normalized as any).constraints = (repairedNorm as any).constraints;
          if (Array.isArray((repairedNorm as any).constructions)) (normalized as any).constructions = (repairedNorm as any).constructions;
          if (Array.isArray((repairedNorm as any).targets)) (normalized as any).targets = (repairedNorm as any).targets;
        }
        debugInfo.repairAttempted = true;
        debugInfo.repairedResponse = repairedText;
      } catch {
        // LLM repair call failed — fall through with original normalized DSL
      }

      // ── Cleanup fallback: strip unrecognised objects and re-validate ────────
      const objectUnion: any = (dslSchema.shape as any).objects._def?.innerType?.element ?? null;
      const cleanedObjects = ((normalized as any).objects as any[]).filter((o: any) => {
        if (!o || typeof o !== "object") return false;
        if (!objectUnion) return true;
        return objectUnion.safeParse(o).success;
      });
      result = dslSchema.parse({ ...(normalized as any), objects: cleanedObjects }) as GeometryDsl & { _llmDebug?: DslLlmDebug };
    }

    result._llmDebug = debugInfo;
    return result;
  } catch (err) {
    // Guarantee _llmDebug is on every error so webapp.ts can always log 2a/2b
    (err as any)._llmDebug = debugInfo;
    throw err;
  }
}
