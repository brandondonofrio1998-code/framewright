import { describe, expect, it } from 'vitest';
import {
  camerasIn,
  checkInvariants,
  loadDocument,
  partTexture,
  serializeDocument,
  TEXTURE_SCANS,
  tileInches,
  type PlanDocument,
  type SavedCamera,
} from '../../src';
import { testDocument, testHistory } from '../helpers';

function material(doc: PlanDocument, category: PlanDocument['materials'][string]['category']) {
  const found = Object.values(doc.materials).find((item) => item.category === category);
  if (!found) throw new Error(category);
  return found;
}

describe('texture sizes', () => {
  it('converts a published centimeter size into inches at file precision', () => {
    expect(tileInches([240, 120])).toEqual([94.488189, 47.244094]);
    expect(TEXTURE_SCANS['oak-floor']).toMatchObject({ asset: 'WoodFloor051', cm: [180, 180] });
  });

  it('records a texture on new wall materials and leaves sheathing untextured', () => {
    const doc = testDocument();
    expect(material(doc, 'drywall').texture).toEqual({ id: 'smooth-wall', tile: tileInches(TEXTURE_SCANS['smooth-wall'].cm) });
    expect(material(doc, 'framing').texture?.id).toBe('softwood');
    expect(material(doc, 'siding').texture?.id).toBe('wood-planks');
    expect(material(doc, 'sheathing').texture).toBeUndefined();
  });

  it('picks a map from the material, then the category, then the role', () => {
    const doc = testDocument();
    const gypsum = material(doc, 'drywall');
    const osb = material(doc, 'sheathing');
    expect(partTexture(doc, { materialId: gypsum.id, role: 'solid' })?.id).toBe('smooth-wall');
    expect(partTexture(doc, { materialId: osb.id, role: 'solid' })).toBeNull();
    expect(partTexture(doc, { materialId: null, role: 'floor' })?.id).toBe('oak-floor');
    expect(partTexture(doc, { materialId: null, role: 'panel' })?.id).toBe('softwood');
    expect(partTexture(doc, { materialId: null, role: 'glass' })).toBeNull();

    const bare: PlanDocument = {
      ...doc,
      materials: { ...doc.materials, [gypsum.id]: { id: gypsum.id, name: gypsum.name, category: gypsum.category, color: gypsum.color } },
    };
    expect(partTexture(bare, { materialId: gypsum.id, role: 'solid' })?.id).toBe('smooth-wall');
  });
});

const eye = { x: 10, y: 20, z: 66 };
const target = { x: 40, y: 20, z: 66 };

describe('saved cameras', () => {
  it('saves a view, suffixes a repeated name, and undo removes it', () => {
    const { history, baseLevelId } = testHistory();
    const first = history.dispatch('camera.save', { levelId: baseLevelId, name: '  Front door  ', mode: 'walk', eye, target });
    const second = history.dispatch('camera.save', { levelId: baseLevelId, name: 'Front door', mode: 'orbit', eye, target });
    expect(first.ok && second.ok).toBe(true);
    expect(camerasIn(history.doc).map((camera) => camera.name)).toEqual(['Front door', 'Front door 2']);
    expect(checkInvariants(history.doc)).toEqual([]);
    history.undo();
    history.undo();
    expect(camerasIn(history.doc)).toEqual([]);
  });

  it('rejects an empty name, a missing level, and a camera that looks nowhere', () => {
    const { history, baseLevelId } = testHistory();
    expect(history.dispatch('camera.save', { levelId: baseLevelId, name: '  ', mode: 'orbit', eye, target }).ok).toBe(false);
    expect(history.dispatch('camera.save', { levelId: 'missing', name: 'View', mode: 'orbit', eye, target }).ok).toBe(false);
    const same = history.dispatch('camera.save', { levelId: baseLevelId, name: 'View', mode: 'orbit', eye, target: eye });
    expect(same.ok).toBe(false);
    expect(camerasIn(history.doc)).toEqual([]);
  });

  it('saves an orthographic orbit and keeps a walk camera in perspective', () => {
    const { history, baseLevelId } = testHistory();
    const saved = history.dispatch('camera.save', { levelId: baseLevelId, name: 'Front', mode: 'orbit', eye, target, projection: 'orthographic', zoom: 4 });
    if (!saved.ok) throw new Error(saved.error);
    expect(camerasIn(history.doc)[0]).toMatchObject({ mode: 'orbit', projection: 'orthographic', zoom: 4 });
    const loaded = loadDocument(serializeDocument(history.doc));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(camerasIn(loaded.doc)[0]).toMatchObject({ projection: 'orthographic', zoom: 4 });
    expect(history.dispatch('camera.save', { levelId: baseLevelId, name: 'Walk', mode: 'walk', eye, target, projection: 'orthographic' }).ok).toBe(false);
  });

  it('drops a camera with no look direction on load, and deletes cameras with their level', () => {
    const doc = testDocument();
    const levelId = doc.levelOrder[0] as string;
    const broken: PlanDocument = {
      ...doc,
      elements: {
        cam: { id: 'cam', kind: 'camera', levelId, name: 'Bad', mode: 'orbit', eye, target: { ...eye } },
      },
    };
    const loaded = loadDocument(JSON.stringify(broken));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.repairs).toEqual(['Removed camera cam with no look direction']);
    expect(loaded.doc.elements.cam).toBeUndefined();

    const { history, baseLevelId } = testHistory();
    const added = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!added.ok) throw new Error(added.error);
    history.dispatch('camera.save', { levelId: added.value, name: 'Upstairs', mode: 'walk', eye, target });
    history.dispatch('level.delete', { id: added.value });
    expect(camerasIn(history.doc)).toEqual([]);
  });

  it('keeps a saved camera out of the plan geometry', () => {
    const { history, baseLevelId } = testHistory();
    history.dispatch('camera.save', { levelId: baseLevelId, name: 'View', mode: 'orbit', eye, target });
    const camera = camerasIn(history.doc)[0] as SavedCamera;
    expect(camera.kind).toBe('camera');
    expect(camera.mode).toBe('orbit');
  });
});
