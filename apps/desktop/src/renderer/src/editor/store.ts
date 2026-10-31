import { create } from 'zustand';
import type { Id, SnapKind, SnapSettings, Vec2 } from '@framewright/core';
import type { ToolId } from '../../../shared/ipc';
import { history, useDocument } from '../document/store';

export interface EditorState {
  tool: ToolId;
  /** Wall type used by the Walls tool; null means the plan's first wall type. */
  wallTypeId: Id | null;
  selection: Id[];
  snaps: SnapSettings;
  /** Cursor position in model inches, while over the plan. */
  cursor: Vec2 | null;
  snapKind: SnapKind | null;
  /** Short message from the last rejected action, shown in the status bar. */
  notice: string | null;
}

export const useEditor = create<EditorState>(() => ({
  tool: 'select',
  wallTypeId: null,
  selection: [],
  snaps: { objects: true, angles: true, grid: true },
  cursor: null,
  snapKind: null,
  notice: null,
}));

export const TOOL_LABELS: Record<ToolId, string> = {
  select: 'Select Objects',
  walls: 'Walls',
  break: 'Break Wall',
  dimensions: 'Dimensions',
};

export function setTool(tool: ToolId): void {
  useEditor.setState({ tool, notice: null });
}

export function setSelection(selection: Id[]): void {
  useEditor.setState({ selection });
}

export function notify(notice: string | null): void {
  useEditor.setState({ notice });
}

export function activeWallTypeId(): Id | null {
  const { wallTypeId } = useEditor.getState();
  const types = history.doc.wallTypes;
  if (wallTypeId && types[wallTypeId]) return wallTypeId;
  return Object.keys(types)[0] ?? null;
}

/** Drop selected ids that no longer exist on the active level (after undo, delete, level change). */
function pruneSelection(): void {
  const { selection } = useEditor.getState();
  const { doc, activeLevelId } = useDocument.getState();
  const kept = selection.filter((id) => doc.elements[id]?.levelId === activeLevelId);
  if (kept.length !== selection.length) useEditor.setState({ selection: kept });
}

useDocument.subscribe(pruneSelection);
