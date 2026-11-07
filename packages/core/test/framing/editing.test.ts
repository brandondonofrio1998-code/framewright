import { describe, expect, it } from 'vitest';
import { buildPlanMeshes, computeWallGeometry, frameLevel, insulationCavities, materialsList, openingPrims, openingSchedule, DocumentSchema, wallThickness, type Door, type Wall } from '../../src';
import { testHistory } from '../helpers';

function setup() {
  const { history, baseLevelId } = testHistory();
  const typeId = Object.keys(history.doc.wallTypes)[0]!;
  const result = history.dispatch('wall.draw', { levelId: baseLevelId, typeId, points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 240 }] });
  if (!result.ok) throw new Error(result.error);
  const wallId = result.value[0]!;
  const wall = () => history.doc.elements[wallId] as Wall;
  const frame = () => frameLevel(history.doc, baseLevelId, computeWallGeometry(history.doc, baseLevelId)).find((f) => f.wallId === wallId)!;
  return { history, baseLevelId, wallId, wall, frame, typeId };
}

describe('wall and opening editing', () => {
  it('changes actual stud centers to 24 inches and undoes the change', () => {
    const s = setup();
    const before = s.frame().members.filter((m) => m.kind === 'stud');
    expect(s.history.dispatch('wall.update', { wallIds: [s.wallId], changes: { studSpacing: 24 } }).ok).toBe(true);
    const after = s.frame().members.filter((m) => m.kind === 'stud');
    expect(after.length).toBeLessThan(before.length);
    expect(after[1]!.s0 - after[0]!.s0).toBe(24);
    s.history.undo();
    expect(s.frame().members).toContainEqual(before[1]);
  });

  it('edits only the chosen wall, preserves the original type and supports undo', () => {
    const s = setup();
    const original = s.history.doc.wallTypes[s.typeId]!;
    const layers = original.layers.slice(1);
    expect(s.history.dispatch('wall.assembly', { wallId: s.wallId, layers }).ok).toBe(true);
    expect(s.history.doc.wallTypes[s.typeId]).toEqual(original);
    expect(wallThickness(s.history.doc.wallTypes[s.wall().typeId]!)).toBe(6.4375);
    expect(s.history.dispatch('wall.assembly', { wallId: s.wallId, layers: [] }).ok).toBe(false);
    s.history.undo();
    expect(s.wall().typeId).toBe(s.typeId);
  });

  it('fills only cavities, counts insulation and preserves it through file validation', () => {
    const s = setup();
    s.history.dispatch('material.presets', undefined);
    const insulationId = Object.values(s.history.doc.materials).find((m) => m.name === 'Fiberglass batts')!.id;
    s.history.dispatch('wall.update', { wallIds: [s.wallId], changes: { insulationId } });
    const result = s.history.dispatch('opening.place', { wallId: s.wallId, t: 150, kind: 'window', width: 36, height: 48, sill: 32, style: 'fixed', side: 'left', hinge: 'start' });
    expect(result.ok).toBe(true);
    const opening = Object.values(s.history.doc.elements).find((e) => e.kind === 'window')!;
    if (opening.kind !== 'window') throw new Error('Missing window');
    const frame = s.frame();
    const cavities = insulationCavities(frame, [opening], 0);
    expect(cavities.length).toBeGreaterThan(0);
    for (const c of cavities) {
      for (const m of frame.members) expect(c.s0 < m.s1 && c.s1 > m.s0 && c.z0 < m.z1 && c.z1 > m.z0).toBe(false);
      expect(c.s0 < 168 && c.s1 > 132 && c.z0 < 80 && c.z1 > 32).toBe(false);
    }
    expect(buildPlanMeshes(s.history.doc).some((m) => m.materialId === insulationId)).toBe(true);
    expect(materialsList(s.history.doc).find((m) => m.name === 'Fiberglass batts')?.quantity).toBeCloseTo(cavities.reduce((n, c) => n + (c.s1-c.s0)*(c.z1-c.z0)/144, 0));
    expect(DocumentSchema.parse(s.history.doc).elements[s.wallId]).toMatchObject({ insulationId });
    expect(wallThickness(s.history.doc.wallTypes[s.wall().typeId]!)).toBe(7.1875);
  });

  it('places and resizes a garage door with plan symbol, panels and schedule', () => {
    const s = setup();
    const placed = s.history.dispatch('opening.place', { wallId: s.wallId, t: 180, kind: 'door', width: 108, height: 84, style: 'garage', side: 'left', hinge: 'start' });
    if (!placed.ok) throw new Error(placed.error);
    expect(s.history.dispatch('opening.update', { ids: [placed.value], changes: { width: 192 } }).ok).toBe(true);
    const door = s.history.doc.elements[placed.value] as Door;
    expect(openingPrims(computeWallGeometry(s.history.doc, s.baseLevelId).get(s.wallId)!, door).some((p) => p.t === 'arc')).toBe(false);
    expect(buildPlanMeshes(s.history.doc).find((m) => m.elementId === door.id)?.positions.length).toBeGreaterThan(0);
    expect(openingSchedule(s.history.doc, s.baseLevelId)[0]).toMatchObject({ style: 'Garage', width: 192 });
    expect(DocumentSchema.parse(s.history.doc).elements[door.id]).toMatchObject({ style: 'garage' });
    expect(s.history.dispatch('opening.update', { ids: [door.id], changes: { width: 500 } }).ok).toBe(false);
  });
});
