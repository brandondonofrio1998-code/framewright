import { Trash2 } from 'lucide-react';
import {
  angleOf,
  defaultWallHeight,
  distance,
  formatArea,
  formatLength,
  isOpening,
  objectSize,
  ROOM_TYPES,
  resolveDimensionEnd,
  roomFace,
  starterById,
  sub,
  wallThickness,
  type CatalogObject,
  type Id,
  type PlanDocument,
  type Room,
  type RoomType,
  type Wall,
} from '@framewright/core';
import { dispatch, useDocument } from '../document/store';
import { activeWallTypeId, notify, useEditor } from '../editor/store';
import { LengthInput, TextInput } from '../ui/LengthInput';
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

const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  unspecified: 'Unspecified',
  living: 'Living',
  kitchen: 'Kitchen',
  dining: 'Dining',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  hall: 'Hall',
  closet: 'Closet',
  garage: 'Garage',
  utility: 'Utility',
  other: 'Other',
};

function RoomProperties({ doc, room }: { doc: PlanDocument; room: Room }) {
  const format = doc.settings.lengthFormat;
  const face = roomFace(doc, room);
  const level = doc.levels[room.levelId];
  const auto = room.ceilingHeight === null;
  const height = room.ceilingHeight ?? level?.ceilingHeight ?? 96;
  return (
    <>
      <h3 className="panel-heading">Room</h3>
      <dl className="level-fields">
        <dt>Name</dt>
        <dd>
          <TextInput label="Room name" value={room.name} onCommit={(name) => errorOf(dispatch('room.update', { id: room.id, name }))} />
        </dd>
        <dt>Type</dt>
        <dd>
          <select className="field-input" aria-label="Room type" value={room.roomType} onChange={(e) => notify(errorOf(dispatch('room.update', { id: room.id, roomType: e.target.value as RoomType })))}>
            {ROOM_TYPES.map((type) => (
              <option key={type} value={type}>
                {ROOM_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </dd>
        <dt>Area</dt>
        <dd>
          <span className="field-readonly">{face ? formatArea(face.area) : '—'}</span>
        </dd>
        <dt>Ceiling</dt>
        <dd className="field-stack">
          <LengthInput label="Ceiling height" value={height} format={format} disabled={auto} onCommit={(v) => errorOf(dispatch('room.update', { id: room.id, ceilingHeight: v }))} />
          <label className="field-check">
            <input type="checkbox" checked={auto} onChange={(e) => notify(errorOf(dispatch('room.update', { id: room.id, ceilingHeight: e.target.checked ? null : height })))} />
            From level
          </label>
        </dd>
      </dl>
    </>
  );
}

function ObjectProperties({ doc, object }: { doc: PlanDocument; object: CatalogObject }) {
  const format = doc.settings.lengthFormat;
  const def = doc.catalogDefs[object.defId];
  const size = objectSize(doc, object);
  const setParam = (key: 'width' | 'depth' | 'height', value: number) => errorOf(dispatch('object.update', { id: object.id, params: { [key]: value } }));
  return (
    <>
      <h3 className="panel-heading">{def?.name ?? 'Object'}</h3>
      <dl className="level-fields">
        <dt>Width</dt>
        <dd>
          <LengthInput label="Object width" value={size.width} format={format} onCommit={(v) => setParam('width', v)} />
        </dd>
        <dt>Depth</dt>
        <dd>
          <LengthInput label="Object depth" value={size.depth} format={format} onCommit={(v) => setParam('depth', v)} />
        </dd>
        <dt>Height</dt>
        <dd>
          <LengthInput label="Object height" value={size.height} format={format} onCommit={(v) => setParam('height', v)} />
        </dd>
        <dt>Elevation</dt>
        <dd>
          <LengthInput label="Object elevation" value={object.z} format={format} onCommit={(z) => errorOf(dispatch('object.update', { id: object.id, z }))} />
        </dd>
      </dl>
      <div className="panel-actions">
        {object.hostWallId && object.side && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (!object.hostWallId || object.hostT === undefined || !object.side) return;
              notify(
                errorOf(
                  dispatch('object.move', {
                    id: object.id,
                    p: object.p,
                    rotation: object.rotation,
                    hostWallId: object.hostWallId,
                    hostT: object.hostT,
                    side: object.side === 'left' ? 'right' : 'left',
                  }),
                ),
              );
            }}
          >
            Flip Side
          </button>
        )}
        <DeleteButton ids={[object.id]} />
      </div>
    </>
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
  const armedCatalogId = useEditor((s) => s.armedCatalogId);
  useEditor((s) => s.wallTypeId);
  const format = doc.settings.lengthFormat;
  const elements = selection.map((id) => doc.elements[id]).filter((el) => el !== undefined);
  const walls = elements.filter((el) => el.kind === 'wall');

  if (elements.length === 0) {
    const typeId = activeWallTypeId();
    return (
      <div className="panel properties-panel">
        {tool === 'objects' ? (
          <>
            <h3 className="panel-heading">Objects</h3>
            <p className="panel-hint">
              {armedCatalogId ? `Placing ${starterById(armedCatalogId)?.name ?? 'an item'}. Click the side of a wall it should sit on.` : 'Pick an item in the Library, then click a wall.'} Esc returns to
              Select Objects.
            </p>
          </>
        ) : tool === 'doors' || tool === 'windows' ? (
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
  if (elements.length === 1 && only?.kind === 'room') {
    return (
      <div className="panel properties-panel">
        <RoomProperties doc={doc} room={only} />
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'object') {
    return (
      <div className="panel properties-panel">
        <ObjectProperties doc={doc} object={only} />
      </div>
    );
  }
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
