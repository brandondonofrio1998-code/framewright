import type { DisplayItem, FillId, PenId, Prim, SnapKind, Vec2 } from '@framewright/core';
import type { Viewport } from './viewport';

interface PenStyle {
  width: number;
  color: string;
  dash?: number[];
}

const PENS: Record<PenId, PenStyle> = {
  'wall.face': { width: 1.5, color: '#1f2328' },
  'wall.layer': { width: 0.75, color: '#8b8680' },
  dimension: { width: 1, color: '#30343a' },
  reference: { width: 1, color: '#b9b4ad', dash: [6, 4] },
  opening: { width: 1.25, color: '#1f2328' },
  'opening.swing': { width: 0.75, color: '#5f6670' },
  'opening.hidden': { width: 0.75, color: '#5f6670', dash: [4, 3] },
  object: { width: 1.25, color: '#1f2328' },
  'object.detail': { width: 0.75, color: '#5f6670' },
  'object.hidden': { width: 1, color: '#5f6670', dash: [5, 3] },
  roof: { width: 1.5, color: '#6b4f3a' },
  foundation: { width: 1.25, color: '#5c6560' },
  stair: { width: 1.25, color: '#243044' },
  deck: { width: 1.25, color: '#8d7355' },
  electrical: { width: 1.25, color: '#1f4b3a' },
};

const FILLS: Record<FillId, string> = {
  'wall.structure': '#e4d7c3',
  'wall.sheathing': '#ede3d3',
  'wall.insulation': '#f1ecf4',
  'wall.finish': '#f7f5f2',
  'wall.air': '#ffffff',
};

export const ACCENT = '#0e7c86';
const GRID_MINOR = '#efedea';
const GRID_MAJOR = '#e2dfdb';
const AXIS = '#d4d0ca';

let canvasDark = false;

export function setCanvasDark(next: boolean): void {
  canvasDark = next;
}

export function canvasBackground(): string {
  return canvasDark ? '#121418' : '#ffffff';
}

const DARK_INK: Record<PenId, string> = {
  'wall.face': '#e7e4df',
  'wall.layer': '#a39e97',
  dimension: '#d5d0c8',
  reference: '#6f6a64',
  opening: '#e7e4df',
  'opening.swing': '#b7b1a8',
  'opening.hidden': '#b7b1a8',
  object: '#e7e4df',
  'object.detail': '#b7b1a8',
  'object.hidden': '#b7b1a8',
  roof: '#d2b48c',
  foundation: '#b7c4bc',
  stair: '#c5d0e0',
  deck: '#e4d3b8',
  electrical: '#9ddec4',
};

function penOf(pen: PenStyle | PenId): PenStyle {
  if (typeof pen !== 'string') return pen;
  const style = PENS[pen];
  return canvasDark ? { ...style, color: DARK_INK[pen] } : style;
}

function applyPen(ctx: CanvasRenderingContext2D, pen: PenStyle | PenId, override?: string) {
  const style = penOf(pen);
  ctx.lineWidth = style.width;
  ctx.strokeStyle = override ?? style.color;
  ctx.setLineDash(style.dash ?? []);
}

function path(ctx: CanvasRenderingContext2D, view: Viewport, pts: readonly Vec2[], closed: boolean) {
  pts.forEach((p, i) => {
    const s = view.toScreen(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
}

export function drawGrid(ctx: CanvasRenderingContext2D, view: Viewport, spacing: number): void {
  const bounds = view.visibleBounds();
    const minor = canvasDark ? '#2a2e34' : GRID_MINOR;
    const major = canvasDark ? '#343a42' : GRID_MAJOR;
    const levels = [
      { step: spacing, color: minor },
      { step: spacing * 10, color: major },
    ];
  for (const { step, color } of levels) {
    if (step * view.scale < 8) continue;
    ctx.beginPath();
    for (let x = Math.ceil(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
      const sx = Math.round(view.toScreen({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, view.height);
    }
    for (let y = Math.ceil(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
      const sy = Math.round(view.toScreen({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(view.width, sy);
    }
    applyPen(ctx, { width: 1, color });
    ctx.stroke();
  }
  const origin = view.toScreen({ x: 0, y: 0 });
  ctx.beginPath();
  ctx.moveTo(Math.round(origin.x) + 0.5, 0);
  ctx.lineTo(Math.round(origin.x) + 0.5, view.height);
  ctx.moveTo(0, Math.round(origin.y) + 0.5);
  ctx.lineTo(view.width, Math.round(origin.y) + 0.5);
  applyPen(ctx, { width: 1, color: canvasDark ? '#3e4650' : AXIS });
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, view: Viewport, prim: Extract<Prim, { t: 'text' }>, color: string) {
  const px = prim.size * view.scale;
  if (px < 4) return;
  const s = view.toScreen(prim.p);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(-prim.rot);
  ctx.font = `${Math.max(px, 10)}px system-ui, sans-serif`;
  ctx.textAlign = prim.align;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  ctx.fillText(prim.s, 0, 0);
  ctx.restore();
}

/** Draws items in two passes (fills, then strokes and text) so joins never hide face lines. */
export function drawDisplayList(ctx: CanvasRenderingContext2D, view: Viewport, items: readonly DisplayItem[], highlight?: ReadonlySet<string>): void {
  for (const item of items) {
    for (const prim of item.prims) {
      if (prim.t !== 'poly') continue;
      ctx.beginPath();
      for (const ring of prim.rings) path(ctx, view, ring, true);
      ctx.fillStyle = FILLS[prim.fill];
      ctx.fill('evenodd');
    }
  }
  for (const item of items) {
    const color = item.elementId && highlight?.has(item.elementId) ? ACCENT : undefined;
    for (const prim of item.prims) {
      switch (prim.t) {
        case 'line':
          ctx.beginPath();
          path(ctx, view, [prim.a, prim.b], false);
          applyPen(ctx, prim.pen, color);
          if (color) ctx.lineWidth += 1;
          ctx.stroke();
          break;
        case 'polyline':
          ctx.beginPath();
          path(ctx, view, prim.pts, prim.closed);
          applyPen(ctx, prim.pen, color);
          ctx.stroke();
          break;
        case 'arc': {
          const radius = prim.r * view.scale;
          if (!(radius > 0)) break;
          const c = view.toScreen(prim.c);
          ctx.beginPath();
          // Screen Y points down, so model angles flip sign.
          ctx.arc(c.x, c.y, radius, -prim.start, -(prim.start + prim.sweep), prim.sweep > 0);
          applyPen(ctx, prim.pen, color);
          ctx.stroke();
          break;
        }
        case 'text':
          drawText(ctx, view, prim, color ?? penOf('dimension').color);
          break;
        case 'poly':
          break;
      }
    }
  }
}

export function drawOutline(ctx: CanvasRenderingContext2D, view: Viewport, pts: readonly Vec2[], color = ACCENT): void {
  ctx.beginPath();
  path(ctx, view, pts, true);
  ctx.fillStyle = 'rgba(14, 124, 134, 0.12)';
  ctx.fill();
  applyPen(ctx, { width: 1.5, color });
  ctx.stroke();
}

export function drawLine(ctx: CanvasRenderingContext2D, view: Viewport, a: Vec2, b: Vec2, style: 'rubber' | 'guide'): void {
  ctx.beginPath();
  path(ctx, view, [a, b], false);
  applyPen(ctx, style === 'rubber' ? { width: 1, color: ACCENT } : { width: 1, color: '#c2410c', dash: [4, 4] });
  ctx.stroke();
}

export function drawHandle(ctx: CanvasRenderingContext2D, view: Viewport, p: Vec2): void {
  const s = view.toScreen(p);
  ctx.setLineDash([]);
  ctx.fillStyle = canvasBackground();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
  ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
}

export function drawBox(ctx: CanvasRenderingContext2D, view: Viewport, a: Vec2, b: Vec2): void {
  const sa = view.toScreen(a);
  const sb = view.toScreen(b);
  ctx.fillStyle = 'rgba(14, 124, 134, 0.08)';
  ctx.fillRect(Math.min(sa.x, sb.x), Math.min(sa.y, sb.y), Math.abs(sb.x - sa.x), Math.abs(sb.y - sa.y));
  applyPen(ctx, { width: 1, color: ACCENT, dash: [4, 3] });
  ctx.strokeRect(Math.min(sa.x, sb.x), Math.min(sa.y, sb.y), Math.abs(sb.x - sa.x), Math.abs(sb.y - sa.y));
}

/** Snap glyphs: a distinct shape per snap reason. */
export function drawSnapGlyph(ctx: CanvasRenderingContext2D, view: Viewport, p: Vec2, kind: SnapKind): void {
  if (kind === 'free') return;
  const { x, y } = view.toScreen(p);
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#c2410c';
  ctx.beginPath();
  switch (kind) {
    case 'node':
    case 'corner':
      ctx.rect(x - 5, y - 5, 10, 10);
      break;
    case 'midpoint':
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y + 5);
      ctx.lineTo(x - 6, y + 5);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x - 5, y + 5);
      break;
    case 'onWall':
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      break;
    case 'grid':
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      break;
    case 'angle':
    case 'alignment':
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      break;
  }
  ctx.stroke();
}
