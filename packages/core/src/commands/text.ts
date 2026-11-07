import type { Id, Vec2 } from '../model/schema';
import { CommandError, defineCommand } from './history';

export const TEXT_SIZE = 8;

function noteBody(text: string): string {
  const body = text.trim();
  if (body.length < 1 || body.length > 250) throw new CommandError('Text must be from 1 to 250 characters.');
  return body;
}

function noteSize(size: number): number {
  if (!(size >= 1) || size > 120) throw new CommandError('Text height must be from 1 inch to 10 feet.');
  return size;
}

export const createText = defineCommand<{ levelId: Id; p: Vec2; text: string; size?: number }, Id>({
  label: () => 'Add Text',
  run: (doc, { levelId, p, text, size }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const id = ctx.newId();
    doc.elements[id] = { id, kind: 'text', levelId, p, text: noteBody(text), size: noteSize(size ?? TEXT_SIZE) };
    return id;
  },
});

export const updateText = defineCommand<{ id: Id; text?: string; size?: number; p?: Vec2; rot?: number }, Id>({
  label: () => 'Edit Text',
  run: (doc, { id, text, size, p, rot }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'text') throw new CommandError('That text is gone.');
    if (text !== undefined) el.text = noteBody(text);
    if (size !== undefined) el.size = noteSize(size);
    if (rot !== undefined) {
      if (!Number.isFinite(rot) || rot < -Math.PI || rot > Math.PI) throw new CommandError('Turn the note by at most half a circle.');
      if (Math.abs(rot) < 1e-6) delete el.rot;
      else el.rot = rot;
    }
    if (p !== undefined) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.hypot(p.x, p.y) > 100_000) throw new CommandError('That point is too far away.');
      el.p = p;
    }
    return id;
  },
});

export const textCommands = {
  'text.create': createText,
  'text.update': updateText,
};
export type TextCommands = typeof textCommands;
