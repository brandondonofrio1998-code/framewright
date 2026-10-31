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

/** A dimension end follows its wall node while that node exists; `p` is its last known position. */
export const DimensionEndSchema = z.object({ p: Vec2Schema, nodeId: IdSchema.optional() });
export type DimensionEnd = z.infer<typeof DimensionEndSchema>;

export const DimensionSchema = z.object({
  ...elementBase,
  kind: z.literal('dimension'),
  a: DimensionEndSchema,
  b: DimensionEndSchema,
  /** Distance of the dimension line from the measured points, positive to the left of a → b. */
  offset: Length,
});
export type Dimension = z.infer<typeof DimensionSchema>;

export const DOOR_STYLES = ['hinged', 'double', 'pocket', 'sliding', 'bifold', 'opening'] as const;
export const WINDOW_STYLES = ['double-hung', 'casement', 'slider', 'awning', 'fixed'] as const;
export type DoorStyle = (typeof DOOR_STYLES)[number];
export type WindowStyle = (typeof WINDOW_STYLES)[number];

const openingBase = {
  ...elementBase,
  wallId: IdSchema,
  /** Distance along the wall from node a to the opening's center. */
  t: Length,
  width: PositiveLength,
  height: PositiveLength,
  /** Swing side for doors, exterior side for windows, relative to the wall's a → b direction. */
  side: z.enum(['left', 'right']),
  /** Which jamb carries the hinge: the one nearer node a ('start') or node b ('end'). */
  hinge: z.enum(['start', 'end']),
};

export const DoorSchema = z.object({ ...openingBase, kind: z.literal('door'), style: z.enum(DOOR_STYLES) });
export type Door = z.infer<typeof DoorSchema>;

export const WindowSchema = z.object({
  ...openingBase,
  kind: z.literal('window'),
  /** Height of the bottom of the window above the wall's base. */
  sill: NonNegativeLength,
  style: z.enum(WINDOW_STYLES),
});
/** Named to avoid clashing with the DOM's `Window` in renderer code. */
export type WindowOpening = z.infer<typeof WindowSchema>;

export type Opening = Door | WindowOpening;

export const ElementSchema = z.discriminatedUnion('kind', [WallNodeSchema, WallSchema, DimensionSchema, DoorSchema, WindowSchema]);
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
