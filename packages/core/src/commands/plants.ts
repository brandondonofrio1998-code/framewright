import type { Id, Plant, Vec2 } from '../model/schema';
import { PLANT_HEIGHT, PLANT_RADIUS } from '../model/schema';
import { CommandError, defineCommand } from './history';

export const createPlant = defineCommand<{ levelId: Id; p: Vec2 }, Id>({
  label: () => 'Plant',
  run: (doc, { levelId, p }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const plant: Plant = { id: ctx.newId(), kind: 'plant', levelId, p: checkPoint(p), radius: PLANT_RADIUS, height: PLANT_HEIGHT };
    doc.elements[plant.id] = plant;
    return plant.id;
  },
});

export const updatePlant = defineCommand<{ id: Id; radius?: number; height?: number }>({
  label: () => 'Plant',
  run: (doc, { id, radius, height }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'plant') throw new CommandError('That plant no longer exists.');
    if (radius !== undefined) {
      if (!Number.isFinite(radius) || radius < 12 || radius > 600) throw new CommandError('Canopy radius has to be from 1 foot to 50 feet.');
      el.radius = radius;
    }
    if (height !== undefined) {
      if (!Number.isFinite(height) || height < 24 || height > 1200) throw new CommandError('Height has to be from 2 feet to 100 feet.');
      el.height = height;
    }
  },
});

function checkPoint(p: Vec2): Vec2 {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100_000 || Math.abs(p.y) > 100_000) {
    throw new CommandError('That point is out of range.');
  }
  return { x: p.x, y: p.y };
}

export const plantCommands = {
  'plant.create': createPlant,
  'plant.update': updatePlant,
};
