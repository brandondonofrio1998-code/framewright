import { useMemo, useState } from 'react';
import { STARTER_CATALOG, type CatalogDef } from '@framewright/core';
import { setTool, useEditor } from '../editor/store';

function matches(item: CatalogDef, query: string): boolean {
  const haystack = [item.name, ...item.category].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** The bundled catalog. Click an item, then click a wall in the plan to place it. */
export function LibraryPanel() {
  const armed = useEditor((s) => s.armedCatalogId);
  const [query, setQuery] = useState('');
  const items = useMemo(() => STARTER_CATALOG.filter((item) => matches(item, query.trim())), [query]);
  const categories = [...new Set(items.map((item) => item.category[0] ?? 'Other'))];

  return (
    <div className="panel library-panel">
      <input className="field-input library-search" aria-label="Search library" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
      {categories.length === 0 && <p className="panel-hint">Nothing in the library matches.</p>}
      {categories.map((category) => (
        <section key={category} className="library-category">
          <h3 className="library-heading">{category}</h3>
          {items
            .filter((item) => item.category[0] === category)
            .map((item) => (
              <button
                key={item.sourceId}
                type="button"
                className="library-item"
                aria-label={item.name}
                aria-pressed={armed === item.sourceId}
                onClick={() => {
                  useEditor.setState({ armedCatalogId: item.sourceId });
                  setTool('objects');
                }}
              >
                <span className="library-item-name">{item.name}</span>
                <span className="library-item-meta" aria-hidden="true">{item.category.slice(1).join(' / ')}</span>
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}
