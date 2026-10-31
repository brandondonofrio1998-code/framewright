import { useCallback, useEffect, useRef } from 'react';
import {
  DockviewReact,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react';
import { LevelsPanel } from '../panels/LevelsPanel';
import { LibraryPanel } from '../panels/LibraryPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { PlanView } from '../plan/PlanView';

const theme: DockviewTheme = {
  ...themeLight,
  name: 'framewright',
  className: `${themeLight.className} fw-dock-theme`,
};

interface PlaceholderParams {
  title: string;
  arrives: string;
}

function PlaceholderPanel({ params }: IDockviewPanelProps<PlaceholderParams>) {
  return (
    <div className="panel-placeholder">
      <p className="panel-placeholder-title">{params.title}</p>
      <p className="panel-placeholder-note">Arrives in {params.arrives}.</p>
    </div>
  );
}

const components = { placeholder: PlaceholderPanel, levels: LevelsPanel, plan: PlanView, properties: PropertiesPanel, library: LibraryPanel };

function buildDefaultLayout(api: DockviewApi): void {
  api.clear();
  const plan = api.addPanel({ id: 'plan', title: 'Plan', component: 'plan' });
  api.addPanel<PlaceholderParams>({
    id: 'perspective',
    title: '3D',
    component: 'placeholder',
    params: { title: '3D perspective', arrives: 'M3' },
    position: { referencePanel: plan, direction: 'within' },
  });
  api.addPanel({
    id: 'library',
    title: 'Library',
    component: 'library',
    position: { referencePanel: plan, direction: 'left' },
    initialWidth: 260,
  });
  const levels = api.addPanel({
    id: 'levels',
    title: 'Levels',
    component: 'levels',
    position: { referencePanel: plan, direction: 'right' },
    initialWidth: 300,
  });
  const properties = api.addPanel({
    id: 'properties',
    title: 'Properties',
    component: 'properties',
    position: { referencePanel: levels, direction: 'within' },
  });
  properties.api.setActive();
  plan.api.setActive();
}

export function Workspace() {
  const apiRef = useRef<DockviewApi | null>(null);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    buildDefaultLayout(event.api);
  }, []);

  useEffect(
    () =>
      window.fw.menu.onCommand((command) => {
        if (command.type === 'view.resetLayout' && apiRef.current) buildDefaultLayout(apiRef.current);
      }),
    [],
  );

  return (
    <main className="workspace">
      <DockviewReact components={components} onReady={onReady} theme={theme} />
    </main>
  );
}
