import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { IdGenerator } from '../model/defaults';
import { checkInvariants } from '../model/invariants';
import type { PlanDocument } from '../model/schema';

enablePatches();

export interface CommandContext {
  newId: IdGenerator;
}

/** Thrown by a command when its payload is not valid for the current document. The document is left unchanged. */
export class CommandError extends Error {}

export interface CommandDef<P, R = void> {
  label: (payload: P) => string;
  run: (draft: Draft<PlanDocument>, payload: P, ctx: CommandContext) => R;
  /** Consecutive commands with the same key (within the merge window) become one undo step. */
  mergeKey?: (payload: P) => string | undefined;
}

export function defineCommand<P, R = void>(def: CommandDef<P, R>): CommandDef<P, R> {
  return def;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommandRegistry = Record<string, CommandDef<any, any>>;
export type PayloadOf<C> = C extends CommandDef<infer P, unknown> ? P : never;
export type ResultOf<C> = C extends CommandDef<never, infer R> ? R : never;

export type DispatchResult<R = unknown> = { ok: true; changed: boolean; value: R } | { ok: false; error: string };

export interface HistoryChange {
  doc: PlanDocument;
  patches: readonly Patch[];
  source: 'command' | 'undo' | 'redo' | 'reset';
}

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  mergeKey: string | undefined;
  at: number;
}

export interface HistoryOptions {
  mergeWindowMs?: number;
  now?: () => number;
  maxEntries?: number;
}

export class History<R extends CommandRegistry> {
  private current: PlanDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** Undo depth at which the document matches the saved file; null once that state is unreachable. */
  private savedDepth: number | null = 0;
  private readonly listeners = new Set<(change: HistoryChange) => void>();
  private readonly mergeWindowMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(
    doc: PlanDocument,
    private readonly registry: R,
    private readonly ctx: CommandContext,
    options: HistoryOptions = {},
  ) {
    this.current = doc;
    this.mergeWindowMs = options.mergeWindowMs ?? 1000;
    this.now = options.now ?? (() => Date.now());
    this.maxEntries = options.maxEntries ?? 500;
  }

  get doc(): PlanDocument {
    return this.current;
  }
  get dirty(): boolean {
    return this.savedDepth !== this.undoStack.length;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  subscribe(listener: (change: HistoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch<K extends keyof R & string>(type: K, payload: PayloadOf<R[K]>): DispatchResult<ResultOf<R[K]>> {
    const def = this.registry[type];
    if (!def) return { ok: false, error: `Unknown command ${type}` };
    return this.execute(def.label(payload), def.mergeKey?.(payload), (draft) => def.run(draft, payload, this.ctx));
  }

  /** Runs several commands as one undo step. Stops at the first failure and leaves the document unchanged. */
  transaction(label: string, steps: { [K in keyof R & string]: { type: K; payload: PayloadOf<R[K]> } }[keyof R & string][]): DispatchResult<unknown[]> {
    return this.execute(label, undefined, (draft) =>
      steps.map((step) => {
        const def = this.registry[step.type];
        if (!def) throw new CommandError(`Unknown command ${step.type}`);
        return def.run(draft, step.payload, this.ctx);
      }),
    );
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.current = applyPatches(this.current, entry.inverse);
    this.redoStack.push(entry);
    this.emit(entry.inverse, 'undo');
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.current = applyPatches(this.current, entry.patches);
    this.undoStack.push(entry);
    this.emit(entry.patches, 'redo');
    return true;
  }

  /**
   * Marks the current state as saved. Pass the document that was written: if it changed
   * while the save was in flight, the plan correctly stays dirty.
   */
  markSaved(written: PlanDocument = this.current): void {
    if (written === this.current) this.savedDepth = this.undoStack.length;
  }

  /** Replaces the document (new/open/recover) and clears history. */
  reset(doc: PlanDocument, { dirty = false }: { dirty?: boolean } = {}): void {
    this.current = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.savedDepth = dirty ? null : 0;
    this.emit([], 'reset');
  }

  private execute<T>(label: string, mergeKey: string | undefined, recipe: (draft: Draft<PlanDocument>) => T): DispatchResult<T> {
    let value!: T;
    let next: PlanDocument;
    let patches: Patch[];
    let inverse: Patch[];
    try {
      [next, patches, inverse] = produceWithPatches(this.current, (draft) => {
        value = recipe(draft);
      });
    } catch (error) {
      if (error instanceof CommandError) return { ok: false, error: error.message };
      throw error;
    }
    if (patches.length === 0) return { ok: true, changed: false, value };

    const problems = checkInvariants(next);
    if (problems.length > 0) return { ok: false, error: `"${label}" would leave the plan invalid: ${problems.join('; ')}` };

    this.current = next;
    this.record(label, mergeKey, patches, inverse);
    this.emit(patches, 'command');
    return { ok: true, changed: true, value };
  }

  private record(label: string, mergeKey: string | undefined, patches: Patch[], inverse: Patch[]): void {
    const at = this.now();
    const depth = this.undoStack.length;
    const top = this.undoStack.at(-1);
    this.redoStack = [];

    const canMerge =
      mergeKey !== undefined && top?.mergeKey === mergeKey && at - top.at <= this.mergeWindowMs && this.savedDepth !== depth;
    if (canMerge && top) {
      top.patches = [...top.patches, ...patches];
      top.inverse = [...inverse, ...top.inverse];
      top.at = at;
      return;
    }

    if (this.savedDepth !== null && this.savedDepth > depth) this.savedDepth = null;
    this.undoStack.push({ label, patches, inverse, mergeKey, at });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
      if (this.savedDepth !== null) this.savedDepth = this.savedDepth === 0 ? null : this.savedDepth - 1;
    }
  }

  private emit(patches: readonly Patch[], source: HistoryChange['source']): void {
    const change: HistoryChange = { doc: this.current, patches, source };
    for (const listener of this.listeners) listener(change);
  }
}
