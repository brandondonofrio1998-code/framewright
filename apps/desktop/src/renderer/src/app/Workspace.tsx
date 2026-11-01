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
import { ElevationView } from '../elevate/ElevationView';
import { PlanView } from '../plan/PlanView';
import { SectionView } from '../section/SectionView';
import { View3D } from '../view3d/View3D';
import { openCameras, setViewMode, useView3d } from '../view3d/view-state';

const theme: DockviewTheme = {
  ...themeLight,
  name: 'framewright',
  className: `${themeLight.className} fw-dock-theme`,
};

const components = { levels: LevelsPanel, plan: PlanView, properties: PropertiesPanel, library: LibraryPanel, view3d: View3D, elevation: ElevationView, section: SectionView };

function showSection(api: DockviewApi): void {
  const existing = api.getPanel('section');
  if (existing) {
    existing.api.setActive();
    return;
  }
  const plan = api.getPanel('plan');
  const panel = api.addPanel({
    id: 'section',
    title: 'Section',
    component: 'section',
    ...(plan ? { position: { referencePanel: plan, direction: 'within' as const } } : {}),
  });
  panel.api.setActive();
}

function showElevation(api: DockviewApi): void {
  const existing = api.getPanel('elevation');
  if (existing) {
    existing.api.setActive();
    return;
  }
  const plan = api.getPanel('plan');
  const panel = api.addPanel({
    id: 'elevation',
    title: 'Elevation',
    component: 'elevation',
    ...(plan ? { position: { referencePanel: plan, direction: 'within' as const } } : {}),
  });
  panel.api.setActive();
}

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
    id: 'elevation',
    title: 'Elevation',
    component: 'elevation',
    position: { referencePanel: plan, direction: 'within' },
  });
  api.addPanel({
    id: 'section',
    title: 'Section',
    component: 'section',
    position: { referencePanel: plan, direction: 'within' },
  });
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

  useEffect(() => {
    return useView3d.subscribe((state, prev) => {
      if (state.camerasOpen && !prev.camerasOpen && apiRef.current) showPerspective(apiRef.current);
    });
  }, []);

  useEffect(
    () =>
      window.fw.menu.onCommand((command) => {
        if (!apiRef.current) return;
        if (command.type === 'view.resetLayout') buildDefaultLayout(apiRef.current);
        else if (command.type === 'view.showElevation') showElevation(apiRef.current);
        else if (command.type === 'view.showSection') showSection(apiRef.current);
        else if (command.type === 'view.show3d') {
          setViewMode(command.mode);
          showPerspective(apiRef.current);
        } else if (command.type === 'view.cameras') {
          openCameras();
          showPerspective(apiRef.current);
        }
      }),
    [],
  );

  return (
    <main className="workspace">
      <DockviewReact components={components} onReady={onReady} theme={theme} />
    </main>
  );
}
