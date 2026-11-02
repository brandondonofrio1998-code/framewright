import { Fragment, useMemo } from 'react';
import { materialsList, type TakeoffUnit } from '@framewright/core';
import { useDocument } from '../document/store';

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
