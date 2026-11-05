import { roadPolygon, type Vec2 } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, Tool } from './types';

/** Click the start of a driveway, then the end. It is 12 feet wide. */
export function createRoadTool(): Tool {
  let start: Vec2 | null = null;
  let hover: Vec2 | null = null;

  return {
    id: 'road',
    cursor: 'crosshair',
    move(e, ctx) {
      hover = e.model;
      ctx.notify(start ? 'Click the end of the driveway.' : 'Click the start of the driveway.');
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const p = ctx.snap(e.model).p;
      if (!start) {
        start = p;
        ctx.notify('Click the end of the driveway.');
      } else {
        const result = dispatch('road.create', { levelId: ctx.levelId(), a: start, b: p });
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
      if (!start || !hover) return {};
      const [a, b, c, d] = roadPolygon({ a: start, b: hover, width: 144 });
      if (!a || !b || !c || !d) return {};
      return {
        lines: [
          { a, b, style: 'rubber' },
          { a: b, b: c, style: 'rubber' },
          { a: c, b: d, style: 'rubber' },
          { a: d, b: a, style: 'rubber' },
        ],
      };
    },
  };
}
