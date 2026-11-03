import { buildPlanDisplayList } from '../display/plan';
import type { DisplayItem } from '../display/display-list';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import { openingSchedule, type ScheduleRow } from '../schedules/openings';

/** ARCH D, landscape, in inches. */
export const SHEET_WIDTH = 36;
export const SHEET_HEIGHT = 24;
const MARGIN = 0.5;
const TITLE_HEIGHT = 1.5;
/** Paper inches kept for the opening schedule when the level has a door or a window. */
const SCHEDULE_WIDTH = 8;
/** Paper inches for the front elevation when the plan has walls. */
const ELEVATION_HEIGHT = 6.5;

/** Model inches represented by one paper inch, and the label printed in the title block. Largest drawing first. */
const SCALES: { modelPerPaper: number; label: string }[] = [
  { modelPerPaper: 4, label: '3" = 1\'-0"' },
  { modelPerPaper: 8, label: '1 1/2" = 1\'-0"' },
  { modelPerPaper: 12, label: '1" = 1\'-0"' },
  { modelPerPaper: 16, label: '3/4" = 1\'-0"' },
  { modelPerPaper: 24, label: '1/2" = 1\'-0"' },
  { modelPerPaper: 32, label: '3/8" = 1\'-0"' },
  { modelPerPaper: 48, label: '1/4" = 1\'-0"' },
  { modelPerPaper: 96, label: '1/8" = 1\'-0"' },
  { modelPerPaper: 192, label: '1/16" = 1\'-0"' },
];

export interface PaperRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One sheet of the plan. Paper coordinates are inches, origin at the bottom left, Y up. */
export interface SheetLayout {
  width: number;
  height: number;
  border: PaperRect;
  title: PaperRect;
  viewport: PaperRect;
  /** Model inches per paper inch. */
  modelPerPaper: number;
  scaleLabel: string;
  /** Model point drawn at the center of the viewport. */
  center: Vec2;
  /** Opening schedule, to the right of the plan. Null when the level has no doors or windows. */
  schedule: PaperRect | null;
  scheduleRows: ScheduleRow[];
  /** Front elevation, the left half of the band above the title block. Null when the plan has no walls. */
  elevation: PaperRect | null;
  /** Section through the middle, the right half of that band. Null when the plan has no walls. */
  section: PaperRect | null;
  titleText: string;
  levelName: string;
  date: string;
}

/** Lays out an ARCH D sheet for one level. The plan is centered at the largest standard scale that fits. */
export function layoutSheet(doc: PlanDocument, levelId: Id): SheetLayout {
  const border: PaperRect = { x: MARGIN, y: MARGIN, w: SHEET_WIDTH - MARGIN * 2, h: SHEET_HEIGHT - MARGIN * 2 };
  const title: PaperRect = { x: border.x, y: border.y, w: border.w, h: TITLE_HEIGHT };
  const rows = openingSchedule(doc, levelId);
  const scheduleW = rows.length > 0 ? SCHEDULE_WIDTH : 0;
  const hasWalls = Object.values(doc.elements).some((el) => el.kind === 'wall');
  const elevationH = hasWalls ? ELEVATION_HEIGHT : 0;
  const bandY = border.y + TITLE_HEIGHT;
  const elevation: PaperRect | null = elevationH > 0 ? { x: border.x, y: bandY, w: border.w / 2, h: elevationH } : null;
  const section: PaperRect | null = elevationH > 0 ? { x: border.x + border.w / 2, y: bandY, w: border.w / 2, h: elevationH } : null;
  const viewport: PaperRect = {
    x: border.x,
    y: border.y + TITLE_HEIGHT + elevationH,
    w: border.w - scheduleW,
    h: border.h - TITLE_HEIGHT - elevationH,
  };
  const schedule: PaperRect | null = scheduleW > 0 ? { x: border.x + viewport.w, y: viewport.y, w: scheduleW, h: viewport.h } : null;
  const bounds = itemBounds(buildPlanDisplayList(doc, levelId));
  const chosen = fitDrawing(bounds, viewport);
  const level = doc.levels[levelId];
  const date = /^\d{4}-\d{2}-\d{2}/.test(doc.meta.modified) ? doc.meta.modified.slice(0, 10) : '';
  return {
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    border,
    title,
    viewport,
    modelPerPaper: chosen.modelPerPaper,
    scaleLabel: chosen.scaleLabel,
    center: chosen.center,
    schedule,
    scheduleRows: rows,
    elevation,
    section,
    titleText: doc.meta.title.trim() || 'Untitled',
    levelName: level?.name ?? '',
    date,
  };
}

/** The largest standard scale that fits `bounds` in `frame`, and the point drawn at the frame's center. */
export function fitDrawing(bounds: { minX: number; minY: number; maxX: number; maxY: number } | null, frame: PaperRect): { modelPerPaper: number; scaleLabel: string; center: Vec2 } {
  const pad = 12;
  const chosen = bounds
    ? (SCALES.find((scale) => scale.modelPerPaper >= Math.max((Math.max(bounds.maxX - bounds.minX, 24) + pad * 2) / frame.w, (Math.max(bounds.maxY - bounds.minY, 24) + pad * 2) / frame.h) - 1e-6) ??
      SCALES[SCALES.length - 1]!)
    : { modelPerPaper: 48, label: '1/4" = 1\'-0"' };
  return {
    modelPerPaper: chosen.modelPerPaper,
    scaleLabel: chosen.label,
    center: bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } : { x: 0, y: 0 },
  };
}

function itemBounds(items: readonly DisplayItem[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (p: Vec2) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const item of items) {
    for (const prim of item.prims) {
      if (prim.t === 'line') {
        take(prim.a);
        take(prim.b);
      } else if (prim.t === 'polyline') prim.pts.forEach(take);
      else if (prim.t === 'poly') prim.rings.forEach((ring) => ring.forEach(take));
      else if (prim.t === 'text' || prim.t === 'arc') take(prim.t === 'text' ? prim.p : prim.c);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
