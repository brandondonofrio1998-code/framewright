import type { Draft } from 'immer';
import { slabOnLevel, FOOTING_DEPTH, FOOTING_WIDTH, SLAB_THICKNESS, type SlabFoundation } from '../foundations/slab';
import type { Id, PlanDocument } from '../model/schema';
import { CommandError, defineCommand, type CommandContext } from './history';

export interface BuildFoundation {
  levelId: Id;
  thickness?: number;
  footingWidth?: number;
  footingDepth?: number;
}

const CONCRETE = { name: 'Concrete', category: 'generic' as const, color: '#B8B6B0' };

function concreteId(doc: Draft<PlanDocument>, ctx: CommandContext): Id {
  const found = Object.values(doc.materials).find((material) => material.name === CONCRETE.name);
  if (found) return found.id;
  const id = ctx.newId();
  doc.materials[id] = { id, ...CONCRETE };
  return id;
}

function place(doc: Draft<PlanDocument>, levelId: Id, slabs: readonly SlabFoundation[], materialId: Id, ctx: CommandContext): Id[] {
  for (const el of Object.values(doc.elements)) {
    if (el.kind === 'foundation' && el.levelId === levelId) delete doc.elements[el.id];
  }
  const ids: Id[] = [];
  for (const slab of slabs) {
    const id = ctx.newId();
    doc.elements[id] = { id, kind: 'foundation', levelId, materialId, ...slab };
    ids.push(id);
  }
  return ids;
}

export const buildFoundation = defineCommand<BuildFoundation, Id[]>({
  label: () => 'Build Foundation',
  run: (doc, { levelId, thickness, footingWidth, footingDepth }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const built = slabOnLevel(doc, levelId, thickness ?? SLAB_THICKNESS, footingWidth ?? FOOTING_WIDTH, footingDepth ?? FOOTING_DEPTH);
    if (!built.ok) throw new CommandError(built.error);
    return place(doc, levelId, built.slabs, concreteId(doc, ctx), ctx);
  },
});

export const setStemRise = defineCommand<{ id: Id; stemRise: number }, Id>({
  label: () => 'Stem Height',
  run: (doc, { id, stemRise }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'foundation') throw new CommandError('That foundation is gone.');
    if (!(stemRise >= 0) || stemRise > 144) throw new CommandError('The stem can rise from 0 to 12 feet above the floor.');
    if (stemRise <= 1e-6) delete el.stemRise;
    else el.stemRise = stemRise;
    return id;
  },
});

export const setClearance = defineCommand<{ id: Id; clearance: number }, Id>({
  label: () => 'Basement Height',
  run: (doc, { id, clearance }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'foundation') throw new CommandError('That foundation is gone.');
    if (!(clearance >= 0) || clearance > 144) throw new CommandError('The open height under the floor must be from 0 to 12 feet.');
    if (clearance <= 1e-6) delete el.clearance;
    else el.clearance = clearance;
    return id;
  },
});

export const foundationCommands = {
  'foundation.build': buildFoundation,
  'foundation.setRise': setStemRise,
  'foundation.setClearance': setClearance,
};
export type FoundationCommands = typeof foundationCommands;
