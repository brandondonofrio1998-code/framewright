import { notify } from '../editor/store';
import { TextInput } from '../ui/LengthInput';
import { Fragment, useMemo } from 'react';
import { materialsList, type TakeoffUnit } from '@framewright/core';
import { exportMaterials } from '../document/file-actions';
import { dispatch, useDocument } from '../document/store';

function formatQty(quantity: number, unit: TakeoffUnit): string {
  if (unit === 'each') return String(Math.round(quantity));
  if (unit === 'cu yd') return `${quantity.toFixed(2)} cu yd`;
  return `${quantity.toFixed(1)} ${unit}`;
}

/** Quantities derived from the current plan. */
export function MaterialsPanel() {
  const doc = useDocument((s) => s.doc);
  const lines = useMemo(() => materialsList(doc), [doc]);
  return (
    <div className="panel materials-panel">
      <h3 className="panel-heading">Materials</h3>
      <p className="panel-hint">To change wall layers, select a wall in Plan and open Properties: Materials & framing. Appearance edits below affect every use of the material.</p>
      <details>
        <summary>Edit material names & colors</summary>
        {Object.values(doc.materials).map((m) => <div className="wall-layer-editor" key={m.id}>
          <TextInput label={`Name for ${m.name}`} value={m.name} onCommit={(name) => { const r = dispatch('material.update', { id: m.id, name }); return r.ok ? null : r.error; }} />
          <label>Color <input type="color" aria-label={`Color for ${m.name}`} value={m.color} onChange={(e) => { const r = dispatch('material.update', { id: m.id, color: e.target.value }); notify(r.ok ? null : r.error); }} /></label>
        </div>)}
      </details>
      <div className="panel-actions">
        <button type="button" className="text-button" onClick={() => void exportMaterials()}>
          Export CSV
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="panel-hint">Draw walls to see quantities.</p>
      ) : (
        <table className="materials-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const showCategory = index === 0 || lines[index - 1]?.category !== line.category;
              return (
                <Fragment key={`${line.category}-${line.name}-${line.unit}`}>
                  {showCategory ? (
                    <tr className="materials-category">
                      <th colSpan={2}>{line.category}</th>
                    </tr>
                  ) : null}
                  <tr>
                    <td>{line.name}</td>
                    <td>{formatQty(line.quantity, line.unit)}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
