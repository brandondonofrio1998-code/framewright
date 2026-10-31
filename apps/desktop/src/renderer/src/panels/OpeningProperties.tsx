import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import {
  DOOR_STYLES,
  formatLength,
  openingSpan,
  WINDOW_STYLES,
  type DoorStyle,
  type Opening,
  type OpeningChanges,
  type PlanDocument,
  type WindowStyle,
} from '@framewright/core';
import { dispatch } from '../document/store';
import { notify, useEditor } from '../editor/store';
import { LengthInput } from '../ui/LengthInput';

export const DOOR_STYLE_LABELS: Record<DoorStyle, string> = {
  hinged: 'Hinged',
  double: 'Double',
  pocket: 'Pocket',
  sliding: 'Sliding',
  bifold: 'Bifold',
  opening: 'Cased opening',
};

export const WINDOW_STYLE_LABELS: Record<WindowStyle, string> = {
  'double-hung': 'Double-hung',
  casement: 'Casement',
  slider: 'Slider',
  awning: 'Awning',
  fixed: 'Fixed',
};

const errorOf = (result: { ok: boolean; error?: string }) => (result.ok ? null : (result.error ?? 'Rejected'));

function StyleSelect({ kind, value, onChange, label }: { kind: Opening['kind']; value: string; onChange(style: string): void; label: string }) {
  const options = kind === 'door' ? DOOR_STYLES.map((s) => [s, DOOR_STYLE_LABELS[s]]) : WINDOW_STYLES.map((s) => [s, WINDOW_STYLE_LABELS[s]]);
  return (
    <select className="field-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  );
}

/** Properties of one selected door or window. */
export function OpeningProperties({ doc, opening, deleteButton }: { doc: PlanDocument; opening: Opening; deleteButton: React.ReactNode }) {
  const format = doc.settings.lengthFormat;
  const ids = [opening.id];
  const update = (changes: OpeningChanges) => errorOf(dispatch('opening.update', { ids, changes }));
  const noun = opening.kind === 'door' ? 'Door' : 'Window';
  const head = opening.kind === 'window' ? opening.sill + opening.height : opening.height;
  const hinged = opening.kind === 'door' ? opening.style !== 'opening' && opening.style !== 'sliding' : opening.style === 'casement';

  return (
    <>
      <h3 className="panel-heading">{noun}</h3>
      <dl className="level-fields">
        <dt>Style</dt>
        <dd>
          <StyleSelect
            kind={opening.kind}
            label={`${noun} style`}
            value={opening.style}
            onChange={(style) => notify(update(opening.kind === 'door' ? { doorStyle: style as DoorStyle } : { windowStyle: style as WindowStyle }))}
          />
        </dd>
        <dt>Width</dt>
        <dd>
          <LengthInput label={`${noun} width`} value={opening.width} format={format} onCommit={(width) => update({ width })} />
        </dd>
        <dt>Height</dt>
        <dd>
          <LengthInput label={`${noun} height`} value={opening.height} format={format} onCommit={(height) => update({ height })} />
        </dd>
        {opening.kind === 'window' && (
          <>
            <dt>Sill</dt>
            <dd>
              <LengthInput label="Sill height" value={opening.sill} format={format} onCommit={(sill) => update({ sill })} />
            </dd>
          </>
        )}
        <dt>Head</dt>
        <dd>
          <span className="field-readonly">{formatLength(head, format)}</span>
        </dd>
        <dt>From start</dt>
        <dd>
          <LengthInput
            label="Distance from wall start"
            value={openingSpan(opening)[0]}
            format={format}
            onCommit={(v) => errorOf(dispatch('opening.move', { id: opening.id, wallId: opening.wallId, t: v + opening.width / 2 }))}
          />
        </dd>
      </dl>
      <div className="panel-actions">
        <button type="button" className="text-button" onClick={() => notify(update({ side: opening.side === 'left' ? 'right' : 'left' }))}>
          <FlipVertical2 size={14} aria-hidden /> Flip Side
        </button>
        {hinged && (
          <button type="button" className="text-button" onClick={() => notify(update({ hinge: opening.hinge === 'start' ? 'end' : 'start' }))}>
            <FlipHorizontal2 size={14} aria-hidden /> Flip Hinge
          </button>
        )}
        {deleteButton}
      </div>
    </>
  );
}

/** What the Doors or Windows tool places next. */
export function OpeningToolDefaults({ kind, doc }: { kind: Opening['kind']; doc: PlanDocument }) {
  const format = doc.settings.lengthFormat;
  const door = useEditor((s) => s.doorDefaults);
  const win = useEditor((s) => s.windowDefaults);
  const positive = (v: number) => (v > 0 ? null : 'Must be greater than zero.');
  const setDoor = (changes: Partial<typeof door>) => useEditor.setState({ doorDefaults: { ...door, ...changes } });
  const setWindow = (changes: Partial<typeof win>) => useEditor.setState({ windowDefaults: { ...win, ...changes } });
  const noun = kind === 'door' ? 'Door' : 'Window';
  const values = kind === 'door' ? door : win;
  const setSize = (changes: { width?: number; height?: number }) => {
    if (kind === 'door') setDoor(changes);
    else setWindow(changes);
    return null;
  };
  const setSill = (sill: number) => {
    if (sill < 0) return 'Must be zero or more.';
    setWindow({ sill });
    return null;
  };

  return (
    <>
      <h3 className="panel-heading">{noun}s tool</h3>
      <dl className="level-fields">
        <dt>Style</dt>
        <dd>
          <StyleSelect
            kind={kind}
            label={`${noun} style to place`}
            value={values.style}
            onChange={(style) => (kind === 'door' ? setDoor({ style: style as DoorStyle }) : setWindow({ style: style as WindowStyle }))}
          />
        </dd>
        <dt>Width</dt>
        <dd>
          <LengthInput
            label={`${noun} width to place`}
            value={values.width}
            format={format}
            onCommit={(width) => positive(width) ?? setSize({ width })}
          />
        </dd>
        <dt>Height</dt>
        <dd>
          <LengthInput
            label={`${noun} height to place`}
            value={values.height}
            format={format}
            onCommit={(height) => positive(height) ?? setSize({ height })}
          />
        </dd>
        {kind === 'window' && (
          <>
            <dt>Sill</dt>
            <dd>
              <LengthInput
                label="Sill height to place"
                value={win.sill}
                format={format}
                onCommit={setSill}
              />
            </dd>
          </>
        )}
      </dl>
      <p className="panel-hint">
        {kind === 'door'
          ? 'Hover a wall and click to place. The door swings toward the side you click on.'
          : 'Hover a wall and click to place. The sill goes on the outside of the plan; use Flip Side if it guessed wrong.'}{' '}
        Esc returns to Select Objects.
      </p>
    </>
  );
}
