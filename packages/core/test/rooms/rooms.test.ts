import { describe, expect, it } from 'vitest';
import { checkInvariants, exteriorSideOfWall, formatArea, roomFace, roomsOnLevel, type Room, type Vec2 } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const draw = (points: Vec2[], closed = false) => {
    const result = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points, ...(closed ? { closed } : {}) });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const rooms = () => roomsOnLevel(ctx.history.doc, ctx.baseLevelId);
  return { ...ctx, draw, rooms };
}

describe('room detection', () => {
  it('creates one room for a closed rectangle, with the area inside the walls', () => {
    const s = setup();
    s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], true);
    const [room] = s.rooms();
    expect(s.rooms()).toHaveLength(1);
    expect(room).toMatchObject({ name: 'Room 1', roomType: 'unspecified', ceilingHeight: null });
    // 20' x 12' centerline, exterior walls 7 3/16" thick, so the inside is 232.8125" x 136.8125".
    const face = roomFace(s.history.doc, room!)!;
    expect(face.area / 144).toBeCloseTo((232.8125 * 136.8125) / 144, 3);
    expect(formatArea(face.area)).toBe('221.2 sq ft');
    expect(checkInvariants(s.history.doc)).toEqual([]);
  });

  it('an open chain of walls makes no room', () => {
    const s = setup();
    s.draw([p(0, 0), p(120, 0), p(120, 80)]);
    expect(s.rooms()).toHaveLength(0);
  });

  it('a wall across a room splits it into two, and removing the wall merges them back', () => {
    const s = setup();
    s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], true);
    const divider = s.draw([p(120, 0), p(120, 144)]);
    expect(s.rooms()).toHaveLength(2);
    const before = s.rooms().map((r) => r.name).sort();
    expect(before).toEqual(['Room 1', 'Room 2']);
    s.history.dispatch('elements.delete', { ids: divider });
    expect(s.rooms()).toHaveLength(1);
    // The surviving room keeps the name of the space it overlapped.
    expect(['Room 1', 'Room 2']).toContain(s.rooms()[0]!.name);
  });

  it('keeps a renamed room when its wall moves, and exterior sides face outward', () => {
    const s = setup();
    const [bottom, right, top, left] = s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], true);
    const room = s.rooms()[0]!;
    const areaBefore = roomFace(s.history.doc, room)!.area;
    s.history.dispatch('room.update', { id: room.id, name: 'Kitchen', roomType: 'kitchen' });
    const node = (s.history.doc.elements[top!] as { a: string }).a;
    s.history.dispatch('wallNode.move', { nodeId: node, to: p(240, 180) });
    const kept = s.history.doc.elements[room.id] as Room;
    expect(kept).toMatchObject({ name: 'Kitchen', roomType: 'kitchen' });
    expect(roomFace(s.history.doc, kept)!.area).toBeGreaterThan(areaBefore);
    // Drawn counter-clockwise, so the outside is every wall's right side.
    expect([bottom, right, top, left].map((id) => exteriorSideOfWall(s.history.doc, id!))).toEqual(['right', 'right', 'right', 'right']);
  });

  it('an interior wall has no exterior side', () => {
    const s = setup();
    s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], true);
    const [divider] = s.draw([p(120, 0), p(120, 144)]);
    expect(exteriorSideOfWall(s.history.doc, divider!)).toBeNull();
  });

  it('undo removes the room a wall draw created', () => {
    const s = setup();
    s.draw([p(0, 0), p(100, 0), p(100, 80), p(0, 80)], true);
    expect(s.rooms()).toHaveLength(1);
    s.history.undo();
    expect(s.rooms()).toHaveLength(0);
    s.history.redo();
    expect(s.rooms()).toHaveLength(1);
  });
});
