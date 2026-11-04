import type { Draft } from 'immer';
import { isPlanLayer } from '../model/layers';
import type { LayerSet, PlanDocument, PlanLayerId } from '../model/schema';
import { CommandError, defineCommand, type CommandContext } from './history';

const MAX_SETS = 12;

function materialize(doc: Draft<PlanDocument>, ctx: CommandContext): Draft<LayerSet> {
  if (!doc.layerSets || doc.layerSets.length === 0) {
    const created: LayerSet = { id: ctx.newId(), name: 'Plan', hidden: [] };
    doc.layerSets = [created];
    doc.activeLayerSet = created.id;
  }
  const active = doc.layerSets.find((set) => set.id === doc.activeLayerSet) ?? doc.layerSets[0];
  if (!active) throw new CommandError('This plan has no layer set.');
  doc.activeLayerSet = active.id;
  return active;
}

export const toggleLayer = defineCommand<{ layer: string }>({
  label: () => 'Layer',
  run: (doc, { layer }, ctx) => {
    if (!isPlanLayer(layer)) throw new CommandError('Unknown layer.');
    const active = materialize(doc, ctx);
    active.hidden = active.hidden.includes(layer) ? active.hidden.filter((item) => item !== layer) : [...active.hidden, layer];
  },
});

export const useLayerSet = defineCommand<{ id: string }>({
  label: () => 'Layer Set',
  run: (doc, { id }) => {
    if (!doc.layerSets?.some((set) => set.id === id)) throw new CommandError('That layer set is not in this plan.');
    doc.activeLayerSet = id;
  },
});

export const createLayerSet = defineCommand<Record<string, never>>({
  label: () => 'New Layer Set',
  run: (doc, _payload, ctx) => {
    const current = materialize(doc, ctx);
    if (!doc.layerSets || doc.layerSets.length >= MAX_SETS) throw new CommandError('A plan can have at most 12 layer sets.');
    const hidden: PlanLayerId[] = [...current.hidden];
    const created: LayerSet = { id: ctx.newId(), name: `Set ${doc.layerSets.length + 1}`, hidden };
    doc.layerSets.push(created);
    doc.activeLayerSet = created.id;
  },
});

export const layerCommands = {
  'layerSet.toggle': toggleLayer,
  'layerSet.use': useLayerSet,
  'layerSet.create': createLayerSet,
};
