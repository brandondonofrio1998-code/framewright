import { Trash2 } from 'lucide-react';
import {
  angleOf,
  defaultWallHeight,
  distance,
  formatLength,
  isOpening,
  resolveDimensionEnd,
  sub,
  wallThickness,
  type Id,
  type PlanDocument,
  type Wall,
} from '@framewright/core';
import { dispatch, useDocument } from '../document/store';
import { activeWallTypeId, notify, useEditor } from '../editor/store';
import { LengthInput } from '../ui/LengthInput';
import { OpeningProperties, OpeningToolDefaults } from './OpeningProperties';

const errorOf = (result: { ok: boolean; error?: string }) => (result.ok ? null : (result.error ?? 'Rejected'));

const wallHeightDefault = (doc: PlanDocument, wall: Wall) => defaultWallHeight(doc.levels, doc.levelOrder, wall.levelId);

function WallTypeSelect({ value, onChange, label }: { value: Id; onChange(id: Id): void; label: string }) {
  const types = useDocument((s) => s.doc.wallTypes);
  return (
    <select className="field-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.values(types).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} ({formatLength(wallThickness(t), { system: 'imperial', style: 'in', denominator: 16 })})
        </option>
      ))}
    </select>
  );
}

function DeleteButton({ ids }: { ids: Id[] }) {
  return (
    <button type="button" className="text-button" onClick={() => notify(errorOf(dispatch('elements.delete', { ids })))}>
      <Trash2 size={14} aria-hidden /> Delete
    </button>
  );
}

function SingleWall({ doc, wall }: { doc: PlanDocument; wall: Wall }) {
  const format = doc.settings.lengthFormat;
  const a = doc.elements[wall.a];
  const b = doc.elements[wall.b];
  const type = doc.wallTypes[wall.typeId];
  if (a?.kind !== 'wallNode' || b?.kind !== 'wallNode' || !type) return null;
  const length = distance(a.p, b.p);
  const angle = ((angleOf(sub(b.p, a.p)) * 180) / Math.PI + 360) % 360;
  const auto = wall.height === null;
  const height = wall.height ?? wallHeightDefault(doc, wall);

  return (
    <>
      <h3 className="panel-heading">Wall</h3>
      <dl className="level-fields">
        <dt>Type</dt>
        <dd>
          <WallTypeSelect label="Wall type" value={wall.typeId} onChange={(typeId) => notify(errorOf(dispatch('wall.update', { wallIds: [wall.id], changes: { typeId } })))} />
        </dd>
        <dt>Length</dt>
        <dd>
          <LengthInput label="Wall length" value={length} format={format} onCommit={(v) => errorOf(dispatch('wall.setLength', { wallId: wall.id, length: v }))} />
        </dd>
        <dt>Thickness</dt>
        <dd>
          <span className="field-readonly">{formatLength(wallThickness(type), format)}</span>
        </dd>
        <dt>Height</dt>
        <dd className="field-stack">
          <LengthInput
            label="Wall height"
            value={height}
            format={format}
            disabled={auto}
            onCommit={(v) => errorOf(dispatch('wall.update', { wallIds: [wall.id], changes: { height: v } }))}
          />
          <label className="field-check">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) =>
                notify(errorOf(dispatch('wall.update', { wallIds: [wall.id], changes: { height: e.target.checked ? null : height } })))
              }
            />
            From level
          </label>
        </dd>
        <dt>Base offset</dt>
        <dd>
          <LengthInput label="Base offset" value={wall.baseOffset} format={format} onCommit={(v) => errorOf(dispatch('wall.update', { wallIds: [wall.id], changes: { baseOffset: v } }))} />
        </dd>
        <dt>Angle</dt>
        <dd>
          <span className="field-readonly">{angle.toFixed(1)}°</span>
        </dd>
      </dl>
      <div className="panel-actions">
        <DeleteButton ids={[wall.id]} />
      </div>
    </>
  );
}

export function PropertiesPanel() {
  const doc = useDocument((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  useEditor((s) => s.wallTypeId);
  const format = doc.settings.lengthFormat;
  const elements = selection.map((id) => doc.elements[id]).filter((el) => el !== undefined);
  const walls = elements.filter((el) => el.kind === 'wall');

  if (elements.length === 0) {
    const typeId = activeWallTypeId();
    return (
      <div className="panel properties-panel">
        {tool === 'doors' || tool === 'windows' ? (
          <OpeningToolDefaults kind={tool === 'doors' ? 'door' : 'window'} doc={doc} />
        ) : tool === 'walls' && typeId ? (
          <>
            <h3 className="panel-heading">Walls tool</h3>
            <dl className="level-fields">
              <dt>Draw with</dt>
              <dd>
                <WallTypeSelect label="Wall type to draw" value={typeId} onChange={(id) => useEditor.setState({ wallTypeId: id })} />
              </dd>
            </dl>
            <p className="panel-hint">Click to place corners, or type a length (Tab for an angle) and press Enter. Esc ends the run.</p>
          </>
        ) : (
          <p className="panel-hint">Nothing selected. Click a wall, door, window or dimension in the plan to see its properties.</p>
        )}
      </div>
    );
  }

  if (elements.length === 1 && walls.length === 1) {
    return (
      <div className="panel properties-panel">
        <SingleWall doc={doc} wall={walls[0]!} />
      </div>
    );
  }

  const only = elements[0];
  if (elements.length === 1 && isOpening(only)) {
    return (
      <div className="panel properties-panel">
        <OpeningProperties doc={doc} opening={only} deleteButton={<DeleteButton ids={[only.id]} />} />
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'dimension') {
    const a = resolveDimensionEnd(doc, only.a);
    const b = resolveDimensionEnd(doc, only.b);
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Dimension</h3>
        <dl className="level-fields">
          <dt>Measures</dt>
          <dd>
            <span className="field-readonly">{formatLength(distance(a, b), format)}</span>
          </dd>
          <dt>Offset</dt>
          <dd>
            <LengthInput label="Dimension offset" value={only.offset} format={format} onCommit={(v) => errorOf(dispatch('dimension.update', { id: only.id, offset: v }))} />
          </dd>
        </dl>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }

  const sharedType = walls.length > 0 && walls.every((w) => w.typeId === walls[0]!.typeId) ? walls[0]!.typeId : null;
  return (
    <div className="panel properties-panel">
      <h3 className="panel-heading">{elements.length} items selected</h3>
      {walls.length > 0 && (
        <dl className="level-fields">
          <dt>Wall type</dt>
          <dd>
            <WallTypeSelect
              label="Wall type"
              value={sharedType ?? ''}
              onChange={(typeId) => notify(errorOf(dispatch('wall.update', { wallIds: walls.map((w) => w.id), changes: { typeId } })))}
            />
          </dd>
        </dl>
      )}
      <div className="panel-actions">
        <DeleteButton ids={elements.map((el) => el.id)} />
      </div>
    </div>
  );
}
