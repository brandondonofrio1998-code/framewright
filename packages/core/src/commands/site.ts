import { distance } from '../geometry/vec2';
import { CONTOUR_GRADE, lotArea } from '../site/marks';
import type { Id, SiteMark, Vec2 } from '../model/schema';
import { CommandError, defineCommand } from './history';

const MAX_FROM_START = 24_000;
const MIN_EDGE = 12;

export const createLot = defineCommand<{ levelId: Id; points: Vec2[] }, Id>({
  label: () => 'Property Line',
  run: (doc, { levelId, points }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const corners = points.map((p) => checkCorner(p));
    if (corners.length < 3 || corners.length > 64) throw new CommandError('A lot needs 3 to 64 corners.');
    for (let i = 0; i < corners.length; i++) {
      if (distance(corners[i]!, corners[(i + 1) % corners.length]!) < MIN_EDGE) throw new CommandError('Lot corners have to be at least 1 foot apart.');
      if (distance(corners[0]!, corners[i]!) > MAX_FROM_START) throw new CommandError('A lot corner is more than 2000 feet from the start.');
    }
    if (lotArea(corners) < 144) throw new CommandError('That lot has no area.');
    const lot: SiteMark = { id: ctx.newId(), kind: 'site', levelId, role: 'lot', points: corners };
    doc.elements[lot.id] = lot;
    return lot.id;
  },
});

/** A closed terrace. It sits 12 inches above the floor until the grade is edited. */
export const createContour = defineCommand<{ levelId: Id; points: Vec2[] }, Id>({
  label: () => 'Contour',
  run: (doc, { levelId, points }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const corners = points.map((p) => checkCorner(p));
    if (corners.length < 3 || corners.length > 64) throw new CommandError('A contour needs 3 to 64 corners.');
    for (let i = 0; i < corners.length; i++) {
      if (distance(corners[i]!, corners[(i + 1) % corners.length]!) < MIN_EDGE) throw new CommandError('Contour corners have to be at least 1 foot apart.');
      if (distance(corners[0]!, corners[i]!) > MAX_FROM_START) throw new CommandError('A contour corner is more than 2000 feet from the start.');
    }
    if (lotArea(corners) < 144) throw new CommandError('That contour has no area.');
    const terrace: SiteMark = { id: ctx.newId(), kind: 'site', levelId, role: 'contour', points: corners, grade: CONTOUR_GRADE };
    doc.elements[terrace.id] = terrace;
    return terrace.id;
  },
});

export const placeNorth = defineCommand<{ levelId: Id; p: Vec2 }, Id>({
  label: () => 'North Arrow',
  run: (doc, { levelId, p }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const mark: SiteMark = { id: ctx.newId(), kind: 'site', levelId, role: 'north', p: checkCorner(p) };
    doc.elements[mark.id] = mark;
    return mark.id;
  },
});

function checkCorner(p: Vec2): Vec2 {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100_000 || Math.abs(p.y) > 100_000) {
    throw new CommandError('That point is out of range.');
  }
  return { x: p.x, y: p.y };
}

export const setLotGrade = defineCommand<{ id: Id; grade: number | null }>({
  label: () => 'Lot Grade',
  run: (doc, { id, grade }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'site' || (el.role !== 'lot' && el.role !== 'contour')) throw new CommandError('That is not a property line.');
    if (grade === null) {
      if (el.role === 'contour') throw new CommandError('A contour keeps its grade.');
      delete el.grade;
      return;
    }
    if (!Number.isFinite(grade) || grade < -240 || grade > 240) throw new CommandError('Grade has to stay within 20 feet of the floor.');
    el.grade = grade;
  },
});

export const siteCommands = {
  'site.lot': createLot,
  'site.contour': createContour,
  'site.north': placeNorth,
  'site.grade': setLotGrade,
};
