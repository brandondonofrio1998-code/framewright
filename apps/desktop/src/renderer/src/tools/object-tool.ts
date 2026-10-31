import { produce } from 'immer';
import { planCommands, starterById, type PlanDocument } from '@framewright/core';
import { dispatch } from '../document/store';
import { useEditor } from '../editor/store';
import { objectSpotAt, type ObjectSpot } from './object-placement';
import type { Tool } from './types';

/** Pick an item in the Library, then click a wall. The side you click is the side the object sits on. */
export function createObjectTool(): Tool {
  let spot: ObjectSpot | null = null;

  const armed = () => {
    const id = useEditor.getState().armedCatalogId;
    return id ? starterById(id) : undefined;
  };

  return {
    id: 'objects',
    cursor: 'crosshair',
    move(e, ctx) {
      const def = armed();
      const width = def && typeof def.params.width === 'number' ? def.params.width : 24;
      spot = def?.hostsToWall ? objectSpotAt(ctx, e.model, width) : null;
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const def = armed();
      if (!def) {
        ctx.notify('Pick an item in the Library first.');
        return;
      }
      const width = typeof def.params.width === 'number' ? def.params.width : 24;
      spot = def.hostsToWall ? objectSpotAt(ctx, e.model, width) : null;
      if (!spot) {
        ctx.notify('Click on a wall to place it.');
        return;
      }
      const result = dispatch('object.place', { levelId: ctx.levelId(), def, hostWallId: spot.wallId, hostT: spot.t, side: spot.side });
      ctx.notify(result.ok ? null : result.error);
      if (result.ok) ctx.setSelection([result.value]);
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
    preview(doc: PlanDocument, ctx) {
      const def = armed();
      if (!def || !spot) return null;
      const current = spot;
      try {
        return produce(doc, (draft) => {
          planCommands['object.place'].run(draft, { levelId: ctx.levelId(), def, hostWallId: current.wallId, hostT: current.t, side: current.side }, { newId: () => 'preview-object' });
        });
      } catch {
        return null;
      }
    },
  };
}
