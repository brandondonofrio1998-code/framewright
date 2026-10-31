import { checkInvariants, repairInvariants } from '../model/invariants';
import { CURRENT_SCHEMA_VERSION, DocumentSchema, PLAN_FORMAT_ID, type PlanDocument } from '../model/schema';

/** Upgrades a raw document from version `n` to `n + 1`. Must be pure and handle any valid version-n file. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version a migration upgrades *from*. Add one entry per schema bump, with a frozen fixture test. */
export const MIGRATIONS: ReadonlyMap<number, Migration> = new Map();

export type LoadErrorCode = 'not-json' | 'not-framewright' | 'too-new' | 'unsupported-version' | 'invalid';

export type LoadResult =
  | { ok: true; doc: PlanDocument; repairs: string[]; migratedFrom: number | null }
  | { ok: false; code: LoadErrorCode; error: string };

const ROUND = 1e6;

export function serializeDocument(doc: PlanDocument): string {
  const problems = checkInvariants(doc);
  if (problems.length > 0) throw new Error(`Refusing to save an invalid document: ${problems.join('; ')}`);
  const json = JSON.stringify(
    doc,
    (_key, value: unknown) => {
      if (typeof value !== 'number') return value;
      const rounded = Math.round(value * ROUND) / ROUND;
      return Object.is(rounded, -0) ? 0 : rounded;
    },
    2,
  );
  return `${json}\n`;
}

export function migrate(
  raw: Record<string, unknown>,
  from: number,
  migrations: ReadonlyMap<number, Migration>,
  target: number,
): Record<string, unknown> {
  let doc = raw;
  for (let v = from; v < target; v++) {
    const step = migrations.get(v);
    if (!step) throw new Error(`No migration from schema version ${v}`);
    doc = { ...step(doc), schemaVersion: v + 1 };
  }
  return doc;
}

export function loadDocument(text: string, migrations: ReadonlyMap<number, Migration> = MIGRATIONS): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: 'not-json', error: 'This is not a Framewright plan file (it is not readable as JSON).' };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== PLAN_FORMAT_ID) {
    return { ok: false, code: 'not-framewright', error: 'This is not a Framewright plan file.' };
  }
  const record = raw as Record<string, unknown>;
  const version = record.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, code: 'invalid', error: 'The file has no valid schema version.' };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'too-new',
      error: `This plan was saved by a newer version of Framewright (file format ${version}; this app supports up to ${CURRENT_SCHEMA_VERSION}). Update Framewright to open it.`,
    };
  }

  let migrated: Record<string, unknown>;
  try {
    migrated = migrate(record, version, migrations, CURRENT_SCHEMA_VERSION);
  } catch (error) {
    return { ok: false, code: 'unsupported-version', error: (error as Error).message };
  }

  const parsed = DocumentSchema.safeParse(migrated);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    return { ok: false, code: 'invalid', error: `The plan file is damaged or incomplete:\n${details}` };
  }

  const { doc, repairs } = repairInvariants(parsed.data);
  return { ok: true, doc, repairs, migratedFrom: version === CURRENT_SCHEMA_VERSION ? null : version };
}
