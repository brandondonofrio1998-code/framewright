import { distance, type Vec2 } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, Tool } from './types';

/** Click the start, then the end. Shift-click the end for a drain. */
export function createPipeTool(): Tool {
  let start: Vec2 | null = null;
  let hover: Vec2 | null = null;

  return {
    id: 'pipe',
    cursor: 'crosshair',
    move(e, ctx) {
      hover = e.model;
      ctx.notify(start ? 'Click the end. Shift-click for a drain.' : 'Click the start of the pipe.');
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const p = ctx.snap(e.model).p;
      if (!start) {
        start = p;
        ctx.notify('Click the end. Shift-click for a drain.');
      } else {
        const result = dispatch('pipe.create', { levelId: ctx.levelId(), a: start, b: p, service: e.shift ? 'drain' : 'supply' });
        ctx.notify(result.ok ? null : result.error);
        if (result.ok) start = null;
      }
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      if (start) start = null;
      else ctx.setTool('select');
      ctx.notify(null);
      ctx.redraw();
      return true;
    },
    cancel() {
      start = null;
      hover = null;
    },
    overlay(): Overlay {
      if (!start || !hover || distance(start, hover) < 1) return {};
      return { lines: [{ a: start, b: hover, style: 'rubber' }] };
    },
  };
}
