import { create } from 'zustand';
import type { CameraMode, Vec3 } from '@framewright/core';

export interface Recall {
  token: number;
  mode: CameraMode;
  eye: Vec3;
  target: Vec3;
}

interface ViewState {
  mode: CameraMode;
  camerasOpen: boolean;
  recall: Recall | null;
}

export const useView3d = create<ViewState>(() => ({
  mode: 'orbit',
  camerasOpen: false,
  recall: null,
}));

export function setViewMode(mode: CameraMode): void {
  useView3d.setState({ mode });
}

export function toggleCameras(): void {
  useView3d.setState((state) => ({ camerasOpen: !state.camerasOpen }));
}

export function openCameras(): void {
  useView3d.setState({ camerasOpen: true });
}

let token = 0;

export function recallCamera(mode: CameraMode, eye: Vec3, target: Vec3): void {
  useView3d.setState({ mode, recall: { token: ++token, mode, eye, target } });
}
