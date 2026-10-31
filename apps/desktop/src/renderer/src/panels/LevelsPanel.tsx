import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { formatLength, type Id, type LevelChanges } from '@framewright/core';
import { dispatch, setActiveLevel, useDocument } from '../document/store';
import { LengthInput, TextInput } from '../ui/LengthInput';

const errorOf = (result: { ok: boolean; error?: string }) => (result.ok ? null : (result.error ?? 'Rejected'));

function update(id: Id, changes: LevelChanges): string | null {
  return errorOf(dispatch('level.update', { id, changes }));
}

export function LevelsPanel() {
  const doc = useDocument((s) => s.doc);
  const activeLevelId = useDocument((s) => s.activeLevelId);
  const format = doc.settings.lengthFormat;
  const topDown = [...doc.levelOrder].reverse();
  const bottomId = doc.levelOrder[0];

  const add = (position: 'above' | 'below') => {
    const result = dispatch('level.create', { position, referenceId: activeLevelId });
    if (result.ok) setActiveLevel(result.value);
  };

  return (
    <div className="panel levels-panel">
      <div className="panel-actions">
        <button type="button" className="text-button" onClick={() => add('above')}>
          <ArrowUpToLine size={14} aria-hidden /> Add Level Above
        </button>
        <button type="button" className="text-button" onClick={() => add('below')}>
          <ArrowDownToLine size={14} aria-hidden /> Add Level Below
        </button>
      </div>
      <ol className="level-list" aria-label="Levels">
        {topDown.map((id) => {
          const level = doc.levels[id];
          if (!level) return null;
          const active = id === activeLevelId;
          return (
            <li key={id} className="level-card" data-active={active} data-testid={`level-${level.name}`}>
              <div className="level-card-header">
                <button
                  type="button"
                  className="level-select"
                  aria-pressed={active}
                  aria-label={`Make ${level.name} the active level`}
                  onClick={() => setActiveLevel(id)}
                />
                <TextInput label="Level name" value={level.name} onCommit={(name) => update(id, { name })} />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete ${level.name}`}
                  title={doc.levelOrder.length === 1 ? 'A plan needs at least one level' : `Delete ${level.name}`}
                  disabled={doc.levelOrder.length === 1}
                  onClick={() => dispatch('level.delete', { id })}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <dl className="level-fields">
                <dt>Elevation</dt>
                <dd>
                  {id === bottomId ? (
                    <LengthInput label="Elevation" value={level.elevation} format={format} onCommit={(v) => update(id, { elevation: v })} />
                  ) : (
                    <span className="field-readonly" title="Stacked on the level below">
                      {formatLength(level.elevation, format)}
                    </span>
                  )}
                </dd>
                <dt>Ceiling height</dt>
                <dd>
                  <LengthInput label="Ceiling height" value={level.ceilingHeight} format={format} onCommit={(v) => update(id, { ceilingHeight: v })} />
                </dd>
                <dt>Floor depth</dt>
                <dd>
                  <LengthInput label="Floor depth" value={level.floorDepth} format={format} onCommit={(v) => update(id, { floorDepth: v })} />
                </dd>
              </dl>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
