import { dispatch } from '../document/store';
import type { Tool } from './types';

/** Click to plant a tree. The canopy is 16 feet across and the tree is 20 feet tall. */
export function createPlantTool(): Tool {
  return {
    id: 'plant',
    cursor: 'crosshair',
    move(_e, ctx) {
      ctx.notify('Click to plant a tree.');
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const result = dispatch('plant.create', { levelId: ctx.levelId(), p: ctx.snap(e.model).p });
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
