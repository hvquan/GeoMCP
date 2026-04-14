/**
 * scene/schema.zod.ts — Zod validators for SceneGraph v1.3.
 *
 * Use SceneGraphV13Schema.safeParse(raw) at the system boundary (server
 * request handler) to get typed, validated input with structured errors.
 */
import { z } from "zod";

export const OriginKindSchema = z.enum(["explicit", "derived", "implicit"]);

export const EditModeSchema = z.enum([
  "move_point",
  "change_radius",
  "change_angle",
  "none",
]);

export const HitTargetSchema = z.enum([
  "point",
  "center",
  "border",
  "body",
  "none",
]);

export const InteractionKindSchema = z.enum([
  "free_point",
  "derived_point",
  "parameter_handle",
  "fixed",
  "computed",
]);

export const InteractionMetaSchema = z.object({
  selectable: z.boolean().optional(),
  hoverable:  z.boolean().optional(),
  draggable:  z.boolean().optional(),
  editMode:   EditModeSchema.optional(),
  hitTarget:  HitTargetSchema.optional(),
  kind:       InteractionKindSchema.optional(),
  reason:     z.string().optional(),
});

export const BaseSceneObjectSchema = z.object({
  id:          z.string().min(1),
  label:       z.string().nullable().optional(),
  origin:      OriginKindSchema.optional(),
  roles:       z.array(z.string()).optional(),
  visible:     z.boolean().optional(),
  style:       z.string().optional(),
  debugName:   z.string().optional(),
  interaction: InteractionMetaSchema.optional(),
});

// ── Geometry ──────────────────────────────────────────────────────────────────

export const ScenePointSchema = BaseSceneObjectSchema.extend({
  kind: z.literal("point"),
  x:    z.number(),
  y:    z.number(),
});

export const SceneSegmentSchema = BaseSceneObjectSchema.extend({
  kind: z.literal("segment"),
  a:    z.string(),
  b:    z.string(),
});

const DirectionSchema = z.object({ x: z.number(), y: z.number() });

export const SceneRaySchema = z.union([
  BaseSceneObjectSchema.extend({
    kind:         z.literal("ray"),
    originPoint:  z.string(),
    throughPoint: z.string(),
  }),
  BaseSceneObjectSchema.extend({
    kind:        z.literal("ray"),
    originPoint: z.string(),
    direction:   DirectionSchema,
  }),
]);

export const SceneLineSchema = z.union([
  BaseSceneObjectSchema.extend({
    kind: z.literal("line"),
    a:    z.string(),
    b:    z.string(),
  }),
  BaseSceneObjectSchema.extend({
    kind:          z.literal("line"),
    throughPointId: z.string(),
    direction:     DirectionSchema,
  }),
]);

export const SceneCircleSchema = BaseSceneObjectSchema.extend({
  kind:   z.literal("circle"),
  center: z.string(),
  radius: z.number().positive(),
});

export const SceneTriangleSchema = BaseSceneObjectSchema.extend({
  kind:   z.literal("triangle"),
  points: z.tuple([z.string(), z.string(), z.string()]),
  fill:   z.string().optional(),
});

export const ScenePolygonSchema = BaseSceneObjectSchema.extend({
  kind:   z.literal("polygon"),
  points: z.array(z.string()).min(3),
  fill:   z.string().optional(),
});

export const SceneGeometryNodeSchema = z.union([
  SceneSegmentSchema,
  SceneRaySchema,
  SceneLineSchema,
  SceneCircleSchema,
  SceneTriangleSchema,
  ScenePolygonSchema,
]);

// ── Marks ─────────────────────────────────────────────────────────────────────

export const AngleMarkStyleSchema = z.enum(["single_arc", "double_arc", "triple_arc"]);

export const SceneAngleMarkSchema = BaseSceneObjectSchema.extend({
  kind:      z.literal("angle_mark"),
  points:    z.tuple([z.string(), z.string(), z.string()]),
  group:     z.string().optional(),
  markStyle: AngleMarkStyleSchema,
  radius:    z.number().positive().optional(),
});

export const SceneRightAngleMarkSchema = BaseSceneObjectSchema.extend({
  kind:    z.literal("right_angle_mark"),
  pointId: z.string(),
  line1Id: z.string(),
  line2Id: z.string(),
  size:    z.number().positive().optional(),
});

export const SegmentMarkStyleSchema = z.enum(["single_tick", "double_tick", "triple_tick"]);

export const SceneSegmentMarkSchema = BaseSceneObjectSchema.extend({
  kind:      z.literal("segment_mark"),
  a:         z.string(),
  b:         z.string(),
  group:     z.string().optional(),
  markStyle: SegmentMarkStyleSchema,
  size:      z.number().positive().optional(),
});

export const SceneLabelSchema = BaseSceneObjectSchema.extend({
  kind:     z.literal("label"),
  targetId: z.string(),
  text:     z.string(),
  dx:       z.number().optional(),
  dy:       z.number().optional(),
});

// ── Root ──────────────────────────────────────────────────────────────────────

export const SceneGraphV13Schema = z.object({
  version:          z.literal("scene-graph/v1.3"),
  coordinateSystem: z.literal("math-y-up").optional(),
  points:           z.array(ScenePointSchema),
  geometry:         z.array(SceneGeometryNodeSchema),
  angleMarks:       z.array(SceneAngleMarkSchema),
  rightAngleMarks:  z.array(SceneRightAngleMarkSchema),
  segmentMarks:     z.array(SceneSegmentMarkSchema),
  labels:           z.array(SceneLabelSchema).optional(),
});

export type SceneGraphV13Input = z.infer<typeof SceneGraphV13Schema>;
