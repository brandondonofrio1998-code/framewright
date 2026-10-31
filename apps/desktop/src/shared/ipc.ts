export const IpcChannel = {
  appInfo: 'fw:app-info',
  menuCommand: 'fw:menu-command',
} as const;

export type Platform = 'darwin' | 'win32' | 'linux';

export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
}

/** Menu commands handled by the renderer. Main-only actions (quit, about, devtools) never cross IPC. */
export const RENDERER_MENU_COMMANDS = ['view.resetLayout'] as const;
export type MenuCommand = (typeof RENDERER_MENU_COMMANDS)[number];

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (RENDERER_MENU_COMMANDS as readonly string[]).includes(value);
}

export type Unsubscribe = () => void;

export interface FramewrightApi {
  app: {
    info(): Promise<AppInfo>;
  };
  menu: {
    onCommand(listener: (command: MenuCommand) => void): Unsubscribe;
  };
}
