import { describe, expect, it } from 'vitest';
import { lotArea, materialsList } from '../../src';
import { testHistory } from '../helpers';

describe('site', () => {
  it('stores a lot and a north arrow', () => {
    const { history, baseLevelId } = testHistory();
    const points = [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 1200, y: 800 },
      { x: 0, y: 800 },
    ];
    const lot = history.dispatch('site.lot', { levelId: baseLevelId, points });
    if (!lot.ok) throw new Error(lot.error);
    expect(lotArea(points)).toBe(1200 * 800);
    const north = history.dispatch('site.north', { levelId: baseLevelId, p: { x: 100, y: 100 } });
    if (!north.ok) throw new Error(north.error);
    const lines = materialsList(history.doc).filter((line) => line.category === 'Site');
    expect(lines.find((line) => line.name === 'Lot area')?.quantity).toBeCloseTo((1200 * 800) / 144, 3);
    expect(lines.find((line) => line.name === 'Property line')?.quantity).toBeCloseTo((2 * (1200 + 800)) / 12, 3);
    expect(lines.find((line) => line.name === 'North arrows')?.quantity).toBe(1);
    expect(history.dispatch('site.lot', { levelId: baseLevelId, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }).ok).toBe(false);
  });
});
