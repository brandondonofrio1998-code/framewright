import { create } from 'zustand';
import type { CameraMode, Vec3 } from '@framewright/core';

export type Projection = 'perspective' | 'orthographic';

export interface Recall {
  token: number;
  mode: CameraMode;
  eye: Vec3;
  target: Vec3;
  zoom?: number;
}

interface ViewState {
  mode: CameraMode;
  projection: Projection;
  camerasOpen: boolean;
  recall: Recall | null;
}

export const useView3d = create<ViewState>(() => ({
  mode: 'orbit',
  projection: 'perspective',
  camerasOpen: false,
  recall: null,
}));

export function setViewMode(mode: CameraMode): void {
  useView3d.setState({ mode });
}

export function setOrbit(projection: Projection): void {
  useView3d.setState({ mode: 'orbit', projection });
}

export function toggleCameras(): void {
  useView3d.setState((state) => ({ camerasOpen: !state.camerasOpen }));
}

export function openCameras(): void {
  useView3d.setState({ camerasOpen: true });
}

let token = 0;

export function recallCamera(mode: CameraMode, eye: Vec3, target: Vec3, projection: Projection = 'perspective', zoom?: number): void {
  useView3d.setState((state) => ({
    mode,
    projection: mode === 'orbit' ? projection : state.projection,
    recall: { token: ++token, mode, eye, target, ...(zoom !== undefined ? { zoom } : {}) },
  }));
}
