import { add, distance, normalize, perp, scale, sub, type Vec2 } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, Tool } from './types';

/** Click the bottom, then the top. Shift-click the second point to turn; the next click is the top of an L stair. */
export function createStairTool(): Tool {
  let start: Vec2 | null = null;
  let corner: Vec2 | null = null;
  let hover: Vec2 | null = null;

  const rubber = (a: Vec2, b: Vec2) => {
    const dir = normalize(sub(b, a));
    const side = scale(perp(dir), 18);
    return [sub(a, side), add(a, side), add(b, side), sub(b, side)];
  };

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
      if (!start) {
        start = p;
        ctx.notify('Click the top. Shift-click to turn the stair.');
      } else if (!corner && e.shift) {
        corner = p;
        ctx.notify('Click the top of the second flight. Turn 90 degrees for an L, or back for a U.');
      } else {
        const result = dispatch('stair.create', { levelId: ctx.levelId(), start, end: p, ...(corner ? { corner } : {}) });
        ctx.notify(result.ok ? null : result.error);
        if (result.ok) {
          start = null;
          corner = null;
        }
      }
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      if (corner) corner = null;
      else if (start) start = null;
      else ctx.setTool('select');
      ctx.notify(null);
      ctx.redraw();
      return true;
    },
    cancel() {
      start = null;
      corner = null;
      hover = null;
    },
    overlay(): Overlay {
      if (!start || !hover) return {};
      const lines: Overlay['lines'] = [];
      const band = (a: Vec2, b: Vec2) => {
        if (distance(a, b) < 1) return;
        const [p, q, r, s] = rubber(a, b);
        lines.push({ a: p!, b: q!, style: 'rubber' }, { a: q!, b: r!, style: 'rubber' }, { a: r!, b: s!, style: 'rubber' }, { a: s!, b: p!, style: 'rubber' });
      };
      if (!corner) band(start, hover);
      else {
        band(start, corner);
        band(corner, hover);
      }
      return { lines };
    },
  };
}
