import { z } from 'zod';

export const PLAN_FORMAT_ID = 'framewright-plan';
export const PLAN_FILE_EXTENSION = 'fwplan';
export const CURRENT_SCHEMA_VERSION = 1;

export const IdSchema = z.string().min(1).max(64);
export type Id = z.infer<typeof IdSchema>;

const Length = z.number();
const PositiveLength = z.number().positive();
const NonNegativeLength = z.number().nonnegative();

export const Vec2Schema = z.object({ x: z.number(), y: z.number() });
export type Vec2 = z.infer<typeof Vec2Schema>;

export const LengthFormatSchema = z.discriminatedUnion('system', [
  z.object({
    system: z.literal('imperial'),
    style: z.enum(['ft-in', 'in']),
    denominator: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
  }),
  z.object({
    system: z.literal('metric'),
    unit: z.enum(['mm', 'cm', 'm']),
    decimals: z.number().int().min(0).max(4),
  }),
]);

export const SettingsSchema = z.object({
  lengthFormat: LengthFormatSchema,
  gridSpacing: PositiveLength,
});
export type ProjectSettings = z.infer<typeof SettingsSchema>;

export const LevelSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  /** Top of subfloor, absolute. */
  elevation: Length,
  /** Finished floor to ceiling framing. */
  ceilingHeight: PositiveLength,
  /** Floor structure below this level (joists + subfloor). */
  floorDepth: NonNegativeLength,
  ceilingFinish: NonNegativeLength,
});
export type Level = z.infer<typeof LevelSchema>;

export const MaterialCategorySchema = z.enum(['framing', 'sheathing', 'drywall', 'siding', 'insulation', 'generic']);

export const MaterialSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  category: MaterialCategorySchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type MaterialDef = z.infer<typeof MaterialSchema>;

export const WallLayerSchema = z.object({
  materialId: IdSchema,
  thickness: PositiveLength,
  fn: z.enum(['finish', 'sheathing', 'structure', 'insulation', 'air']),
});
export type WallLayer = z.infer<typeof WallLayerSchema>;

export const WallTypeSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  /** Ordered from the wall's left side to its right side (relative to a → b). */
  layers: z.array(WallLayerSchema).min(1),
  /** Inclusive range of structural core layers. */
  coreIndex: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
});
export type WallType = z.infer<typeof WallTypeSchema>;

const elementBase = {
  id: IdSchema,
  levelId: IdSchema,
  name: z.string().max(100).optional(),
  locked: z.boolean().optional(),
};

export const WallNodeSchema = z.object({ ...elementBase, kind: z.literal('wallNode'), p: Vec2Schema });
export type WallNode = z.infer<typeof WallNodeSchema>;

export const WallSchema = z.object({
  ...elementBase,
  kind: z.literal('wall'),
  a: IdSchema,
  b: IdSchema,
  typeId: IdSchema,
  /** null → derived from the level. */
  height: PositiveLength.nullable(),
  baseOffset: Length,
});
export type Wall = z.infer<typeof WallSchema>;

export const ElementSchema = z.discriminatedUnion('kind', [WallNodeSchema, WallSchema]);
export type Element = z.infer<typeof ElementSchema>;
export type ElementKind = Element['kind'];

export const DocumentSchema = z.object({
  format: z.literal(PLAN_FORMAT_ID),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  meta: z.object({
    id: IdSchema,
    title: z.string().max(200),
    created: z.string(),
    modified: z.string(),
    appVersion: z.string(),
  }),
  settings: SettingsSchema,
  levels: z.record(IdSchema, LevelSchema),
  levelOrder: z.array(IdSchema).min(1),
  wallTypes: z.record(IdSchema, WallTypeSchema),
  materials: z.record(IdSchema, MaterialSchema),
  elements: z.record(IdSchema, ElementSchema),
});
export type PlanDocument = z.infer<typeof DocumentSchema>;
