import type { Draft } from 'immer';
import { newLevel } from '../model/defaults';
import { restackLevels } from '../model/levels';
import { LengthFormatSchema, type Id, type Level, type PlanDocument, type ProjectSettings } from '../model/schema';
import { CommandError, defineCommand } from './history';

const MAX_LENGTH = 100_000;

function requireLevel(doc: Draft<PlanDocument>, id: Id): Draft<Level> {
  const level = doc.levels[id];
  if (!level) throw new CommandError('That level no longer exists.');
  return level;
}

function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new CommandError('Name cannot be empty.');
  if (trimmed.length > 100) throw new CommandError('Name is too long (100 characters max).');
  return trimmed;
}

function checkLength(value: number, what: string, { allowZero = false, allowNegative = false } = {}): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_LENGTH) throw new CommandError(`${what} is out of range.`);
  if (!allowNegative && (allowZero ? value < 0 : value <= 0)) {
    throw new CommandError(`${what} must be ${allowZero ? 'zero or more' : 'greater than zero'}.`);
  }
  return value;
}

function uniqueLevelName(doc: Draft<PlanDocument>, base: string): string {
  const names = new Set(Object.values(doc.levels).map((l) => l.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

export const renameDocument = defineCommand<{ title: string }>({
  label: () => 'Rename Plan',
  mergeKey: () => 'document.rename',
  run: (doc, { title }) => {
    const trimmed = title.trim();
    if (trimmed.length > 200) throw new CommandError('Title is too long (200 characters max).');
    doc.meta.title = trimmed;
  },
});

export const updateSettings = defineCommand<Partial<ProjectSettings>>({
  label: (p) => (p.lengthFormat ? 'Change Units' : 'Change Settings'),
  run: (doc, changes) => {
    if (changes.lengthFormat !== undefined) {
      const parsed = LengthFormatSchema.safeParse(changes.lengthFormat);
      if (!parsed.success) throw new CommandError('Unsupported unit format.');
      doc.settings.lengthFormat = parsed.data;
    }
    if (changes.gridSpacing !== undefined) doc.settings.gridSpacing = checkLength(changes.gridSpacing, 'Grid spacing');
  },
});

export const createLevel = defineCommand<{ position: 'above' | 'below'; referenceId: Id; name?: string }, Id>({
  label: () => 'Add Level',
  run: (doc, { position, referenceId, name }, ctx) => {
    const reference = requireLevel(doc, referenceId);
    const index = doc.levelOrder.indexOf(referenceId);
    const level = newLevel(ctx.newId, '', 0);
    level.name = name === undefined ? uniqueLevelName(doc, position === 'above' ? `Level ${doc.levelOrder.length + 1}` : 'Lower Level') : checkName(name);

    if (position === 'above') {
      doc.levelOrder.splice(index + 1, 0, level.id);
    } else {
      // A new bottom level goes underneath without moving the existing stack.
      if (index === 0) level.elevation = reference.elevation - reference.floorDepth - level.ceilingHeight;
      doc.levelOrder.splice(index, 0, level.id);
    }
    doc.levels[level.id] = level;
    restackLevels(doc.levels, doc.levelOrder);
    return level.id;
  },
});

export type LevelChanges = Partial<Pick<Level, 'name' | 'elevation' | 'ceilingHeight' | 'floorDepth' | 'ceilingFinish'>>;

export const updateLevel = defineCommand<{ id: Id; changes: LevelChanges }>({
  label: () => 'Edit Level',
  mergeKey: ({ id, changes }) => `level.update:${id}:${Object.keys(changes).sort().join(',')}`,
  run: (doc, { id, changes }) => {
    const level = requireLevel(doc, id);
    if (changes.name !== undefined) level.name = checkName(changes.name);
    if (changes.ceilingHeight !== undefined) level.ceilingHeight = checkLength(changes.ceilingHeight, 'Ceiling height');
    if (changes.floorDepth !== undefined) level.floorDepth = checkLength(changes.floorDepth, 'Floor depth', { allowZero: true });
    if (changes.ceilingFinish !== undefined) {
      level.ceilingFinish = checkLength(changes.ceilingFinish, 'Ceiling finish', { allowZero: true });
    }
    if (changes.elevation !== undefined) {
      if (doc.levelOrder[0] !== id) throw new CommandError('Only the bottom level has its own elevation; upper levels stack on the one below.');
      level.elevation = checkLength(changes.elevation, 'Elevation', { allowNegative: true });
    }
    restackLevels(doc.levels, doc.levelOrder);
  },
});

export const deleteLevel = defineCommand<{ id: Id }>({
  label: () => 'Delete Level',
  run: (doc, { id }) => {
    requireLevel(doc, id);
    if (doc.levelOrder.length === 1) throw new CommandError('A plan needs at least one level.');
    for (const el of Object.values(doc.elements)) {
      if (el.levelId === id || (el.kind === 'stair' && el.toLevelId === id)) delete doc.elements[el.id];
    }
    delete doc.levels[id];
    doc.levelOrder.splice(doc.levelOrder.indexOf(id), 1);
    restackLevels(doc.levels, doc.levelOrder);
  },
});

export const documentCommands = {
  'document.rename': renameDocument,
  'settings.update': updateSettings,
  'level.create': createLevel,
  'level.update': updateLevel,
  'level.delete': deleteLevel,
};
export type DocumentCommands = typeof documentCommands;
