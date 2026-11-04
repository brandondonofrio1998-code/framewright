import { CommandError, deckOpenEdges, deckPolygon, nearestWall, normalize, placeDeck, sub, type Vec2 } from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, Tool } from './types';

/** Click the outside of a wall, then the outer corner of the deck. */
export function createDeckTool(): Tool {
  let origin: { p: Vec2; dir: Vec2; side: 1 | -1 } | null = null;
  let hover: Vec2 | null = null;

  return {
    id: 'deck',
    cursor: 'crosshair',
    move(e, ctx) {
      hover = e.model;
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const p = ctx.snap(e.model).p;
      if (!origin) {
        const hit = nearestWall(ctx.geometry(), p, 24);
        const geom = hit ? ctx.geometry().get(hit.wallId) : undefined;
        if (!hit || !geom) {
          ctx.notify('Click the outside of a wall.');
          return;
        }
        const dir = normalize(sub(geom.b, geom.a));
        const side: 1 | -1 = hit.left ? 1 : -1;
        const outward = { x: -dir.y * side, y: dir.x * side };
        const face = {
          x: geom.a.x + dir.x * hit.t + outward.x * (geom.thickness / 2),
          y: geom.a.y + dir.y * hit.t + outward.y * (geom.thickness / 2),
        };
        origin = { p: face, dir, side };
        ctx.notify('Click the outer corner.');
      } else {
        try {
          const shape = placeDeck(origin.p, origin.dir, origin.side, p);
          const result = dispatch('deck.create', { levelId: ctx.levelId(), ...shape });
          ctx.notify(result.ok ? null : result.error);
          if (result.ok) origin = null;
        } catch (error) {
          ctx.notify(error instanceof CommandError ? error.message : 'That deck does not fit.');
        }
      }
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      if (origin) origin = null;
      else ctx.setTool('select');
      ctx.notify(null);
      ctx.redraw();
      return true;
    },
    cancel() {
      origin = null;
      hover = null;
    },
    overlay(): Overlay {
      if (!origin || !hover) return {};
      try {
        const shape = placeDeck(origin.p, origin.dir, origin.side, hover);
        const [a, b, c, d] = deckPolygon(shape);
        const lines: NonNullable<Overlay['lines']> = [
          { a: a!, b: b!, style: 'rubber' },
          { a: b!, b: c!, style: 'rubber' },
          { a: c!, b: d!, style: 'rubber' },
          { a: d!, b: a!, style: 'rubber' },
        ];
        for (const [p, q] of deckOpenEdges(shape)) lines.push({ a: p, b: q, style: 'guide' });
        return { lines };
      } catch {
        return {};
      }
    },
  };
}
