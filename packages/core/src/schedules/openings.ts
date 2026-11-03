import type { Id, Opening, PlanDocument } from '../model/schema';
import { openingsOnLevel } from '../openings/openings';
import { formatLength } from '../units/length';

export interface ScheduleRow {
  mark: string;
  kind: 'door' | 'window';
  style: string;
  width: number;
  height: number;
  /** Window sill height. Absent on a door. */
  sill?: number;
  count: number;
  /** Size in the plan's length format, such as 3'-0" x 6'-8". */
  size: string;
}

function styleName(style: string): string {
  const words = style.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function keyOf(opening: Opening): string {
  return opening.kind === 'window'
    ? `window|${opening.style}|${opening.width}|${opening.height}|${opening.sill}`
    : `door|${opening.style}|${opening.width}|${opening.height}`;
}

/**
 * Doors and windows on a level, grouped by size and style. Marks are D1, D2 for doors
 * and W1, W2 for windows, in order of width, then height. The list is derived, not stored.
 */
export function openingSchedule(doc: PlanDocument, levelId: Id): ScheduleRow[] {
  const groups = new Map<string, { opening: Opening; count: number }>();
  for (const opening of openingsOnLevel(doc, levelId)) {
    const key = keyOf(opening);
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { opening, count: 1 });
  }
  const format = doc.settings.lengthFormat;
  const rows = [...groups.values()].sort((a, b) => {
    if (a.opening.kind !== b.opening.kind) return a.opening.kind === 'door' ? -1 : 1;
    return a.opening.width - b.opening.width || a.opening.height - b.opening.height || a.opening.style.localeCompare(b.opening.style);
  });
  let doors = 0;
  let windows = 0;
  return rows.map(({ opening, count }) => {
    const mark = opening.kind === 'door' ? `D${++doors}` : `W${++windows}`;
    const size = `${formatLength(opening.width, format)} x ${formatLength(opening.height, format)}`;
    return {
      mark,
      kind: opening.kind,
      style: styleName(opening.style),
      width: opening.width,
      height: opening.height,
      ...(opening.kind === 'window' ? { sill: opening.sill } : {}),
      count,
      size,
    };
  });
}
