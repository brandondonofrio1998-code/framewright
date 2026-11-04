import { nearestWall } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Tool } from './types';

/** Click a wall for a receptacle. Shift-click for a switch. Click off a wall for a ceiling light. */
export function createElectricalTool(): Tool {
  return {
    id: 'electrical',
    cursor: 'crosshair',
    move(e, ctx) {
      const hit = nearestWall(ctx.geometry(), e.model, 18);
      ctx.notify(hit ? (e.shift ? 'Shift-click places a switch.' : 'Click places a receptacle. Shift-click places a switch.') : 'Click places a ceiling light.');
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const hit = nearestWall(ctx.geometry(), e.model, 18);
      if (!hit) {
        const result = dispatch('electrical.create', { levelId: ctx.levelId(), device: 'light', p: e.model });
        ctx.notify(result.ok ? null : result.error);
        return;
      }
      const result = dispatch('electrical.create', {
        levelId: ctx.levelId(),
        device: e.shift ? 'switch' : 'receptacle',
        p: e.model,
        hostWallId: hit.wallId,
        hostT: hit.t,
        side: hit.left ? 'left' : 'right',
      });
      ctx.notify(result.ok ? null : result.error);
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      ctx.setTool('select');
      ctx.notify(null);
      return true;
    },
    cancel() {
      return;
    },
  };
}
