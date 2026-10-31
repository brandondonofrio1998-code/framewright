import {
  distance,
  dot,
  formatLength,
  normalize,
  perp,
  POINT_EPS,
  sub,
  type DimensionEnd,
  type SnapResult,
  type Vec2,
} from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, Tool, ToolContext } from './types';

const endFrom = (snap: SnapResult): DimensionEnd =>
  snap.kind === 'node' && snap.id !== undefined ? { p: snap.p, nodeId: snap.id } : { p: snap.p };

/** Click the first point, the second point, then where the dimension line goes. Ends on wall corners follow the walls. */
export function createDimensionTool(): Tool {
  let first: DimensionEnd | null = null;
  let second: DimensionEnd | null = null;
  let hover: SnapResult | null = null;
  let cursor: Vec2 | null = null;

  const offsetFor = (a: Vec2, b: Vec2, p: Vec2) => dot(sub(p, a), perp(normalize(sub(b, a))));
  const snapAt = (p: Vec2, ctx: ToolContext) => ctx.snap(p, { faces: true, ...(first && !second && { anchor: first.p }) });

  return {
    id: 'dimensions',
    cursor: 'crosshair',
    move(e, ctx) {
      cursor = e.model;
      hover = second ? null : snapAt(e.model, ctx);
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      if (!first) {
        first = endFrom(snapAt(e.model, ctx));
      } else if (!second) {
        const end = endFrom(snapAt(e.model, ctx));
        if (distance(end.p, first.p) > POINT_EPS) second = end;
      } else {
        const result = dispatch('dimension.create', {
          levelId: ctx.levelId(),
          a: first,
          b: second,
          offset: offsetFor(first.p, second.p, e.model),
        });
        ctx.notify(result.ok ? null : result.error);
        first = null;
        second = null;
      }
      hover = second ? null : snapAt(e.model, ctx);
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key !== 'Escape') return false;
      if (first) {
        first = null;
        second = null;
      } else ctx.setTool('select');
      ctx.redraw();
      return true;
    },
    cancel() {
      first = null;
      second = null;
      hover = null;
    },
    overlay(ctx): Overlay {
      const overlay: Overlay = { snap: hover };
      const format = ctx.doc().settings.lengthFormat;
      const a = first?.p;
      const b = second?.p ?? hover?.p;
      if (a && b && distance(a, b) > POINT_EPS) {
        const offset = second && cursor ? offsetFor(a, b, cursor) : 0;
        overlay.dimensions = [{ a, b, offset, label: formatLength(distance(a, b), format) }];
      }
      if (hover && !second) overlay.lines = hover.guides.map(([p, q]) => ({ a: p, b: q, style: 'guide' as const }));
      return overlay;
    },
  };
}
