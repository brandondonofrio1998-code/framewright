import type { CadPrim, Id } from '../model/schema';
import { CadSchema } from '../model/schema';
import { CommandError, defineCommand } from './history';

export interface ImportCad {
  levelId: Id;
  name: string;
  prims: CadPrim[];
}

export const importCad = defineCommand<ImportCad, Id>({
  label: () => 'Import DXF',
  run: (doc, { levelId, name, prims }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const id = ctx.newId();
    const parsed = CadSchema.safeParse({ id, kind: 'cad', levelId, name: name.slice(0, 100), prims });
    if (!parsed.success) throw new CommandError(prims.length === 0 ? 'The DXF has no lines to import.' : 'The DXF could not be imported.');
    doc.elements[id] = parsed.data;
    return id;
  },
});

export const cadCommands = {
  'cad.import': importCad,
};
