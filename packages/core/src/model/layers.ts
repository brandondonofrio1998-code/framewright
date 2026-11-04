import type { PlanDocument, PlanLayerId } from './schema';
import { PLAN_LAYER_IDS } from './schema';

/** Layers hidden by the active set. A plan with no sets shows everything. */
export function hiddenLayersOf(doc: PlanDocument): readonly PlanLayerId[] {
  const sets = doc.layerSets;
  if (!sets || sets.length === 0) return [];
  const active = sets.find((set) => set.id === doc.activeLayerSet) ?? sets[0];
  return active?.hidden ?? [];
}

export function isPlanLayer(value: string): value is PlanLayerId {
  return (PLAN_LAYER_IDS as readonly string[]).includes(value);
}
