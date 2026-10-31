import { useCallback, useEffect, useRef } from 'react';
import {
  DockviewReact,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
} from 'dockview-react';
import { LevelsPanel } from '../panels/LevelsPanel';
import { LibraryPanel } from '../panels/LibraryPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { PlanView } from '../plan/PlanView';
import { View3D } from '../view3d/View3D';

const theme: DockviewTheme = {
  ...themeLight,
  name: 'framewright',
  className: `${themeLight.className} fw-dock-theme`,
};

const components = { levels: LevelsPanel, plan: PlanView, properties: PropertiesPanel, library: LibraryPanel, view3d: View3D };

function showPerspective(api: DockviewApi): void {
  const existing = api.getPanel('perspective');
  if (existing) {
    existing.api.setActive();
    return;
  }
  const plan = api.getPanel('plan');
  const panel = api.addPanel({
    id: 'perspective',
    title: '3D',
    component: 'view3d',
    ...(plan ? { position: { referencePanel: plan, direction: 'within' as const } } : {}),
  });
  panel.api.setActive();
}

function buildDefaultLayout(api: DockviewApi): void {
  api.clear();
  const plan = api.addPanel({ id: 'plan', title: 'Plan', component: 'plan' });
  api.addPanel({
    id: 'perspective',
    title: '3D',
    component: 'view3d',
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
        if (!apiRef.current) return;
        if (command.type === 'view.resetLayout') buildDefaultLayout(apiRef.current);
        else if (command.type === 'view.show3d') showPerspective(apiRef.current);
      }),
    [],
  );

  return (
    <main className="workspace">
      <DockviewReact components={components} onReady={onReady} theme={theme} />
    </main>
  );
}
