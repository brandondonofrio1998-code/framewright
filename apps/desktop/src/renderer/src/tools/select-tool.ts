import { produce } from 'immer';
import {
  add,
  objectSize,
  placeOnWall,
  clampOpeningT,
  distance,
  dot,
  elementsInBox,
  formatLength,
  isOpening,
  openingFitError,
  wallLength,
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
import { objectSpotAt, type ObjectSpot } from './object-placement';
import { openingClearances, openingSpotAt, type OpeningSpot } from './opening-placement';
import type { Overlay, PlanPointer, Tool, ToolContext } from './types';

const DRAG_THRESHOLD_PX = 4;
const PICK_TOLERANCE_PX = 6;
const HANDLE_TOLERANCE_PX = 7;

type Drag =
  | { kind: 'none' }
  | { kind: 'pressing'; start: PlanPointer; target: 'walls' | 'dimension' | 'opening' | 'object' | 'room' | 'text'; id: Id }
  | { kind: 'text'; id: Id; origin: Vec2; from: Vec2; at: Vec2 }
  | { kind: 'opening'; id: Id; grab: number; spot: OpeningSpot | null }
  | { kind: 'object'; id: Id; mode: 'wall'; grab: number; rotation: number; cursor: Vec2; spot: ObjectSpot | null }
  | { kind: 'object'; id: Id; mode: 'free'; rotation: number; origin: Vec2; from: Vec2; at: Vec2 }
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
      const target = hit.kind === 'wall' ? 'walls' : hit.kind === 'dimension' ? 'dimension' : hit.kind === 'object' ? 'object' : hit.kind === 'text' ? 'text' : hit.kind === 'room' || hit.kind === 'cad' || hit.kind === 'foundation' ? 'room' : 'opening';
      drag = { kind: 'pressing', start: e, target, id: hit.id };
      ctx.redraw();
    },
    move(e, ctx) {
      const doc = ctx.doc();
      switch (drag.kind) {
        case 'pressing': {
          if (distance(drag.start.screen, e.screen) < DRAG_THRESHOLD_PX) return;
          if (drag.target === 'room') return;
          if (drag.target === 'text') {
            const note = doc.elements[drag.id];
            if (note?.kind !== 'text') return;
            drag = { kind: 'text', id: note.id, origin: note.p, from: drag.start.model, at: note.p };
          } else if (drag.target === 'object') {
            const object = doc.elements[drag.id];
            if (object?.kind !== 'object') return;
            if (object.hostWallId !== undefined) {
              const { width } = objectSize(doc, object);
              const grabbed = objectSpotAt(ctx, drag.start.model, width);
              const grab = grabbed && grabbed.wallId === object.hostWallId && object.hostT !== undefined ? object.hostT - grabbed.t : 0;
              drag = { kind: 'object', id: object.id, mode: 'wall', grab, rotation: object.rotation, cursor: e.model, spot: null };
            } else {
              drag = { kind: 'object', id: object.id, mode: 'free', rotation: object.rotation, origin: object.p, from: drag.start.model, at: object.p };
            }
          } else if (drag.target === 'walls') {
            const wallIds = selectedWalls(ctx).map((w) => w.id);
            if (wallIds.length === 0) return;
            drag = { kind: 'walls', start: drag.start.model, wallIds, delta: { x: 0, y: 0 }, snap: null };
          } else if (drag.target === 'opening') {
            const opening = doc.elements[drag.id];
            const grabbed = isOpening(opening) ? openingSpotAt(ctx, drag.start.model, opening.width, opening.id) : null;
            if (!isOpening(opening) || !grabbed) return;
            // Keep the point you grabbed under the cursor instead of jumping the opening's center to it.
            drag = { kind: 'opening', id: opening.id, grab: opening.wallId === grabbed.wallId ? opening.t - grabbed.t : 0, spot: null };
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
        case 'opening': {
          const opening = doc.elements[drag.id];
          if (!isOpening(opening)) return;
          const spot = openingSpotAt(ctx, e.model, opening.width, opening.id);
          if (spot && spot.wallId === opening.wallId) {
            const wall = doc.elements[spot.wallId];
            const length = wall?.kind === 'wall' ? wallLength(doc, wall) : 0;
            spot.t = clampOpeningT(length, opening.width, spot.t + drag.grab);
            spot.side = opening.side;
            spot.error = wall?.kind === 'wall' ? openingFitError(doc, wall, spot.t, opening.width, opening.id) : spot.error;
          }
          drag.spot = spot;
          ctx.notify(spot?.error ?? null);
          break;
        }
        case 'text':
          drag.at = add(drag.origin, sub(e.model, drag.from));
          break;
        case 'object': {
          const object = doc.elements[drag.id];
          if (object?.kind !== 'object') return;
          if (drag.mode === 'free') {
            drag.at = add(drag.origin, sub(e.model, drag.from));
            break;
          }
          drag.cursor = e.model;
          const { width } = objectSize(doc, object);
          const spot = objectSpotAt(ctx, e.model, width);
          if (spot) spot.t += drag.grab;
          drag.spot = spot;
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
        case 'opening':
          if (current.spot && !current.spot.error) {
            const { wallId, t, side } = current.spot;
            commit(dispatch('opening.move', { id: current.id, wallId, t, side }), ctx);
          }
          break;
        case 'text':
          commit(dispatch('text.update', { id: current.id, p: current.at }), ctx);
          break;
        case 'object':
          if (current.mode === 'wall' && current.spot) {
            commit(dispatch('object.move', { id: current.id, p: current.cursor, rotation: current.rotation, hostWallId: current.spot.wallId, hostT: current.spot.t, side: current.spot.side }), ctx);
          } else if (current.mode === 'wall') {
            commit(dispatch('object.move', { id: current.id, p: current.cursor, rotation: current.rotation, hostWallId: null }), ctx);
          } else {
            commit(dispatch('object.move', { id: current.id, p: current.at, rotation: current.rotation, hostWallId: null }), ctx);
          }
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
      if (d.kind === 'text') {
        return produce(doc, (draft) => {
          const note = draft.elements[d.id];
          if (note?.kind === 'text') note.p = d.at;
        });
      }
      if (d.kind === 'dimension') {
        return produce(doc, (draft) => {
          const dim = draft.elements[d.id];
          if (dim?.kind === 'dimension') dim.offset = d.offset;
        });
      }
      if (d.kind === 'object') {
        return produce(doc, (draft) => {
          const object = draft.elements[d.id];
          if (object?.kind !== 'object') return;
          if (d.mode === 'wall' && d.spot) {
            const wall = draft.elements[d.spot.wallId];
            if (wall?.kind !== 'wall') return;
            const { width, depth } = objectSize(draft, object);
            const placed = placeOnWall(draft, wall, d.spot.t, d.spot.side, width, depth);
            if (!placed) return;
            Object.assign(object, { p: placed.p, rotation: placed.rotation, hostWallId: wall.id, hostT: placed.t, side: placed.side });
          } else {
            object.p = d.mode === 'free' ? d.at : d.cursor;
            delete object.hostWallId;
            delete object.hostT;
            delete object.side;
          }
        });
      }
      if (d.kind === 'opening' && d.spot && !d.spot.error) {
        const { wallId, t, side } = d.spot;
        return produce(doc, (draft) => {
          const o = draft.elements[d.id];
          if (isOpening(o)) Object.assign(o, { wallId, t, side });
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
      const selected = doc ? doc.elements[ctx.selection()[0]!] : undefined;
      if (doc && isOpening(selected)) {
        // Moving an opening never changes wall geometry, so the committed geometry still applies.
        const geom = ctx.geometry().get(selected.wallId);
        if (geom) overlay.dimensions = openingClearances({ ...ctx, doc: () => doc }, geom, selected, selected.width, selected.id);
        return overlay;
      }
      const wall = selected;
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