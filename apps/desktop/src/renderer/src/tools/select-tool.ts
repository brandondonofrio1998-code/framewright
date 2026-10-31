import { produce } from 'immer';
import {
  add,
  distance,
  dot,
  elementsInBox,
  formatLength,
  normalize,
  perp,
  pickElement,
  resolveDimensionEnd,
  sub,
  type Id,
  type PlanDocument,
  type SnapResult,
  type Vec2,
} from '@framewright/core';
import { dispatch } from '../document/store';
import type { Overlay, PlanPointer, Tool, ToolContext } from './types';

const DRAG_THRESHOLD_PX = 4;
const PICK_TOLERANCE_PX = 6;
const HANDLE_TOLERANCE_PX = 7;

type Drag =
  | { kind: 'none' }
  | { kind: 'pressing'; start: PlanPointer; target: 'walls' | 'dimension' }
  | { kind: 'walls'; start: Vec2; wallIds: Id[]; delta: Vec2; snap: SnapResult | null }
  | { kind: 'node'; nodeId: Id; anchor: Vec2 | undefined; to: Vec2; snap: SnapResult | null }
  | { kind: 'dimension'; id: Id; offset: number }
  | { kind: 'box'; start: Vec2; end: Vec2; additive: boolean };

function selectedWalls(ctx: ToolContext) {
  const doc = ctx.doc();
  return ctx.selection().flatMap((id) => {
    const el = doc.elements[id];
    return el?.kind === 'wall' ? [el] : [];
  });
}

function nodePosition(doc: PlanDocument, id: Id): Vec2 | undefined {
  const node = doc.elements[id];
  return node?.kind === 'wallNode' ? node.p : undefined;
}

export function createSelectTool(): Tool {
  let drag: Drag = { kind: 'none' };

  const commit = (result: { ok: boolean; error?: string }, ctx: ToolContext) => ctx.notify(result.ok ? null : (result.error ?? null));

  return {
    id: 'select',
    cursor: 'default',
    down(e, ctx) {
      if (e.button !== 0) return;
      const doc = ctx.doc();
      const walls = selectedWalls(ctx);
      if (walls.length === 1 && ctx.selection().length === 1) {
        const wall = walls[0]!;
        for (const [nodeId, otherId] of [
          [wall.a, wall.b],
          [wall.b, wall.a],
        ] as const) {
          const p = nodePosition(doc, nodeId);
          if (p && distance(ctx.view.toScreen(p), e.screen) <= HANDLE_TOLERANCE_PX) {
            drag = { kind: 'node', nodeId, anchor: nodePosition(doc, otherId), to: p, snap: null };
            return;
          }
        }
      }

      const hit = pickElement(doc, ctx.levelId(), ctx.geometry(), e.model, ctx.view.model(PICK_TOLERANCE_PX));
      if (!hit) {
        if (!e.shift) ctx.setSelection([]);
        drag = { kind: 'box', start: e.model, end: e.model, additive: e.shift };
        ctx.redraw();
        return;
      }
      const selection = ctx.selection();
      if (e.shift) {
        ctx.setSelection(selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id]);
      } else if (!selection.includes(hit.id)) {
        ctx.setSelection([hit.id]);
      }
      drag = { kind: 'pressing', start: e, target: hit.kind === 'wall' ? 'walls' : 'dimension' };
      ctx.redraw();
    },
    move(e, ctx) {
      const doc = ctx.doc();
      switch (drag.kind) {
        case 'pressing': {
          if (distance(drag.start.screen, e.screen) < DRAG_THRESHOLD_PX) return;
          if (drag.target === 'walls') {
            const wallIds = selectedWalls(ctx).map((w) => w.id);
            if (wallIds.length === 0) return;
            drag = { kind: 'walls', start: drag.start.model, wallIds, delta: { x: 0, y: 0 }, snap: null };
          } else {
            const id = ctx.selection().find((sel) => doc.elements[sel]?.kind === 'dimension');
            const dim = id ? doc.elements[id] : undefined;
            if (dim?.kind !== 'dimension') return;
            drag = { kind: 'dimension', id: dim.id, offset: dim.offset };
          }
          this.move?.(e, ctx);
          return;
        }
        case 'walls': {
          const moving = new Set(drag.wallIds);
          const nodes = new Set(drag.wallIds.flatMap((id) => {
            const w = doc.elements[id];
            return w?.kind === 'wall' ? [w.a, w.b] : [];
          }));
          const snap = ctx.snap(e.model, { anchor: drag.start, excludeWalls: moving, excludeNodes: nodes });
          drag.delta = sub(snap.p, drag.start);
          drag.snap = snap;
          break;
        }
        case 'node': {
          const { nodeId } = drag;
          const attached = Object.values(doc.elements).filter((el) => el.kind === 'wall' && (el.a === nodeId || el.b === nodeId));
          const snap = ctx.snap(e.model, {
            ...(drag.anchor && { anchor: drag.anchor }),
            excludeNodes: new Set([nodeId]),
            excludeWalls: new Set(attached.map((w) => w.id)),
          });
          drag.to = snap.p;
          drag.snap = snap;
          break;
        }
        case 'dimension': {
          const dim = doc.elements[drag.id];
          if (dim?.kind !== 'dimension') return;
          const a = resolveDimensionEnd(doc, dim.a);
          const b = resolveDimensionEnd(doc, dim.b);
          drag.offset = dot(sub(e.model, a), perp(normalize(sub(b, a))));
          break;
        }
        case 'box':
          drag.end = e.model;
          break;
        case 'none':
          return;
      }
      ctx.redraw();
    },
    up(_e, ctx) {
      const current = drag;
      drag = { kind: 'none' };
      switch (current.kind) {
        case 'walls':
          if (distance(current.delta, { x: 0, y: 0 }) > 0) commit(dispatch('wall.move', { wallIds: current.wallIds, delta: current.delta }), ctx);
          break;
        case 'node':
          commit(dispatch('wallNode.move', { nodeId: current.nodeId, to: current.to }), ctx);
          break;
        case 'dimension':
          commit(dispatch('dimension.update', { id: current.id, offset: current.offset }), ctx);
          break;
        case 'box': {
          const box = {
            minX: Math.min(current.start.x, current.end.x),
            minY: Math.min(current.start.y, current.end.y),
            maxX: Math.max(current.start.x, current.end.x),
            maxY: Math.max(current.start.y, current.end.y),
          };
          const ids = elementsInBox(ctx.doc(), ctx.levelId(), ctx.geometry(), box);
          ctx.setSelection(current.additive ? [...new Set([...ctx.selection(), ...ids])] : ids);
          break;
        }
        default:
          break;
      }
      ctx.redraw();
    },
    key(e, ctx) {
      if (e.key === 'Escape') {
        if (drag.kind !== 'none') drag = { kind: 'none' };
        else ctx.setSelection([]);
        ctx.redraw();
        return true;
      }
      return false;
    },
    cancel() {
      drag = { kind: 'none' };
    },
    preview(doc) {
      const d = drag;
      if (d.kind === 'walls') {
        return produce(doc, (draft) => {
          const nodes = new Set<Id>();
          for (const id of d.wallIds) {
            const w = draft.elements[id];
            if (w?.kind === 'wall') nodes.add(w.a).add(w.b);
          }
          for (const id of nodes) {
            const n = draft.elements[id];
            if (n?.kind === 'wallNode') n.p = add(n.p, d.delta);
          }
        });
      }
      if (d.kind === 'node') {
        return produce(doc, (draft) => {
          const n = draft.elements[d.nodeId];
          if (n?.kind === 'wallNode') n.p = d.to;
        });
      }
      if (d.kind === 'dimension') {
        return produce(doc, (draft) => {
          const dim = draft.elements[d.id];
          if (dim?.kind === 'dimension') dim.offset = d.offset;
        });
      }
      return null;
    },
    overlay(ctx): Overlay {
      const overlay: Overlay = {};
      if (drag.kind === 'box') overlay.box = [drag.start, drag.end];
      if ((drag.kind === 'walls' || drag.kind === 'node') && drag.snap) {
        overlay.snap = drag.snap;
        overlay.lines = drag.snap.guides.map(([a, b]) => ({ a, b, style: 'guide' as const }));
      }
      const doc = ctx.selection().length === 1 ? this.preview?.(ctx.doc(), ctx) ?? ctx.doc() : null;
      const wall = doc ? doc.elements[ctx.selection()[0]!] : undefined;
      if (doc && wall?.kind === 'wall') {
        const a = nodePosition(doc, wall.a);
        const b = nodePosition(doc, wall.b);
        const type = doc.wallTypes[wall.typeId];
        if (a && b) {
          overlay.handles = [a, b];
          const half = type ? type.layers.reduce((s, l) => s + l.thickness, 0) / 2 : 0;
          overlay.dimensions = [
            { a, b, offset: half + ctx.view.model(22), label: formatLength(distance(a, b), doc.settings.lengthFormat) },
          ];
        }
      }
      return overlay;
    },
  };
}