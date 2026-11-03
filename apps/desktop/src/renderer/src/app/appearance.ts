import { create } from 'zustand';
import type { DrawLayer, PlanDocument } from '@framewright/core';
import { setCanvasDark } from '../plan/render';

export const PLAN_LAYERS: { id: DrawLayer; label: string }[] = [
  { id: 'walls', label: 'Walls' },
  { id: 'openings', label: 'Openings' },
  { id: 'objects', label: 'Objects' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'dimensions', label: 'Dimensions' },
  { id: 'text', label: 'Text' },
  { id: 'roof', label: 'Roof' },
  { id: 'foundation', label: 'Foundation' },
  { id: 'stairs', label: 'Stairs' },
  { id: 'reference', label: 'Reference' },
];

const THEME_KEY = 'fw-theme';
const LAYERS_KEY = 'fw-hidden-layers';

function readDark(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark';
  } catch {
    return false;
  }
}

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function persist(dark: boolean, hidden: readonly string[]): void {
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    localStorage.setItem(LAYERS_KEY, JSON.stringify(hidden));
  } catch {
    // Private mode can refuse storage. The choice still applies for this session.
  }
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.hidden = hidden.join(' ');
  setCanvasDark(dark);
}

interface Appearance {
  dark: boolean;
  hidden: string[];
  toggleDark(): void;
  toggleLayer(layer: string): void;
}

export const useAppearance = create<Appearance>((set, get) => ({
  dark: readDark(),
  hidden: readHidden(),
  toggleDark() {
    const dark = !get().dark;
    persist(dark, get().hidden);
    set({ dark });
  },
  toggleLayer(layer) {
    const hidden = get().hidden.includes(layer) ? get().hidden.filter((item) => item !== layer) : [...get().hidden, layer];
    persist(get().dark, hidden);
    set({ hidden });
  },
}));

persist(useAppearance.getState().dark, useAppearance.getState().hidden);

export function layerForKind(kind: string): DrawLayer | null {
  switch (kind) {
    case 'wall':
      return 'walls';
    case 'door':
    case 'window':
      return 'openings';
    case 'object':
      return 'objects';
    case 'room':
      return 'rooms';
    case 'dimension':
      return 'dimensions';
    case 'text':
      return 'text';
    case 'roofPlane':
      return 'roof';
    case 'foundation':
      return 'foundation';
    case 'stair':
      return 'stairs';
    case 'cad':
      return 'reference';
    default:
      return null;
  }
}

export function layerVisible(doc: PlanDocument, id: string): boolean {
  const kind = doc.elements[id]?.kind;
  const layer = kind ? layerForKind(kind) : null;
  return !layer || !useAppearance.getState().hidden.includes(layer);
}
