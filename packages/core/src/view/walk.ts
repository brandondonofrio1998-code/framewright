import type { Vec3 } from '../model/schema';

/** Eye height above the finished floor: 5'-6". */
export const EYE_HEIGHT = 66;
/** Comfortable walk, inches per second. */
export const WALK_SPEED = 48;
/** Held Shift, inches per second. */
export const WALK_FAST = 120;
/** Radians. Looking straight up is not useful in a plan. */
export const PITCH_LIMIT = (80 * Math.PI) / 180;
/** A saved camera whose eye and target are closer than this has no direction. */
export const MIN_LOOK = 0.05;

export interface WalkPose {
  x: number;
  y: number;
  z: number;
  /** Radians from +X toward +Y. 0 looks along +X. */
  yaw: number;
  /** Radians above the horizontal. */
  pitch: number;
}

export interface WalkInput {
  /** Inches along the facing direction. */
  forward: number;
  /** Inches to the right of the facing direction. */
  strafe: number;
  /** Radians added this step. */
  yaw: number;
  pitch: number;
  /** Finished-floor elevation of the level being walked. */
  elevation: number;
}

export function eyeZ(elevation: number): number {
  return elevation + EYE_HEIGHT;
}

export function lookLength(eye: Vec3, target: Vec3): number {
  return Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
}

/** A point one inch along the view direction. */
export function walkLook(pose: WalkPose): Vec3 {
  const horizontal = Math.cos(pose.pitch);
  return {
    x: pose.x + Math.cos(pose.yaw) * horizontal,
    y: pose.y + Math.sin(pose.yaw) * horizontal,
    z: pose.z + Math.sin(pose.pitch),
  };
}

function clampPitch(pitch: number): number {
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
}

/**
 * Move in the plan (Z stays at eye height) and turn. Forward is the current yaw;
 * the yaw and pitch deltas apply after the step.
 */
export function stepWalk(pose: WalkPose, input: WalkInput): WalkPose {
  return {
    x: pose.x + Math.cos(pose.yaw) * input.forward + Math.sin(pose.yaw) * input.strafe,
    y: pose.y + Math.sin(pose.yaw) * input.forward - Math.cos(pose.yaw) * input.strafe,
    z: eyeZ(input.elevation),
    yaw: pose.yaw + input.yaw,
    pitch: clampPitch(pose.pitch + input.pitch),
  };
}

/** A walk pose that looks from `eye` toward `target`, with height snapped to the level's eye line. */
export function poseFromLook(eye: Vec3, target: Vec3, elevation: number): WalkPose {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  const horizontal = Math.hypot(dx, dy);
  return {
    x: eye.x,
    y: eye.y,
    z: eyeZ(elevation),
    yaw: Math.atan2(dy, dx),
    pitch: clampPitch(Math.atan2(dz, Math.max(horizontal, 1e-6))),
  };
}
