import { distance, type Vec2 } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, Tool, ToolContext } from './types';

const CLOSE = 18;

/** Click the property corners, then click the first corner again. Shift-click places a north arrow. */
export function createSiteTool(): Tool {
  let corners: Vec2[] = [];
  let hover: Vec2 | null = null;

  const close = (ctx: ToolContext) => {
    const result = dispatch('site.lot', { levelId: ctx.levelId(), points: corners });
    ctx.notify(result.ok ? null : result.error);
    if (result.ok) corners = [];
  };

  return {
    id: 'site',
    cursor: 'crosshair',
    move(e, ctx) {
      hover = e.model;
      ctx.notify(corners.length === 0 ? 'Click the property corners. Shift-click places north.' : 'Click the first corner again to close the lot.');
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const p = ctx.snap(e.model).p;
      if (e.shift) {
        const result = dispatch('site.north', { levelId: ctx.levelId(), p });
        ctx.notify(result.ok ? null : result.error);
        ctx.redraw();
        return;
      }
      if (corners.length >= 3 && distance(p, corners[0]!) <= CLOSE) close(ctx);
      else corners = [...corners, p];
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key === 'Enter' && corners.length >= 3) {
        close(ctx);
        ctx.redraw();
        return true;
      }
      if (e.key !== 'Escape') return false;
      if (corners.length > 0) corners = [];
      else ctx.setTool('select');
      ctx.notify(null);
      ctx.redraw();
      return true;
    },
    cancel() {
      corners = [];
      hover = null;
    },
    overlay(): Overlay {
      const lines: NonNullable<Overlay['lines']> = [];
      for (let i = 1; i < corners.length; i++) lines.push({ a: corners[i - 1]!, b: corners[i]!, style: 'rubber' });
      const last = corners[corners.length - 1];
      if (last && hover) lines.push({ a: last, b: hover, style: 'rubber' });
      return { lines };
    },
  };
}
