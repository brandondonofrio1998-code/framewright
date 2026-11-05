import { nearestWall } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Tool } from './types';

/** Click a wall for a supply. Shift-click a wall for a drain. Click off a wall for a floor drain. */
export function createPlumbingTool(): Tool {
  return {
    id: 'plumbing',
    cursor: 'crosshair',
    move(e, ctx) {
      const hit = nearestWall(ctx.geometry(), e.model, 18);
      ctx.notify(hit ? (e.shift ? 'Shift-click places a drain.' : 'Click places a supply. Shift-click places a drain.') : 'Click places a floor drain.');
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const hit = nearestWall(ctx.geometry(), e.model, 18);
      if (!hit) {
        const result = dispatch('plumbing.create', { levelId: ctx.levelId(), fixture: 'drain', p: e.model });
        ctx.notify(result.ok ? null : result.error);
        return;
      }
      const result = dispatch('plumbing.create', {
        levelId: ctx.levelId(),
        fixture: e.shift ? 'drain' : 'supply',
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
