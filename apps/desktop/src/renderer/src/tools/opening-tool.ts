import { produce } from 'immer';
import { planCommands, type PlaceOpening, type PlanDocument } from '@framewright/core';
import { dispatch } from '../document/store';
import { useEditor } from '../editor/store';
import { openingClearances, openingSpotAt, type OpeningSpot } from './opening-placement';
import type { Overlay, Tool, ToolContext } from './types';

/** What the tool would place at `spot`, using the editor's current defaults. */
function placement(kind: 'door' | 'window', spot: OpeningSpot): PlaceOpening {
  // Hinge follows the side so a door placed from either side opens toward the same end as seen from that side.
  const common = { wallId: spot.wallId, t: spot.t, side: spot.side, hinge: spot.side === 'left' ? ('start' as const) : ('end' as const) };
  const { doorDefaults, windowDefaults } = useEditor.getState();
  return kind === 'door' ? { kind, ...common, ...doorDefaults } : { kind, ...common, ...windowDefaults };
}

/** Hover a wall to preview, click to place. The cursor's side of the wall is the swing (door) or exterior (window) side. */
export function createOpeningTool(kind: 'door' | 'window'): Tool {
  let spot: OpeningSpot | null = null;
  const width = () => (kind === 'door' ? useEditor.getState().doorDefaults.width : useEditor.getState().windowDefaults.width);

  return {
    id: kind === 'door' ? 'doors' : 'windows',
    cursor: 'crosshair',
    move(e, ctx) {
      spot = openingSpotAt(ctx, e.model, width(), undefined, kind === 'window');
      ctx.notify(spot?.error ?? null);
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      spot = openingSpotAt(ctx, e.model, width(), undefined, kind === 'window');
      if (!spot) {
        ctx.notify(`Click on a wall to place a ${kind}.`);
        return;
      }
      if (spot.error) {
        ctx.notify(spot.error);
        return;
      }
      const result = dispatch('opening.place', placement(kind, spot));
      ctx.notify(result.ok ? null : result.error);
      spot = openingSpotAt(ctx, e.model, width(), undefined, kind === 'window');
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      ctx.setTool('select');
      return true;
    },
    cancel() {
      spot = null;
    },
    preview(doc: PlanDocument) {
      if (!spot || spot.error) return null;
      const current = spot;
      try {
        return produce(doc, (draft) => {
          planCommands['opening.place'].run(draft, placement(kind, current), { newId: () => 'preview-opening' });
        });
      } catch {
        return null;
      }
    },
    overlay(ctx: ToolContext): Overlay {
      if (!spot) return {};
      const geom = ctx.geometry().get(spot.wallId);
      return geom ? { dimensions: openingClearances(ctx, geom, spot, width()) } : {};
    },
  };
}
