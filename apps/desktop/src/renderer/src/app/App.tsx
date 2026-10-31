import { useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/ipc';
import { Workspace } from './Workspace';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.fw.app.info().then((result) => {
      if (!cancelled) setInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app" data-platform={info?.platform}>
      <Toolbar />
      <Workspace />
      <StatusBar />
    </div>
  );
}
