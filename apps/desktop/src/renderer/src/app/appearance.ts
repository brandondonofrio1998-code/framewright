import { create } from 'zustand';
import { hiddenLayersOf, type DrawLayer, type PlanDocument } from '@framewright/core';
import { setCanvasDark } from '../plan/render';

const THEME_KEY = 'fw-theme';

function readDark(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark';
  } catch {
    return false;
  }
}

function persist(dark: boolean): void {
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  } catch {
    // Private mode can refuse storage. The choice still applies for this session.
  }
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  setCanvasDark(dark);
}

interface Appearance {
  dark: boolean;
  toggleDark(): void;
}

export const useAppearance = create<Appearance>((set, get) => ({
  dark: readDark(),
  toggleDark() {
    const dark = !get().dark;
    persist(dark);
    set({ dark });
  },
}));

persist(useAppearance.getState().dark);

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
  return !layer || !hiddenLayersOf(doc).includes(layer);
}
