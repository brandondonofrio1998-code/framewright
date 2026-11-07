import { describe, expect, it } from 'vitest';
import {
  STARTER_CATALOG,
  buildLevelMeshes,
  checkInvariants,
  loadDocument,
  materialsList,
  planDxf,
  planGlb,
  pointInsideMesh,
  roomFace,
  roomsOnLevel,
  serializeDocument,
  sheetPdf,
} from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${result.error}`);
  return result.value;
}

/**
 * A 24 by 16 foot house split into a living room and a bedroom, with a second
 * floor, a stair, a roof, and a foundation. This is the first real-world pass.
 */
describe('a small house', () => {
  it('builds, measures, and reopens', async () => {
    const ctx = testHistory();
    const { history } = ctx;
    const levelId = ctx.baseLevelId;
    const exterior = Object.values(history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const interior = Object.values(history.doc.wallTypes).find((t) => t.name === 'Interior 2x4')!.id;

    must(
      history.dispatch('wall.draw', {
        levelId,
        typeId: exterior,
        points: [p(0, 0), p(288, 0), p(288, 192), p(0, 192)],
        closed: true,
      }),
      'exterior',
    );
    must(history.dispatch('wall.draw', { levelId, typeId: interior, points: [p(192, 0), p(192, 192)] }), 'partition');

    const wallAt = (onLevel: string, ax: number, ay: number, bx: number, by: number) => {
      const nodes = new Map(
        Object.values(history.doc.elements)
          .filter((el) => el.kind === 'wallNode')
          .map((el) => [el.id, el.p]),
      );
      const wall = Object.values(history.doc.elements).find((el) => {
        if (el.kind !== 'wall' || el.levelId !== onLevel) return false;
        const a = nodes.get(el.a);
        const b = nodes.get(el.b);
        if (!a || !b) return false;
        const near = (u: { x: number; y: number }, x: number, y: number) => Math.abs(u.x - x) < 1 && Math.abs(u.y - y) < 1;
        return (near(a, ax, ay) && near(b, bx, by)) || (near(a, bx, by) && near(b, ax, ay));
      });
      if (wall?.kind !== 'wall') throw new Error(`missing wall ${ax},${ay} to ${bx},${by}`);
      return wall.id;
    };

    must(
      history.dispatch('opening.place', { kind: 'door', wallId: wallAt(levelId,0, 0, 192, 0), t: 96, width: 36, height: 80, side: 'left', hinge: 'start', style: 'hinged' }),
      'front door',
    );
    must(
      history.dispatch('opening.place', { kind: 'window', wallId: wallAt(levelId,192, 0, 288, 0), t: 48, width: 36, height: 48, sill: 32, side: 'left', hinge: 'start', style: 'double-hung' }),
      'bedroom window',
    );
    must(
      history.dispatch('opening.place', { kind: 'door', wallId: wallAt(levelId,192, 0, 192, 192), t: 96, width: 32, height: 80, side: 'left', hinge: 'start', style: 'hinged' }),
      'bedroom door',
    );

    const bed = STARTER_CATALOG.find((item) => item.sourceId === 'starter.bed')!;
    const sofa = STARTER_CATALOG.find((item) => item.sourceId === 'starter.sofa')!;
    must(
      history.dispatch('object.place', { levelId, def: sofa, hostWallId: wallAt(levelId,0, 0, 0, 192), hostT: 96, side: 'left' }),
      'sofa',
    );
    must(
      history.dispatch('object.place', { levelId, def: bed, hostWallId: wallAt(levelId,192, 192, 288, 192), hostT: 48, side: 'right' }),
      'bed',
    );

    const upperId = must(history.dispatch('level.create', { position: 'above', referenceId: levelId, name: 'Level 2' }), 'upper level');
    must(
      history.dispatch('wall.draw', {
        levelId: upperId,
        typeId: exterior,
        points: [p(0, 0), p(288, 0), p(288, 192), p(0, 192)],
        closed: true,
      }),
      'upper walls',
    );
    must(history.dispatch('roof.build', { levelId }), 'roof over the partitioned floor');
    must(history.dispatch('roof.build', { levelId: upperId }), 'roof');
    must(history.dispatch('foundation.build', { levelId }), 'foundation');
    must(history.dispatch('stair.create', { levelId, start: p(48, 30), end: p(48, 180) }), 'stair');
    must(history.dispatch('deck.create', { levelId, ledger: p(36, 0), dir: p(1, 0), width: 120, depth: 96, side: -1 }), 'deck');

    const receptacle = must(
      history.dispatch('electrical.create', { levelId, device: 'receptacle', p: p(100, 0), hostWallId: wallAt(levelId,0, 0, 192, 0), hostT: 150, side: 'left' }),
      'receptacle',
    );
    const light = must(history.dispatch('electrical.create', { levelId, device: 'light', p: p(96, 96) }), 'light');
    must(history.dispatch('electrical.setCircuit', { id: receptacle, circuit: 1 }), 'circuit');
    must(history.dispatch('electrical.setCircuit', { id: light, circuit: 1 }), 'light circuit');
    must(
      history.dispatch('plumbing.create', { levelId, fixture: 'supply', p: p(240, 0), hostWallId: wallAt(levelId,192, 0, 288, 0), hostT: 24, side: 'left' }),
      'supply',
    );
    must(history.dispatch('pipe.create', { levelId, service: 'supply', a: p(240, 8), b: p(240, 80) }), 'pipe');
    must(history.dispatch('text.create', { levelId, p: p(80, 140), text: 'Living' }), 'note');

    const rooms = roomsOnLevel(history.doc, levelId);
    expect(rooms).toHaveLength(2);
    const areas = rooms.map((room) => {
      const face = roomFace(history.doc, room);
      if (!face) throw new Error(`room ${room.name} has no face`);
      return Math.abs(face.area) / 144;
    });
    expect(areas.reduce((sum, area) => sum + area, 0)).toBeGreaterThan(300);
    expect(Math.min(...areas)).toBeGreaterThan(80);

    const listed = materialsList(history.doc);
    const qty = (name: string) => listed.find((line) => line.name === name)?.quantity ?? 0;
    expect(qty('Studs')).toBeGreaterThan(40);
    expect(listed.some((line) => line.category === 'Roof' && line.quantity > 100)).toBe(true);
    expect(listed.some((line) => line.category === 'Foundation' && line.quantity > 0)).toBe(true);
    expect(listed.some((line) => line.category === 'Floors' && line.quantity > 200)).toBe(true);
    expect(listed.some((line) => line.category === 'Ceilings' && line.quantity > 100)).toBe(true);
    expect(listed.find((line) => line.name === 'Cable')?.quantity ?? 0).toBeGreaterThan(0);

    for (const id of [levelId, upperId]) {
      for (const part of buildLevelMeshes(history.doc, id)) {
        for (const value of part.positions) expect(Number.isFinite(value)).toBe(true);
      }
    }
    const lower = buildLevelMeshes(history.doc, levelId);
    expect(pointInsideMesh(lower, [80, 80, -0.2])).toBe(true);
    const upper = buildLevelMeshes(history.doc, upperId);
    const floorZ = history.doc.levels[upperId]!.elevation - 0.3;
    expect(pointInsideMesh(upper, [250, 100, floorZ])).toBe(true);
    expect(pointInsideMesh(upper, [48, 100, floorZ])).toBe(false);
    const plate = history.doc.levels[upperId]!.elevation + history.doc.levels[upperId]!.ceilingHeight;
    expect(pointInsideMesh(upper, [0.4, 70.5, plate + 12])).toBe(true);

    expect(checkInvariants(history.doc)).toEqual([]);
    const loaded = loadDocument(serializeDocument(history.doc));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(checkInvariants(loaded.doc)).toEqual([]);
    expect(Object.keys(loaded.doc.elements).length).toBe(Object.keys(history.doc.elements).length);

    const dxf = planDxf(history.doc, levelId);
    expect(dxf).toContain('HATCH');
    expect(dxf).toContain('Living');
    const glb = planGlb(history.doc, new Map([['smooth-wall', Uint8Array.from([0xff, 0xd8])]]));
    expect(glb[0]).toBe(0x67);
    const pdf = await sheetPdf(history.doc, levelId);
    expect(pdf.length).toBeGreaterThan(1000);

    const moved = history.dispatch('wall.move', { wallIds: [wallAt(upperId, 0, 192, 288, 192)], delta: p(0, 12) });
    expect(moved.ok).toBe(true);
    expect(Object.values(history.doc.elements).filter((el) => el.kind === 'roofPlane').length).toBeGreaterThan(0);
  });
});
