import type { Draft } from 'immer';
import type { CameraMode, Id, PlanDocument, SavedCamera, Vec3 } from '../model/schema';
import { lookLength, MIN_LOOK } from '../view/walk';
import { CommandError, defineCommand } from './history';

const MAX_COORD = 1_000_000;

function checkLevel(doc: Draft<PlanDocument>, levelId: Id): void {
  if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
}

function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new CommandError('Name cannot be empty.');
  if (trimmed.length > 100) throw new CommandError('Name is too long (100 characters max).');
  return trimmed;
}

function checkPoint(p: Vec3, what: string): Vec3 {
  for (const value of [p.x, p.y, p.z]) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_COORD) throw new CommandError(`${what} is out of range.`);
  }
  return { x: p.x, y: p.y, z: p.z };
}

function uniqueName(doc: Draft<PlanDocument>, base: string): string {
  const names = new Set(Object.values(doc.elements).flatMap((el) => (el.kind === 'camera' ? [el.name] : [])));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

export interface SaveCamera {
  levelId: Id;
  name: string;
  mode: CameraMode;
  eye: Vec3;
  target: Vec3;
}

export const saveCamera = defineCommand<SaveCamera, Id>({
  label: () => 'Save Camera',
  run: (doc, { levelId, name, mode, eye, target }, ctx) => {
    checkLevel(doc, levelId);
    if (mode !== 'orbit' && mode !== 'walk') throw new CommandError('Unknown camera mode.');
    const from = checkPoint(eye, 'Camera position');
    const to = checkPoint(target, 'Camera target');
    if (lookLength(from, to) < MIN_LOOK) throw new CommandError('The camera needs a direction to look.');
    const camera: SavedCamera = {
      id: ctx.newId(),
      kind: 'camera',
      levelId,
      name: uniqueName(doc, checkName(name)),
      mode,
      eye: from,
      target: to,
    };
    doc.elements[camera.id] = camera;
    return camera.id;
  },
});

export function camerasIn(doc: PlanDocument): SavedCamera[] {
  return Object.values(doc.elements)
    .filter((el): el is SavedCamera => el.kind === 'camera')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const cameraCommands = {
  'camera.save': saveCamera,
};
export type CameraCommands = typeof cameraCommands;
