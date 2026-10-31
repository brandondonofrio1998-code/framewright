import type { Id, PlanDocument, SnapResult, SnapSceneOptions, Vec2, WallGeometry } from '@framewright/core';
import type { ToolId } from '../../../shared/ipc';
import type { Viewport } from '../plan/viewport';

export interface PlanPointer {
  /** Raw cursor position in model inches. */
  model: Vec2;
  /** Cursor position in CSS pixels within the canvas. */
  screen: Vec2;
  button: number;
  shift: boolean;
}

export interface SnapRequest extends SnapSceneOptions {
  anchor?: Vec2;
}

export interface ToolContext {
  doc(): PlanDocument;
  levelId(): Id;
  /** Wall geometry of the committed document on the active level. */
  geometry(): Map<Id, WallGeometry>;
  view: Viewport;
  snap(cursor: Vec2, request?: SnapRequest): SnapResult;
  selection(): Id[];
  setSelection(ids: Id[]): void;
  setTool(id: ToolId): void;
  /** Shows a rejected action's reason in the status bar. */
  notify(message: string | null): void;
  redraw(): void;
}

export interface TempDimension {
  a: Vec2;
  b: Vec2;
  offset: number;
  label: string;
}

export interface Overlay {
  lines?: { a: Vec2; b: Vec2; style: 'rubber' | 'guide' }[];
  dimensions?: TempDimension[];
  handles?: Vec2[];
  snap?: SnapResult | null;
  box?: [Vec2, Vec2] | null;
}

export interface LengthEntryHandler {
  /** Where the entry box should appear (model inches). */
  position(): Vec2 | null;
  /** Returns an error message, or null when the value was applied. */
  commit(length: string, angle: string): string | null;
}

export interface Tool {
  readonly id: ToolId;
  readonly cursor: string;
  down?(e: PlanPointer, ctx: ToolContext): void;
  move?(e: PlanPointer, ctx: ToolContext): void;
  up?(e: PlanPointer, ctx: ToolContext): void;
  doubleClick?(e: PlanPointer, ctx: ToolContext): void;
  /** Returns true when the key was handled. */
  key?(e: KeyboardEvent, ctx: ToolContext): boolean;
  /** Abandons anything in progress without changing the document. */
  cancel(ctx: ToolContext): void;
  /** A modified copy of the document to draw instead of the real one (drags, rubber-band walls). */
  preview?(doc: PlanDocument, ctx: ToolContext): PlanDocument | null;
  overlay?(ctx: ToolContext): Overlay;
  /** Present while the tool accepts a typed length (e.g. while drawing a wall). */
  lengthEntry?(ctx: ToolContext): LengthEntryHandler | null;
}