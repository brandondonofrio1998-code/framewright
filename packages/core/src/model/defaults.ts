import { CURRENT_SCHEMA_VERSION, PLAN_FORMAT_ID, type Level, type MaterialDef, type PlanDocument, type WallType } from './schema';
import { DEFAULT_LENGTH_FORMAT } from '../units/length';

export type IdGenerator = () => string;

export interface CreateDocumentOptions {
  newId: IdGenerator;
  now: string;
  appVersion: string;
  title?: string;
}

/** 8' ceiling: 92 5/8" precut studs + three 1 1/2" plates. */
export const DEFAULT_CEILING_HEIGHT = 97.125;
/** 11 7/8" I-joists + 3/4" subfloor. */
export const DEFAULT_FLOOR_DEPTH = 12.625;
export const DEFAULT_CEILING_FINISH = 0.5;

export function newLevel(newId: IdGenerator, name: string, elevation: number): Level {
  return {
    id: newId(),
    name,
    elevation,
    ceilingHeight: DEFAULT_CEILING_HEIGHT,
    floorDepth: DEFAULT_FLOOR_DEPTH,
    ceilingFinish: DEFAULT_CEILING_FINISH,
  };
}

export function createDocument({ newId, now, appVersion, title = 'Untitled' }: CreateDocumentOptions): PlanDocument {
  const material = (name: string, category: MaterialDef['category'], color: string): MaterialDef => ({
    id: newId(),
    name,
    category,
    color,
  });
  const drywall = material('Gypsum board 1/2"', 'drywall', '#ECEAE6');
  const studs = material('SPF framing lumber', 'framing', '#D9B98A');
  const osb = material('OSB sheathing 7/16"', 'sheathing', '#C9A66B');
  const siding = material('Lap siding', 'siding', '#B8BDB5');

  const exterior: WallType = {
    id: newId(),
    name: 'Exterior 2x6',
    layers: [
      { materialId: siding.id, thickness: 0.75, fn: 'finish' },
      { materialId: osb.id, thickness: 0.4375, fn: 'sheathing' },
      { materialId: studs.id, thickness: 5.5, fn: 'structure' },
      { materialId: drywall.id, thickness: 0.5, fn: 'finish' },
    ],
    coreIndex: [2, 2],
  };
  const interior: WallType = {
    id: newId(),
    name: 'Interior 2x4',
    layers: [
      { materialId: drywall.id, thickness: 0.5, fn: 'finish' },
      { materialId: studs.id, thickness: 3.5, fn: 'structure' },
      { materialId: drywall.id, thickness: 0.5, fn: 'finish' },
    ],
    coreIndex: [1, 1],
  };

  const level1 = newLevel(newId, 'Level 1', 0);
  return {
    format: PLAN_FORMAT_ID,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { id: newId(), title, created: now, modified: now, appVersion },
    settings: { lengthFormat: DEFAULT_LENGTH_FORMAT, gridSpacing: 12 },
    levels: { [level1.id]: level1 },
    levelOrder: [level1.id],
    wallTypes: { [exterior.id]: exterior, [interior.id]: interior },
    materials: Object.fromEntries([drywall, studs, osb, siding].map((m) => [m.id, m])),
    catalogDefs: {},
    elements: {},
  };
}
