import type { FramewrightApi } from '../../shared/ipc';

declare global {
  interface Window {
    readonly fw: FramewrightApi;
  }
}

export {};
