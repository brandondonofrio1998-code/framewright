import { MaterialSchema, WallTypeSchema, type Id, type MaterialDef, type WallLayer } from '../model/schema';
import { getWall } from '../walls/graph';
import { reconcileRooms, snapshotRoomPolygons } from '../rooms/rooms';
import { applyFoundationRecipes, foundationRecipes } from './foundations';
import { CommandError, defineCommand } from './history';

export const MATERIAL_PRESETS: Omit<MaterialDef, 'id'>[] = [
  { name: 'Fiberglass batts', category: 'insulation', color: '#E9A8B6' },
  { name: 'Mineral wool batts', category: 'insulation', color: '#AFA87D' },
  { name: 'Cellulose (dense pack)', category: 'insulation', color: '#99958B' },
  { name: 'Open-cell spray foam', category: 'insulation', color: '#F5E9C9' },
  { name: 'Closed-cell spray foam', category: 'insulation', color: '#DCD6AF' },
  { name: 'Rigid foam board', category: 'insulation', color: '#91C5DF' },
  { name: 'Plywood sheathing', category: 'sheathing', color: '#C79D64' },
  { name: 'Fiber cement siding', category: 'siding', color: '#879DA5' },
  { name: 'Brick veneer', category: 'generic', color: '#A55B48' },
];

const addPresets = defineCommand<void>({
  label: () => 'Add Material Choices',
  run: (doc, _, ctx) => {
    for (const preset of MATERIAL_PRESETS) {
      if (Object.values(doc.materials).some((m) => m.name === preset.name)) continue;
      const id = ctx.newId();
      doc.materials[id] = { id, ...preset };
    }
  },
});

const updateMaterial = defineCommand<{ id: Id; name?: string; color?: string }>({
  label: () => 'Edit Material',
  run: (doc, { id, ...changes }) => {
    const original = doc.materials[id];
    if (!original) throw new CommandError('Material no longer exists.');
    const parsed = MaterialSchema.safeParse({ ...original, ...changes });
    if (!parsed.success) throw new CommandError('Use a name and a valid color.');
    doc.materials[id] = parsed.data;
  },
});

/** Copy-on-edit keeps changes local to this wall, including when its type was shared. */
const setAssembly = defineCommand<{ wallId: Id; layers: WallLayer[] }>({
  label: () => 'Edit Wall Materials',
  run: (doc, { wallId, layers }, ctx) => {
    const wall = getWall(doc, wallId);
    const original = doc.wallTypes[wall.typeId]!;
    const structure = layers.flatMap((layer, i) => layer.fn === 'structure' ? [i] : []);
    if (structure.length !== 1) throw new CommandError('Keep one structural framing layer.');
    if (layers.some((layer) => !doc.materials[layer.materialId])) throw new CommandError('Choose an existing material.');
    const parsed = WallTypeSchema.safeParse({ ...original, layers, coreIndex: [structure[0], structure[0]] });
    if (!parsed.success || layers.some((layer) => layer.thickness > 24)) throw new CommandError('Each layer must be greater than zero and at most 24 inches thick.');
    const rooms = snapshotRoomPolygons(doc);
    const foundations = foundationRecipes(doc);
    const shared = Object.values(doc.elements).some((el) => el.kind === 'wall' && el.id !== wallId && el.typeId === wall.typeId);
    // Never mutate the built-in drawing type, even when only one wall uses it.
    const id = shared || !original.name.endsWith(' (custom)') ? ctx.newId() : original.id;
    doc.wallTypes[id] = { ...parsed.data, id, name: original.name.endsWith(' (custom)') ? original.name : `${original.name.slice(0, 90)} (custom)` };
    wall.typeId = id;
    reconcileRooms(doc, rooms, ctx);
    applyFoundationRecipes(doc, foundations, ctx);
  },
});

export const materialCommands = {
  'material.presets': addPresets,
  'material.update': updateMaterial,
  'wall.assembly': setAssembly,
};
