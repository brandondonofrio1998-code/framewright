import { Trash2 } from 'lucide-react';
import {
  angleOf,
  defaultWallHeight,
  distance,
  formatArea,
  formatLength,
  isOpening,
  lotArea,
  lotPerimeter,
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
  if (elements.length === 1 && only?.kind === 'cad') {
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Imported drawing</h3>
        <p className="panel-hint">{only.name ?? 'DXF'}. {only.prims.length} items. This is a reference, so it does not become walls.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
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
  if (elements.length === 1 && only?.kind === 'roofPlane') {
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Roof</h3>
        <dl className="level-fields">
          <dt>Pitch</dt>
          <dd>
            <span className="field-readonly">{only.pitch} in 12</span>
          </dd>
        </dl>
        <p className="panel-hint">One slope of the roof. It follows the walls while the room stays a rectangle.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'foundation') {
    const format = doc.settings.lengthFormat;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Foundation</h3>
        <dl className="level-fields">
          <dt>Slab</dt>
          <dd>
            <span className="field-readonly">{formatLength(only.thickness, format)}</span>
          </dd>
          <dt>Stem wall</dt>
          <dd>
            <span className="field-readonly">{only.stemThickness === undefined ? 'None' : formatLength(only.stemThickness, format)}</span>
          </dd>
          <dt>Above the floor</dt>
          <dd>
            <LengthInput
              label="Above the floor"
              value={only.stemRise ?? 0}
              format={format}
              onCommit={(v) => errorOf(dispatch('foundation.setRise', { id: only.id, stemRise: v }))}
            />
          </dd>
          <dt>Under the floor</dt>
          <dd>
            <LengthInput
              label="Under the floor"
              value={only.clearance ?? 0}
              format={format}
              onCommit={(v) => errorOf(dispatch('foundation.setClearance', { id: only.id, clearance: v }))}
            />
          </dd>
          <dt>Footing</dt>
          <dd>
            <span className="field-readonly">
              {formatLength(only.footingWidth, format)} wide, {formatLength(only.footingDepth, format)} deep
            </span>
          </dd>
        </dl>
        <p className="panel-hint">The stem can continue above the floor, and the slab can drop to leave a basement under it. A deep enough rectangle or L gets 2x10 joists. Build the foundation again after the walls change.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'stair') {
    const format = doc.settings.lengthFormat;
    const upstairs = doc.levels[only.toLevelId]?.name ?? 'the level above';
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Stairs</h3>
        <dl className="level-fields">
          <dt>Risers</dt>
          <dd>
            <span className="field-readonly">
              {only.risers} at {formatLength(only.riser, format)}
            </span>
          </dd>
          <dt>Tread</dt>
          <dd>
            <span className="field-readonly">{formatLength(only.tread, format)}</span>
          </dd>
          <dt>Width</dt>
          <dd>
            <span className="field-readonly">{formatLength(only.width, format)}</span>
          </dd>
          <dt>Up to</dt>
          <dd>
            <span className="field-readonly">{upstairs}</span>
          </dd>
        </dl>
        <p className="panel-hint">Risers and treads follow IRC 2021. The floor and ceiling open along the flight, and the opening runs past the top for headroom.</p>
        {only.landing && !only.landing.side ? (
          <label className="section-cut">
            <input
              type="checkbox"
              checked={only.landing.winders === true}
              onChange={(event) => notify(errorOf(dispatch('stair.winders', { id: only.id, winders: event.target.checked })))}
            />
            Winders
          </label>
        ) : null}
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'deck') {
    const format = doc.settings.lengthFormat;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Deck</h3>
        <dl className="level-fields">
          <dt>Along the wall</dt>
          <dd>
            <span className="field-readonly">{formatLength(only.width, format)}</span>
          </dd>
          <dt>Out from the wall</dt>
          <dd>
            <span className="field-readonly">{formatLength(only.depth, format)}</span>
          </dd>
        </dl>
        <p className="panel-hint">2x8 joists span the short side. Posts, a top rail, and balusters run the open sides. A lot below the floor gets a stair down the middle of the outer edge. The deck stays where it was built.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'electrical') {
    const format = doc.settings.lengthFormat;
    const height = only.device === 'light' ? null : only.device === 'switch' ? 48 : 18;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Electrical</h3>
        <dl className="level-fields">
          <dt>Device</dt>
          <dd>
            {only.device === 'light' ? (
              <span className="field-readonly">Light</span>
            ) : (
              <select
                aria-label="Device"
                className="status-select"
                value={only.device}
                onChange={(event) => {
                  const device = event.target.value === 'switch' ? 'switch' : 'receptacle';
                  notify(errorOf(dispatch('electrical.setDevice', { id: only.id, device })));
                }}
              >
                <option value="receptacle">Receptacle</option>
                <option value="switch">Switch</option>
              </select>
            )}
          </dd>
          <dt>Circuit</dt>
          <dd>
            <select
              aria-label="Circuit"
              className="status-select"
              value={only.circuit ?? ''}
              onChange={(event) => {
                const circuit = event.target.value === '' ? null : Number(event.target.value);
                notify(errorOf(dispatch('electrical.setCircuit', { id: only.id, circuit })));
              }}
            >
              <option value="">None</option>
              {Array.from({ length: 20 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </dd>
          <dt>Height</dt>
          <dd>
            <span className="field-readonly">{height === null ? 'Ceiling' : `${formatLength(height, format)} to center`}</span>
          </dd>
        </dl>
        <p className="panel-hint">A receptacle is 18 inches to center and a switch is 48 inches. A light sits on the ceiling. Devices on the same circuit share a number from 1 to 20. Wall devices stay where they were placed.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'plumbing') {
    const format = doc.settings.lengthFormat;
    const onWall = only.hostWallId !== undefined;
    const height = !onWall ? null : only.fixture === 'supply' ? 20 : 12;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Plumbing</h3>
        <dl className="level-fields">
          <dt>Fixture</dt>
          <dd>
            {onWall ? (
              <select
                aria-label="Fixture"
                className="status-select"
                value={only.fixture}
                onChange={(event) => {
                  const fixture = event.target.value === 'drain' ? 'drain' : 'supply';
                  notify(errorOf(dispatch('plumbing.setFixture', { id: only.id, fixture })));
                }}
              >
                <option value="supply">Supply</option>
                <option value="drain">Drain</option>
              </select>
            ) : (
              <span className="field-readonly">Floor drain</span>
            )}
          </dd>
          <dt>Height</dt>
          <dd>
            <span className="field-readonly">{height === null ? 'Floor' : `${formatLength(height, format)} to center`}</span>
          </dd>
        </dl>
        <p className="panel-hint">A supply is a hot and cold pair at 20 inches. A wall drain is at 12 inches. A floor drain sits on the floor. Wall fixtures stay where they were placed.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'site') {
    if (only.role === 'contour' && only.points) {
      const format = doc.settings.lengthFormat;
      return (
        <div className="panel properties-panel">
          <h3 className="panel-heading">Contour</h3>
          <dl className="level-fields">
            <dt>Area</dt>
            <dd>
              <span className="field-readonly">{formatArea(lotArea(only.points))}</span>
            </dd>
            <dt>Grade</dt>
            <dd>
              <LengthInput label="Grade" value={only.grade ?? 0} format={format} onCommit={(grade) => errorOf(dispatch('site.grade', { id: only.id, grade }))} />
            </dd>
          </dl>
          <p className="panel-hint">A contour is a flat terrace, 2 inches thick. It does not slope the property.</p>
          <div className="panel-actions">
            <DeleteButton ids={[only.id]} />
          </div>
        </div>
      );
    }
    if (only.role === 'lot' && only.points) {
      const format = doc.settings.lengthFormat;
      return (
        <div className="panel properties-panel">
          <h3 className="panel-heading">Property line</h3>
          <dl className="level-fields">
            <dt>Area</dt>
            <dd>
              <span className="field-readonly">{formatArea(lotArea(only.points))}</span>
            </dd>
            <dt>Perimeter</dt>
            <dd>
              <span className="field-readonly">{formatLength(lotPerimeter(only.points), format)}</span>
            </dd>
          </dl>
          <p className="panel-hint">The property line is a plan mark. North on the plan points up.</p>
          <label className="section-cut">
            <input
              type="checkbox"
              checked={only.grade !== undefined}
              onChange={(event) => notify(errorOf(dispatch('site.grade', { id: only.id, grade: event.target.checked ? 0 : null })))}
            />
            Ground in 3D
          </label>
          {only.grade !== undefined && (
            <dl className="level-fields">
              <dt>Grade</dt>
              <dd>
                <LengthInput label="Grade" value={only.grade} format={format} onCommit={(grade) => errorOf(dispatch('site.grade', { id: only.id, grade }))} />
              </dd>
            </dl>
          )}
          <div className="panel-actions">
            <DeleteButton ids={[only.id]} />
          </div>
        </div>
      );
    }
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">North</h3>
        <p className="panel-hint">The arrow points up the plan.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'plant') {
    const format = doc.settings.lengthFormat;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Tree</h3>
        <dl className="level-fields">
          <dt>Canopy radius</dt>
          <dd>
            <LengthInput label="Canopy radius" value={only.radius} format={format} onCommit={(radius) => errorOf(dispatch('plant.update', { id: only.id, radius }))} />
          </dd>
          <dt>Height</dt>
          <dd>
            <LengthInput label="Tree height" value={only.height} format={format} onCommit={(height) => errorOf(dispatch('plant.update', { id: only.id, height }))} />
          </dd>
        </dl>
        <p className="panel-hint">A new tree is 16 feet across and 20 feet tall. The trunk and the canopy are simple solids.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'pipe') {
    const format = doc.settings.lengthFormat;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Pipe</h3>
        <dl className="level-fields">
          <dt>Run</dt>
          <dd>
            <select
              aria-label="Pipe"
              className="status-select"
              value={only.service}
              onChange={(event) => {
                const service = event.target.value === 'drain' ? 'drain' : 'supply';
                notify(errorOf(dispatch('pipe.service', { id: only.id, service })));
              }}
            >
              <option value="supply">Supply</option>
              <option value="drain">Drain</option>
            </select>
          </dd>
          <dt>Length</dt>
          <dd>
            <span className="field-readonly">{formatLength(distance(only.a, only.b), format)}</span>
          </dd>
        </dl>
        <p className="panel-hint">A supply is 3/4 inch, centered 20 inches above the floor. A drain is 2 inches, centered 12 inches above the floor.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'road') {
    const format = doc.settings.lengthFormat;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Driveway</h3>
        <dl className="level-fields">
          <dt>Length</dt>
          <dd>
            <span className="field-readonly">{formatLength(distance(only.a, only.b), format)}</span>
          </dd>
          <dt>Width</dt>
          <dd>
            <LengthInput label="Driveway width" value={only.width} format={format} onCommit={(width) => errorOf(dispatch('road.width', { id: only.id, width }))} />
          </dd>
          <dt>Drop</dt>
          <dd>
            <LengthInput label="Drop" value={only.fall ?? 0} format={format} onCommit={(fall) => errorOf(dispatch('road.fall', { id: only.id, fall }))} />
          </dd>
        </dl>
        <p className="panel-hint">Leave Drop at zero and a graded lot sets the height of each end. A number drops or lifts the far end by up to 8 feet. The slab is 4 inches thick.</p>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
      </div>
    );
  }
  if (elements.length === 1 && only?.kind === 'text') {
    const format = doc.settings.lengthFormat;
    return (
      <div className="panel properties-panel">
        <h3 className="panel-heading">Text</h3>
        <dl className="level-fields">
          <dt>Note</dt>
          <dd>
            <TextInput label="Note" value={only.text} onCommit={(text) => errorOf(dispatch('text.update', { id: only.id, text }))} />
          </dd>
          <dt>Height</dt>
          <dd>
            <LengthInput label="Text height" value={only.size} format={format} onCommit={(size) => errorOf(dispatch('text.update', { id: only.id, size }))} />
          </dd>
          <dt>Angle</dt>
          <dd>
            <TextInput
              label="Angle"
              value={String(Math.round((((only.rot ?? 0) * 180) / Math.PI) * 10) / 10)}
              onCommit={(raw) => {
                const degrees = Number(raw);
                if (!Number.isFinite(degrees)) return 'Enter the angle in degrees.';
                return errorOf(dispatch('text.update', { id: only.id, rot: (degrees * Math.PI) / 180 }));
              }}
            />
          </dd>
        </dl>
        <div className="panel-actions">
          <DeleteButton ids={[only.id]} />
        </div>
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
