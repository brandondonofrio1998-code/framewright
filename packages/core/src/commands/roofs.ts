import { gableOnLevel, DEFAULT_OVERHANG, DEFAULT_PITCH } from '../roofs/gable';
import type { Id, RoofPlane } from '../model/schema';
import { CommandError, defineCommand } from './history';

export interface BuildRoof {
  levelId: Id;
  pitch?: number;
  overhang?: number;
}

export const buildRoof = defineCommand<BuildRoof, Id[]>({
  label: () => 'Build Roof',
  run: (doc, { levelId, pitch, overhang }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const built = gableOnLevel(doc, levelId, pitch ?? DEFAULT_PITCH, overhang ?? DEFAULT_OVERHANG);
    if (!built.ok) throw new CommandError(built.error);
    for (const el of Object.values(doc.elements)) {
      if (el.kind === 'roofPlane' && el.levelId === levelId) delete doc.elements[el.id];
    }
    const ids: Id[] = [];
    for (const plane of built.roof.planes) {
      const id = ctx.newId();
      const roof: RoofPlane = { id, kind: 'roofPlane', levelId, ...plane };
      doc.elements[id] = roof;
      ids.push(id);
    }
    return ids;
  },
});

export const roofCommands = {
  'roof.build': buildRoof,
};
export type RoofCommands = typeof roofCommands;
