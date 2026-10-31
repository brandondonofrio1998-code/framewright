import { useCallback, useEffect, useRef } from 'react';
import {
  DockviewReact,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react';

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

const components = { placeholder: PlaceholderPanel };

function buildDefaultLayout(api: DockviewApi): void {
  api.clear();
  const plan = api.addPanel<PlaceholderParams>({
    id: 'plan',
    title: 'Plan',
    component: 'placeholder',
    params: { title: 'Plan view', arrives: 'M1c' },
  });
  api.addPanel<PlaceholderParams>({
    id: 'perspective',
    title: '3D',
    component: 'placeholder',
    params: { title: '3D perspective', arrives: 'M3' },
    position: { referencePanel: plan, direction: 'within' },
  });
  api.addPanel<PlaceholderParams>({
    id: 'library',
    title: 'Library',
    component: 'placeholder',
    params: { title: 'Catalog library', arrives: 'M2' },
    position: { referencePanel: plan, direction: 'left' },
    initialWidth: 260,
  });
  api.addPanel<PlaceholderParams>({
    id: 'properties',
    title: 'Properties',
    component: 'placeholder',
    params: { title: 'Properties', arrives: 'M1c' },
    position: { referencePanel: plan, direction: 'right' },
    initialWidth: 280,
  });
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
        if (command === 'view.resetLayout' && apiRef.current) buildDefaultLayout(apiRef.current);
      }),
    [],
  );

  return (
    <main className="workspace">
      <DockviewReact components={components} onReady={onReady} theme={theme} />
    </main>
  );
}
