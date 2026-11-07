import type { Draft } from 'immer';
import { gableOnLevel, DEFAULT_OVERHANG, DEFAULT_PITCH, type GableSlope } from '../roofs/gable';
import { hipOnLevel, type HipPitches } from '../roofs/hip';
import type { RoofRecipe } from '../roofs/follow';
import type { Id, PlanDocument, RoofPlane } from '../model/schema';
import { CommandError, defineCommand, type CommandContext } from './history';

export interface BuildRoof {
  levelId: Id;
  pitch?: number;
  overhang?: number;
}

export interface BuildHip extends BuildRoof {
  /** Per-side pitch. A side left out uses `pitch`. */
  pitches?: HipPitches;
}

function place(doc: Draft<PlanDocument>, levelId: Id, planes: readonly GableSlope[], ctx: CommandContext): Id[] {
  for (const el of Object.values(doc.elements)) {
    if (el.kind === 'roofPlane' && el.levelId === levelId) delete doc.elements[el.id];
  }
  const ids: Id[] = [];
  for (const plane of planes) {
    const id = ctx.newId();
    const roof: RoofPlane = { id, kind: 'roofPlane', levelId, ...plane };
    doc.elements[id] = roof;
    ids.push(id);
  }
  return ids;
}

export const buildRoof = defineCommand<BuildRoof, Id[]>({
  label: () => 'Build Roof',
  run: (doc, { levelId, pitch, overhang }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const built = gableOnLevel(doc, levelId, pitch ?? DEFAULT_PITCH, overhang ?? DEFAULT_OVERHANG);
    if (!built.ok) throw new CommandError(built.error);
    return place(doc, levelId, built.roof.planes, ctx);
  },
});

export const buildHip = defineCommand<BuildHip, Id[]>({
  label: () => 'Build Hip Roof',
  run: (doc, { levelId, pitch, overhang, pitches }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const built = hipOnLevel(doc, levelId, pitch ?? DEFAULT_PITCH, overhang ?? DEFAULT_OVERHANG, pitches ?? {});
    if (!built.ok) throw new CommandError(built.error);
    return place(doc, levelId, built.roof.planes, ctx);
  },
});

export const roofCommands = {
  'roof.build': buildRoof,
  'roof.hip': buildHip,
};

/** Rebuilds roofs captured before a wall edit. An outline that no longer closes leaves the old roof. */
export function applyRoofRecipes(doc: Draft<PlanDocument>, recipes: readonly RoofRecipe[], ctx: CommandContext): void {
  for (const recipe of recipes) {
    const built =
      recipe.kind === 'gable'
        ? gableOnLevel(doc, recipe.levelId, recipe.pitch, recipe.overhang)
        : hipOnLevel(doc, recipe.levelId, recipe.pitch, recipe.overhang, recipe.pitches);
    if (!built.ok) continue;
    place(doc, recipe.levelId, built.roof.planes, ctx);
  }
}
export type RoofCommands = typeof roofCommands;
