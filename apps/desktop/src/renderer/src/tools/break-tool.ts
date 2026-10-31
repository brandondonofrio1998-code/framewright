import { pickElement, type SnapResult } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Tool } from './types';

const PICK_TOLERANCE_PX = 6;

/** Click a wall to split it in two at the (snapped) point. */
export function createBreakTool(): Tool {
  let hover: SnapResult | null = null;
  return {
    id: 'break',
    cursor: 'crosshair',
    move(e, ctx) {
      hover = ctx.snap(e.model);
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const at = ctx.snap(e.model).p;
      const hit = pickElement(ctx.doc(), ctx.levelId(), ctx.geometry(), at, ctx.view.model(PICK_TOLERANCE_PX));
      if (hit?.kind !== 'wall') {
        ctx.notify('Click on a wall to break it.');
        return;
      }
      const result = dispatch('wall.split', { wallId: hit.id, at });
      ctx.notify(result.ok ? null : result.error);
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      ctx.setTool('select');
      return true;
    },
    cancel() {
      hover = null;
    },
    overlay: () => ({ snap: hover }),
  };
}
