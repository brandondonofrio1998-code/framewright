import { add, distance, normalize, perp, scale, sub, type Vec2 } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, Tool } from './types';

/** Click the bottom of the flight, then the top. The run is the distance between the clicks. */
export function createStairTool(): Tool {
  let start: Vec2 | null = null;
  let hover: Vec2 | null = null;

  return {
    id: 'stairs',
    cursor: 'crosshair',
    move(e, ctx) {
      hover = e.model;
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const p = ctx.snap(e.model).p;
      if (!start) start = p;
      else {
        const result = dispatch('stair.create', { levelId: ctx.levelId(), start, end: p });
        ctx.notify(result.ok ? null : result.error);
        if (result.ok) start = null;
      }
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      if (start) start = null;
      else ctx.setTool('select');
      ctx.redraw();
      return true;
    },
    cancel() {
      start = null;
      hover = null;
    },
    overlay(): Overlay {
      if (!start || !hover || distance(start, hover) < 1) return {};
      const dir = normalize(sub(hover, start));
      const side = scale(perp(dir), 18);
      const a = sub(start, side);
      const b = add(start, side);
      const c = add(hover, side);
      const d = sub(hover, side);
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
