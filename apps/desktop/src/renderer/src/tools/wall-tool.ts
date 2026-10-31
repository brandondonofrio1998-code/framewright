import { produce } from 'immer';
import {
  add,
  angleOf,
  distance,
  formatLength,
  fromAngle,
  parseLength,
  planCommands,
  POINT_EPS,
  sub,
  type PlanDocument,
  type SnapResult,
  type Vec2,
} from '@framewright/core';
import { dispatch } from '../document/store';
import { activeWallTypeId } from '../editor/store';
import { parseContextFor } from '../ui/LengthInput';
import type { Overlay, Tool, ToolContext } from './types';

const DEG = Math.PI / 180;

/** Click to place points; each segment becomes a wall at once (so joins and undo work per wall). */
export function createWallTool(): Tool {
  let anchor: Vec2 | null = null;
  let hover: SnapResult | null = null;

  const direction = (): number => {
    if (!anchor || !hover) return 0;
    if (hover.angle !== undefined) return hover.angle;
    return distance(anchor, hover.p) > POINT_EPS ? angleOf(sub(hover.p, anchor)) : 0;
  };

  /** Draws anchor → p. Returns false when the command was rejected. */
  const place = (p: Vec2, ctx: ToolContext, endOnNode: boolean): boolean => {
    if (!anchor) {
      anchor = p;
      return true;
    }
    if (distance(anchor, p) <= POINT_EPS) return true;
    const typeId = activeWallTypeId();
    if (!typeId) return false;
    const result = dispatch('wall.draw', { levelId: ctx.levelId(), typeId, points: [anchor, p] });
    if (!result.ok) {
      ctx.notify(result.error);
      return false;
    }
    ctx.notify(null);
    anchor = endOnNode ? null : p;
    return true;
  };

  return {
    id: 'walls',
    cursor: 'crosshair',
    move(e, ctx) {
      hover = ctx.snap(e.model, anchor ? { anchor } : {});
      ctx.redraw();
    },
    down(e, ctx) {
      if (e.button !== 0) return;
      const snapped = ctx.snap(e.model, anchor ? { anchor } : {});
      // Clicking an existing wall end closes the run (e.g. back at the first corner).
      const closes = anchor !== null && snapped.kind === 'node' && distance(snapped.p, anchor) > POINT_EPS;
      place(snapped.p, ctx, closes);
      hover = ctx.snap(e.model, anchor ? { anchor } : {});
      ctx.redraw();
    },
    doubleClick(_e, ctx) {
      anchor = null;
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        if (anchor) anchor = null;
        else if (e.key === 'Escape') ctx.setTool('select');
        ctx.redraw();
        return true;
      }
      return false;
    },
    cancel() {
      anchor = null;
      hover = null;
    },
    preview(doc: PlanDocument, ctx) {
      const typeId = activeWallTypeId();
      if (!anchor || !hover || !typeId || distance(anchor, hover.p) <= POINT_EPS) return null;
      const points = [anchor, hover.p];
      let n = 0;
      try {
        return produce(doc, (draft) => {
          planCommands['wall.draw'].run(draft, { levelId: ctx.levelId(), typeId, points }, { newId: () => `preview-${++n}` });
        });
      } catch {
        return null;
      }
    },
    overlay(ctx): Overlay {
      const overlay: Overlay = { snap: hover };
      if (anchor && hover) {
        const format = ctx.doc().settings.lengthFormat;
        overlay.lines = hover.guides.map(([a, b]) => ({ a, b, style: 'guide' as const }));
        overlay.lines.push({ a: anchor, b: hover.p, style: 'rubber' });
        if (distance(anchor, hover.p) > POINT_EPS) {
          overlay.dimensions = [{ a: anchor, b: hover.p, offset: ctx.view.model(28), label: formatLength(distance(anchor, hover.p), format) }];
        }
      } else if (hover) {
        overlay.lines = hover.guides.map(([a, b]) => ({ a, b, style: 'guide' as const }));
      }
      return overlay;
    },
    lengthEntry(ctx) {
      if (!anchor) return null;
      return {
        position: () => hover?.p ?? anchor,
        commit: (lengthText, angleText) => {
          if (!anchor) return 'Click to start a wall first.';
          const format = ctx.doc().settings.lengthFormat;
          const parsed = parseLength(lengthText, parseContextFor(format));
          if (!parsed.ok) return parsed.error;
          if (parsed.inches <= POINT_EPS) return 'Length must be greater than zero.';
          let angle = direction();
          if (angleText.trim() !== '') {
            const degrees = Number(angleText.replace(/°/g, '').trim());
            if (!Number.isFinite(degrees)) return 'Enter the angle in degrees, e.g. 90.';
            angle = degrees * DEG;
          }
          const target = add(anchor, fromAngle(angle, parsed.inches));
          return place(target, ctx, false) ? null : 'That wall could not be drawn.';
        },
      };
    },
  };
}
