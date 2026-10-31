import { formatLength, type LengthFormat, type SnapKind, type SnapSettings } from '@framewright/core';
import { dispatch, setActiveLevel, useDocument } from '../document/store';
import { TOOL_LABELS, useEditor } from '../editor/store';

const UNIT_OPTIONS: { id: string; label: string; format: LengthFormat }[] = [
  { id: 'ft-in', label: `ft-in (1/16")`, format: { system: 'imperial', style: 'ft-in', denominator: 16 } },
  { id: 'in', label: `inches (1/16")`, format: { system: 'imperial', style: 'in', denominator: 16 } },
  { id: 'mm', label: 'mm', format: { system: 'metric', unit: 'mm', decimals: 0 } },
  { id: 'cm', label: 'cm', format: { system: 'metric', unit: 'cm', decimals: 1 } },
  { id: 'm', label: 'm', format: { system: 'metric', unit: 'm', decimals: 3 } },
];

const SNAP_TOGGLES: { key: keyof SnapSettings; label: string; title: string }[] = [
  { key: 'objects', label: 'Object', title: 'Snap to wall ends, midpoints, intersections and alignment' },
  { key: 'angles', label: 'Angle', title: 'Snap to 15° steps from the last point' },
  { key: 'grid', label: 'Grid', title: 'Snap to the grid' },
];

const SNAP_NAMES: Record<SnapKind, string> = {
  node: 'wall end',
  corner: 'corner',
  midpoint: 'midpoint',
  intersection: 'intersection',
  onWall: 'on wall',
  angle: 'angle',
  alignment: 'alignment',
  grid: 'grid',
  free: '',
};

function unitIdOf(format: LengthFormat): string {
  return format.system === 'imperial' ? format.style : format.unit;
}

export function StatusBar() {
  const doc = useDocument((s) => s.doc);
  const activeLevelId = useDocument((s) => s.activeLevelId);
  const { tool, cursor, snaps, snapKind, notice } = useEditor();
  const topDown = [...doc.levelOrder].reverse();
  const format = doc.settings.lengthFormat;

  return (
    <footer className="status-bar" aria-label="Status">
      <span className="status-item status-coords" data-testid="status-coords">
        {cursor ? `X ${formatLength(cursor.x, format)}  Y ${formatLength(cursor.y, format)}` : 'X —  Y —'}
      </span>
      <span className="status-item" data-testid="status-tool">
        {TOOL_LABELS[tool]}
      </span>
      {notice ? (
        <span className="status-item status-notice" role="status" data-testid="status-notice">
          {notice}
        </span>
      ) : (
        snapKind &&
        SNAP_NAMES[snapKind] && (
          <span className="status-item status-snap" data-testid="status-snap">
            Snap: {SNAP_NAMES[snapKind]}
          </span>
        )
      )}
      <span className="status-spacer" />
      <span className="status-item status-toggles" role="group" aria-label="Snaps">
        {SNAP_TOGGLES.map(({ key, label, title }) => (
          <button
            key={key}
            type="button"
            className="status-toggle"
            aria-pressed={snaps[key]}
            title={title}
            onClick={() => useEditor.setState({ snaps: { ...snaps, [key]: !snaps[key] } })}
          >
            {label}
          </button>
        ))}
      </span>
      <label className="status-item">
        Units
        <select
          className="status-select"
          aria-label="Display units"
          value={unitIdOf(format)}
          onChange={(e) => {
            const option = UNIT_OPTIONS.find((o) => o.id === e.target.value);
            if (option) dispatch('settings.update', { lengthFormat: option.format });
          }}
        >
          {UNIT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="status-item">
        Level
        <select className="status-select" aria-label="Active level" value={activeLevelId} onChange={(e) => setActiveLevel(e.target.value)}>
          {topDown.map((id) => (
            <option key={id} value={id}>
              {doc.levels[id]?.name}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
