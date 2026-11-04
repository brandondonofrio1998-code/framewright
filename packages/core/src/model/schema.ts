import { z } from 'zod';

export const PLAN_FORMAT_ID = 'framewright-plan';
export const PLAN_FILE_EXTENSION = 'fwplan';
export const CURRENT_SCHEMA_VERSION = 2;

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

/** Plan layers a layer set can show or hide. The sheet and DXF still draw every layer. */
export const PLAN_LAYER_IDS = ['reference', 'walls', 'openings', 'objects', 'rooms', 'dimensions', 'text', 'roof', 'foundation', 'stairs'] as const;
export type PlanLayerId = (typeof PLAN_LAYER_IDS)[number];

export const LayerSetSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(40),
  hidden: z.array(z.enum(PLAN_LAYER_IDS)),
});
export type LayerSet = z.infer<typeof LayerSetSchema>;

export const SettingsSchema = z.object({
  lengthFormat: LengthFormatSchema,
  gridSpacing: PositiveLength,
  /** Model inches per paper inch for the sheet plan. Absent means the sheet picks the largest scale that fits. */
  sheetScale: z.number().positive().max(192).optional(),
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

/** Bundled texture sets. The image files live in the desktop app; the plan only names the set. */
export const TEXTURE_IDS = ['smooth-wall', 'softwood', 'wood-planks', 'oak-floor'] as const;
export type TextureId = (typeof TEXTURE_IDS)[number];

export const MaterialTextureSchema = z.object({
  id: z.enum(TEXTURE_IDS),
  /** Inches across one repeat, width then height. The maps are applied at this real-world size. */
  tile: z.tuple([z.number().positive(), z.number().positive()]),
});
export type MaterialTexture = z.infer<typeof MaterialTextureSchema>;

export const MaterialSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  category: MaterialCategorySchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Absent for materials that have no bundled map (sheathing, for now). */
  texture: MaterialTextureSchema.optional(),
});
export type MaterialDef = z.infer<typeof MaterialSchema>;

export const Vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
export type Vec3 = z.infer<typeof Vec3Schema>;

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

export const ROOM_TYPES = ['unspecified', 'living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall', 'closet', 'garage', 'utility', 'other'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const RoomSchema = z.object({
  ...elementBase,
  kind: z.literal('room'),
  name: z.string().trim().min(1).max(100),
  roomType: z.enum(ROOM_TYPES),
  /** A point inside the room, used to keep the same room when walls move. */
  seed: Vec2Schema,
  /** null → the level's ceiling height. */
  ceilingHeight: PositiveLength.nullable(),
});
export type Room = z.infer<typeof RoomSchema>;

export const GENERATORS = [
  'cabinet.base',
  'cabinet.wall',
  'cabinet.tall',
  'appliance.range',
  'appliance.fridge',
  'appliance.dishwasher',
  'fixture.toilet',
  'fixture.sink',
  'fixture.tub',
] as const;
export type GeneratorId = (typeof GENERATORS)[number];

export const ParamValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type ParamValue = z.infer<typeof ParamValueSchema>;

export const CatalogParamSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(40),
  min: z.number(),
  max: z.number(),
});
export type CatalogParam = z.infer<typeof CatalogParamSchema>;

/** A catalog definition embedded in the plan. `params` are the defaults the item was placed with. */
export const CatalogDefSchema = z.object({
  id: IdSchema,
  sourceId: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  category: z.array(z.string().min(1).max(40)).min(1).max(3),
  generator: z.enum(GENERATORS),
  params: z.record(z.string(), ParamValueSchema),
  paramSchema: z.array(CatalogParamSchema).max(8),
  /** Placed with its back against a wall. */
  hostsToWall: z.boolean(),
});
export type CatalogDef = z.infer<typeof CatalogDefSchema>;

export const CatalogObjectSchema = z.object({
  ...elementBase,
  kind: z.literal('object'),
  defId: IdSchema,
  /** Center of the object in plan. */
  p: Vec2Schema,
  /** Height of the object's base above the level. */
  z: NonNegativeLength,
  /** Radians counter-clockwise from +x. Local +y points at the object's back. */
  rotation: z.number(),
  /** Overrides of the definition's params. */
  params: z.record(z.string(), ParamValueSchema),
  hostWallId: IdSchema.optional(),
  /** Distance along the wall from node a to the object's center. */
  hostT: z.number().optional(),
  side: z.enum(['left', 'right']).optional(),
});
export type CatalogObject = z.infer<typeof CatalogObjectSchema>;

export const CAMERA_MODES = ['orbit', 'walk'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

/** A saved 3D view. It is not drawn in plan. */
export const CameraSchema = z.object({
  ...elementBase,
  kind: z.literal('camera'),
  name: z.string().trim().min(1).max(100),
  mode: z.enum(CAMERA_MODES),
  eye: Vec3Schema,
  /** A point the camera looks at. Distinct from `eye`. */
  target: Vec3Schema,
  /** Absent means a perspective orbit. A walk camera does not use this. */
  projection: z.literal('orthographic').optional(),
  /** Orthographic zoom. Absent means the view fits the eye distance. */
  zoom: z.number().positive().max(1000).optional(),
});
export type SavedCamera = z.infer<typeof CameraSchema>;

/** One slope of a roof. Height is `eaveZ` at `eave`, rising `pitch` inches per 12 inches of run along `up`. */
export const RoofPlaneSchema = z.object({
  ...elementBase,
  kind: z.literal('roofPlane'),
  polygon: z.array(Vec2Schema).min(3).max(8),
  /** Rise per 12 inches of horizontal run. */
  pitch: z.number().positive().max(24),
  /** Unit vector in plan, from the fascia toward the ridge. */
  up: Vec2Schema,
  /** A point on the fascia. */
  eave: Vec2Schema,
  /** Height of the fascia, in inches. */
  eaveZ: z.number().finite(),
  /** Walls this roof was built from. */
  generatedFrom: z.array(IdSchema).max(64),
});
export type RoofPlane = z.infer<typeof RoofPlaneSchema>;

/** A slab under a closed outline, with a footing strip under each exterior wall. */
export const FoundationSchema = z.object({
  ...elementBase,
  kind: z.literal('foundation'),
  /** The slab, counter-clockwise in plan. Its edge is the inside face of the stem wall. */
  polygon: z.array(Vec2Schema).min(3).max(128),
  /** Slab thickness, inches. The top meets the underside of the drawn floor. */
  thickness: z.number().positive().max(24),
  /** Footing width, inches, centered on the exterior wall centerline. */
  footingWidth: z.number().positive().max(48),
  /** Footing depth below the bottom of the slab. */
  footingDepth: z.number().nonnegative().max(48),
  /** Stem wall thickness, inches, measured in from the outside face. Absent on a foundation saved before stem walls. */
  stemThickness: z.number().positive().max(16).optional(),
  /** Inches the stem continues above the slab. Absent or 0 keeps the top at the underside of the floor. */
  stemRise: z.number().nonnegative().max(144).optional(),
  /** Open inches between the slab and the underside of the floor. Absent or 0 keeps the slab against the floor. */
  clearance: z.number().nonnegative().max(144).optional(),
  materialId: IdSchema,
  /** One quad per exterior wall. */
  footings: z.array(z.array(Vec2Schema).min(3).max(8)).max(128),
  /** One quad per exterior wall. The outside edge is the wall's outside face. Absent on an older foundation. */
  stems: z.array(z.array(Vec2Schema).min(3).max(8)).max(128).optional(),
  /** Walls this foundation was built from. */
  generatedFrom: z.array(IdSchema).max(128),
});
export type Foundation = z.infer<typeof FoundationSchema>;

/** A straight flight from this level's floor to the level above. IRC 2021 R311.7. */
export const StairSchema = z.object({
  ...elementBase,
  kind: z.literal('stair'),
  /** Bottom of the flight. */
  start: Vec2Schema,
  /** Unit vector in plan, toward the top of the flight. */
  dir: Vec2Schema,
  /** Horizontal length of the treads, inches. */
  run: z.number().positive().max(600),
  /** Clear width, inches. */
  width: z.number().min(36).max(120),
  /** The level whose floor this flight arrives at. */
  toLevelId: IdSchema,
  risers: z.number().int().min(2).max(40),
  /** Equal riser height, inches. At most 7 3/4. */
  riser: z.number().positive().max(7.75),
  /** Equal tread depth, inches. At least 10, at most 10 feet. */
  tread: z.number().min(10).max(120),
  /**
   * Second flight of an L or U stair. Absent on a straight flight.
   * An L landing is a square of `width`. A U landing is `width` deep and twice that across.
   */
  landing: z
    .object({
      /** Unit vector of the second flight. Perpendicular to `dir` for an L, opposite `dir` for a U. */
      dir: Vec2Schema,
      run: z.number().positive().max(600),
      risers: z.number().int().min(2).max(38),
      tread: z.number().min(10).max(120),
      /** Which side the return flight sits on. 1 is left of `dir`. Present only on a U stair. */
      side: z.union([z.literal(1), z.literal(-1)]).optional(),
    })
    .optional(),
});
export type Stair = z.infer<typeof StairSchema>;

const CadLineSchema = z.object({ t: z.literal('line'), a: Vec2Schema, b: Vec2Schema });
const CadPolylineSchema = z.object({ t: z.literal('polyline'), pts: z.array(Vec2Schema).min(2).max(500), closed: z.boolean() });
const CadArcSchema = z.object({
  t: z.literal('arc'),
  c: Vec2Schema,
  r: z.number().positive().max(100_000),
  start: z.number(),
  sweep: z.number(),
});
const CadTextSchema = z.object({ t: z.literal('text'), p: Vec2Schema, s: z.string().max(250), size: z.number().positive().max(1000) });
export const CadPrimSchema = z.discriminatedUnion('t', [CadLineSchema, CadPolylineSchema, CadArcSchema, CadTextSchema]);
export type CadPrim = z.infer<typeof CadPrimSchema>;

/** A drawing imported from DXF. Model inches, Y up. It is a reference, not part of the building. */
export const CadSchema = z.object({
  ...elementBase,
  kind: z.literal('cad'),
  prims: z.array(CadPrimSchema).min(1).max(20_000),
});
export type Cad = z.infer<typeof CadSchema>;

/** A note on the plan. Letter height is in model inches. */
export const TextSchema = z.object({
  ...elementBase,
  kind: z.literal('text'),
  /** Anchor of the note. Letters grow up and to the right. */
  p: Vec2Schema,
  text: z.string().trim().min(1).max(250),
  /** Letter height, inches. */
  size: z.number().min(1).max(120),
});
export type TextNote = z.infer<typeof TextSchema>;

export const ElementSchema = z.discriminatedUnion('kind', [
  WallNodeSchema,
  WallSchema,
  DimensionSchema,
  DoorSchema,
  WindowSchema,
  RoomSchema,
  CatalogObjectSchema,
  CameraSchema,
  RoofPlaneSchema,
  FoundationSchema,
  StairSchema,
  CadSchema,
  TextSchema,
]);
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
  /** Catalog definitions used by objects in this plan. */
  catalogDefs: z.record(IdSchema, CatalogDefSchema),
  elements: z.record(IdSchema, ElementSchema),
  /** Named plan-layer visibility. Absent means every layer is shown. The active id is one of these. */
  layerSets: z.array(LayerSetSchema).max(12).optional(),
  activeLayerSet: IdSchema.optional(),
});
export type PlanDocument = z.infer<typeof DocumentSchema>;
