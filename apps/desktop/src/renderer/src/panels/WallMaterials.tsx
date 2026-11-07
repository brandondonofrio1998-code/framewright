import { formatLength, type PlanDocument, type Wall, type WallLayer } from '@framewright/core';
import { dispatch } from '../document/store';
import { notify } from '../editor/store';
import { LengthInput } from '../ui/LengthInput';

export function WallMaterials({ doc, wall }: { doc: PlanDocument; wall: Wall }) {
  const type = doc.wallTypes[wall.typeId]!;
  const format = doc.settings.lengthFormat;
  const setLayers = (layers: WallLayer[]) => {
    const result = dispatch('wall.assembly', { wallId: wall.id, layers });
    return result.ok ? null : result.error;
  };
  const materials = Object.values(doc.materials);
  const structure = type.layers.find((layer) => layer.fn === 'structure');
  return <section className="wall-materials" aria-label="Wall materials">
    <h3 className="panel-heading">Materials & framing</h3>
    <p className="panel-hint">Framing depth: {formatLength(structure?.thickness ?? 0, format)}. A nominal 2×6 is 1½″ × 5½″; a 2×4 is 1½″ × 3½″. Overall thickness includes every layer below.</p>
    <label className="field-stack">Stud spacing
      <select className="field-input" aria-label="Stud spacing" value={wall.studSpacing ?? 16} onChange={(e) => {
        const result = dispatch('wall.update', { wallIds: [wall.id], changes: { studSpacing: Number(e.target.value) as 16 | 24 } });
        notify(result.ok ? null : result.error);
      }}><option value={16}>16″ on center</option><option value={24}>24″ on center</option></select>
    </label>
    <p className="panel-hint">Layers run from the left side to the right side of the wall's drawing direction. If siding faces the room, flip material sides. Changes affect this wall only.</p>
    <button type="button" className="text-button" onClick={() => notify(setLayers([...type.layers].reverse()))}>Flip material sides</button>
    {type.layers.map((layer, index) => <div className="wall-layer-editor" key={index}>
      <label className="field-stack">Layer {index + 1} · {layer.fn}
        <select className="field-input" aria-label={`Layer ${index + 1} material`} value={layer.materialId} onChange={(e) => notify(setLayers(type.layers.map((l, i) => i === index ? { ...l, materialId: e.target.value } : l)))}>
          {materials.filter((m) => layer.fn !== 'structure' || m.category === 'framing').map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="field-stack">Thickness
        <LengthInput label={`Layer ${index + 1} thickness`} value={layer.thickness} format={format} onCommit={(thickness) => setLayers(type.layers.map((l, i) => i === index ? { ...l, thickness } : l))} />
      </label>
      {layer.fn !== 'structure' && <button type="button" className="text-button" aria-label={`Remove layer ${index + 1}`} onClick={() => notify(setLayers(type.layers.filter((_, i) => i !== index)))}>Remove layer</button>}
    </div>)}
    <label className="field-stack">Add a layer on the right side
      <select className="field-input" aria-label="Add wall layer" value="" onChange={(e) => {
        const material = doc.materials[e.target.value];
        if (!material) return;
        const fn = material.category === 'insulation' ? 'insulation' : material.category === 'sheathing' ? 'sheathing' : 'finish';
        notify(setLayers([...type.layers, { materialId: material.id, thickness: material.category === 'insulation' ? 1 : 0.5, fn }]));
      }}><option value="">Choose material…</option>{materials.filter((m) => m.category !== 'framing').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
    </label>
    <label className="field-stack">Cavity insulation (between studs)
      <select className="field-input" aria-label="Cavity insulation" value={wall.insulationId ?? ''} onChange={(e) => {
        const result = dispatch('wall.update', { wallIds: [wall.id], changes: { insulationId: e.target.value || null } });
        notify(result.ok ? null : result.error);
      }}><option value="">None</option>{materials.filter((m) => m.category === 'insulation').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
    </label>
    <button type="button" className="text-button" onClick={() => { const r = dispatch('material.presets', undefined); notify(r.ok ? null : r.error); }}>Add insulation & material choices</button>
    <p className="panel-hint">Use the 3D wall display control to expose framing and utilities without removing materials from the plan. Removed layers change quantities; Undo restores them.</p>
  </section>;
}
