import type { LengthFormat } from '@framewright/core';
import { dispatch, setActiveLevel, useDocument } from '../document/store';

const UNIT_OPTIONS: { id: string; label: string; format: LengthFormat }[] = [
  { id: 'ft-in', label: `ft-in (1/16")`, format: { system: 'imperial', style: 'ft-in', denominator: 16 } },
  { id: 'in', label: `inches (1/16")`, format: { system: 'imperial', style: 'in', denominator: 16 } },
  { id: 'mm', label: 'mm', format: { system: 'metric', unit: 'mm', decimals: 0 } },
  { id: 'cm', label: 'cm', format: { system: 'metric', unit: 'cm', decimals: 1 } },
  { id: 'm', label: 'm', format: { system: 'metric', unit: 'm', decimals: 3 } },
];

function unitIdOf(format: LengthFormat): string {
  return format.system === 'imperial' ? format.style : format.unit;
}

export function StatusBar() {
  const doc = useDocument((s) => s.doc);
  const activeLevelId = useDocument((s) => s.activeLevelId);
  const topDown = [...doc.levelOrder].reverse();
  const currentUnit = unitIdOf(doc.settings.lengthFormat);

  return (
    <footer className="status-bar" aria-label="Status">
      <span className="status-item" data-testid="status-coords">X —  Y —</span>
      <span className="status-item" data-testid="status-tool">No tool</span>
      <span className="status-item" data-testid="status-snap">Snaps: off</span>
      <span className="status-spacer" />
      <label className="status-item">
        Units
        <select
          className="status-select"
          aria-label="Display units"
          value={currentUnit}
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
