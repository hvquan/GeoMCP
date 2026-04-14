/**
 * DSL Schema — Layer 7 (Schema Validation)
 *
 * Zod schemas that validate the raw JSON structure produced by the LLM.
 * Keeping schemas here means the validation rules are easy to find and update
 * without touching the LLM adapter or the normalization/canonicalization code.
 */

import { z } from "zod";

export const pointSchema = z.string().regex(/^[A-Z]$/);
export const pointPairSchema = z.tuple([pointSchema, pointSchema]);
export const pointTripleSchema = z.tuple([pointSchema, pointSchema, pointSchema]);
export const pointQuadSchema = z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]);
export const lineValueSchema = z.union([z.string().min(1), pointPairSchema]);

export const dslSchema = z.object({
  objects: z.array(
    z.union([
      z.object({ type: z.literal("point"), name: pointSchema }).passthrough(),
      z.object({ type: z.literal("line"), name: z.string().min(1), through: z.array(pointSchema).optional() }).passthrough(),
      z.object({ type: z.literal("segment"), name: z.string().min(1).optional(), points: pointPairSchema }).passthrough(),
      z.object({ type: z.literal("ray"), name: z.string().min(1).optional(), points: pointPairSchema }).passthrough(),
      z.object({ type: z.literal("circle"), name: pointSchema.optional(), center: pointSchema.optional(), radius: z.number().positive().optional(), through: pointSchema.optional() }).passthrough(),
      z.object({ type: z.literal("angle"), name: z.string().min(1).optional(), points: pointTripleSchema }).passthrough(),
      z.object({ type: z.literal("triangle"), name: z.string().min(1).optional(), points: pointTripleSchema }).passthrough(),
      z.object({ type: z.literal("polygon"), name: z.string().min(1).optional(), points: z.array(pointSchema).min(3) }).passthrough(),
      z.object({ type: z.literal("intersection"), point: pointSchema, of: z.tuple([z.string().min(1), z.string().min(1)]) }).passthrough(),
      z.object({ type: z.literal("midpoint"), point: pointSchema, of: pointPairSchema }).passthrough(),
      z.object({ type: z.literal("foot"), point: pointSchema, from: pointSchema, to: pointPairSchema }).passthrough(),
      z.object({ type: z.literal("projection"), point: pointSchema, from: pointSchema, to_line: z.string().min(1) }).passthrough(),
      z.object({ type: z.literal("perpendicular_line"), name: z.string().min(1).optional(), through: pointSchema, to: lineValueSchema }).passthrough(),
      z.object({ type: z.literal("parallel_line"), name: z.string().min(1).optional(), through: pointSchema, to: lineValueSchema }).passthrough(),
      z.object({ type: z.literal("tangent"), name: z.string().min(1).optional(), circle: pointSchema, at: pointSchema }).passthrough(),
      z.object({ type: z.literal("secant"), line: z.string().min(1), circle: pointSchema }).passthrough(),
      z.object({ type: z.literal("distance"), points: pointPairSchema }).passthrough(),
      z.object({ type: z.literal("length"), segment: pointPairSchema }).passthrough(),
      z.object({ type: z.literal("angle_value"), points: pointTripleSchema }).passthrough(),
      z.object({ type: z.literal("area"), polygon: z.array(pointSchema).min(3) }).passthrough(),
      z.object({ type: z.literal("isosceles_triangle"), name: z.string().min(1).optional(), points: pointTripleSchema, at: pointSchema.optional() }).passthrough(),
      z.object({ type: z.literal("equilateral_triangle"), name: z.string().min(1).optional(), points: pointTripleSchema }).passthrough(),
      z.object({ type: z.literal("right_triangle"), name: z.string().min(1).optional(), points: pointTripleSchema, rightAt: pointSchema.optional() }).passthrough(),
      z.object({ type: z.literal("right_isosceles_triangle"), name: z.string().min(1).optional(), points: pointTripleSchema, at: pointSchema.optional() }).passthrough(),
      z.object({ type: z.literal("rectangle"), name: z.string().min(1).optional(), points: pointQuadSchema }).passthrough(),
      z.object({ type: z.literal("square"), name: z.string().min(1).optional(), points: pointQuadSchema }).passthrough(),
      z.object({ type: z.literal("rhombus"), name: z.string().min(1).optional(), points: pointQuadSchema }).passthrough(),
      z.object({ type: z.literal("parallelogram"), name: z.string().min(1).optional(), points: pointQuadSchema }).passthrough(),
      z.object({ type: z.literal("trapezoid"), name: z.string().min(1).optional(), points: pointQuadSchema }).passthrough(),
      z.object({ type: z.literal("isosceles_trapezoid"), name: z.string().min(1).optional(), points: pointQuadSchema }).passthrough(),
      z.object({ type: z.literal("kite"), name: z.string().min(1).optional(), points: pointQuadSchema }).passthrough(),
    ])
  ).default([]),
  constraints: z.array(
    z.union([
      z.object({ type: z.literal("on_circle"), point: pointSchema, circle: pointSchema }).passthrough(),
      z.object({ type: z.literal("collinear"), points: z.array(pointSchema).min(2) }).passthrough(),
      z.object({ type: z.literal("diameter"), circle: pointSchema, points: z.tuple([pointSchema, pointSchema]) }).passthrough(),
      z.object({ type: z.literal("tangent"), circle: pointSchema, line: z.string().min(1).optional(), at: pointSchema.optional() }).passthrough(),
      z.object({ type: z.literal("perpendicular"), line1: z.string().min(1), line2: z.string().min(1) }).passthrough(),
      z.object({ type: z.literal("parallel"), line1: z.string().min(1), line2: z.string().min(1) }).passthrough(),
      z.object({ type: z.literal("equal_length"), segments: z.tuple([pointPairSchema, pointPairSchema]) }).passthrough(),
      z.object({ type: z.literal("equal_angle"), angles: z.tuple([pointTripleSchema, pointTripleSchema]) }).passthrough(),
      z.object({ type: z.literal("passes_through"), line: z.string().min(1), point: pointSchema }).passthrough(),
      z.object({ type: z.literal("intersection"), point: pointSchema, of: z.tuple([z.string().min(1), z.string().min(1)]) }).passthrough(),
      z.object({ type: z.literal("midpoint"), point: pointSchema, segment: z.union([z.string().min(2), pointPairSchema]) }).passthrough(),
      z.object({ type: z.literal("point_on_line"), point: pointSchema, line: z.string().min(1) }).passthrough(),
      z.object({ type: z.literal("on_line"), point: pointSchema, line: lineValueSchema }).passthrough(),
      z.object({ type: z.literal("right_angle"), points: pointTripleSchema }).passthrough(),
    ])
  ).default([]),
  constructions: z.array(
    z.union([
      z.object({ type: z.literal("intersection"), point: pointSchema, of: z.tuple([z.string().min(1), z.string().min(1)]) }).passthrough(),
      z.object({ type: z.literal("draw_line"), line: z.string().min(1), through: z.array(pointSchema).optional() }).passthrough(),
      z.object({ type: z.literal("draw_tangent"), line: z.string().min(1), circle: pointSchema, at: pointSchema }).passthrough(),
      z.object({ type: z.literal("draw_perpendicular"), line: z.string().min(1), to: z.string().min(1), through: pointSchema }).passthrough(),
      z.object({ type: z.literal("draw_parallel"), line: z.string().min(1), to: z.string().min(1), through: pointSchema }).passthrough(),
      z.object({ type: z.literal("circle"), name: pointSchema.optional(), center: pointSchema.optional(), radius: z.number().positive().optional(), through: z.union([pointSchema, z.array(pointSchema)]).optional() }).passthrough(),
      z.object({ type: z.literal("draw_circle"), name: pointSchema.optional(), center: pointSchema.optional(), radius: z.number().positive().optional(), through: z.union([pointSchema, z.array(pointSchema)]).optional() }).passthrough(),
      z.object({ type: z.literal("circumscribed_circle"), name: pointSchema.optional(), center: pointSchema.optional(), of: z.array(pointSchema).min(3).optional() }).passthrough(),
      z.object({ type: z.literal("midpoint"), point: pointSchema, of: z.union([z.tuple([pointSchema, pointSchema]), z.string().min(2)]) }).passthrough(),
      z.object({ type: z.literal("median"), from: pointSchema.optional(), foot: pointSchema.optional(), of: z.union([z.tuple([pointSchema, pointSchema]), z.string().min(2)]).optional() }).passthrough(),
      z.object({ type: z.literal("altitude"), from: pointSchema.optional(), foot: pointSchema.optional() }).passthrough(),
      z.object({ type: z.literal("angle_bisector"), from: pointSchema.optional(), foot: pointSchema.optional() }).passthrough(),
    ])
  ).default([]),
  targets: z.array(
    z.union([
      z.object({ type: z.literal("tangent"), line: z.string().min(1).optional(), circle: pointSchema.optional(), at: pointSchema.optional() }).passthrough(),
      z.object({ type: z.literal("equation"), expr: z.string().min(1) }).passthrough(),
      z.object({ type: z.literal("right_angle"), at: pointSchema.optional(), triangle: z.union([z.tuple([pointSchema, pointSchema, pointSchema]), z.string().min(1)]).optional() }).passthrough(),
      z.object({ type: z.literal("midpoint"), point: pointSchema, segment: z.union([z.string().min(2), pointPairSchema]), where: z.string().optional() }).passthrough(),
      z.object({ type: z.literal("parallel"), line1: lineValueSchema, line2: lineValueSchema }).passthrough(),
      z.object({ type: z.literal("perpendicular"), line1: lineValueSchema, line2: lineValueSchema }).passthrough(),
      z.object({ type: z.literal("statement"), text: z.string().min(1) }).passthrough(),
    ])
  ).default([]),
}).passthrough();

export type DslSchemaOutput = z.infer<typeof dslSchema>;
