import { describe, expect, it } from 'vitest';
import { eyeZ, EYE_HEIGHT, PITCH_LIMIT, poseFromLook, stepWalk, walkLook, WALK_SPEED } from '../../src';

const still = { forward: 0, strafe: 0, yaw: 0, pitch: 0, elevation: 0 };

describe('walk', () => {
  const pose = { x: 10, y: 20, z: 0, yaw: 0, pitch: 0 };

  it('steps forward along +X when yaw is 0 and keeps the eye at 5\'-6"', () => {
    const next = stepWalk(pose, { ...still, forward: 12 });
    expect(next.x).toBeCloseTo(22);
    expect(next.y).toBeCloseTo(20);
    expect(next.z).toBe(eyeZ(0));
    expect(EYE_HEIGHT).toBe(66);
    expect(WALK_SPEED).toBe(48);
  });

  it('strafes to the right, which is -Y when facing +X', () => {
    const next = stepWalk(pose, { ...still, strafe: 8 });
    expect(next.x).toBeCloseTo(10);
    expect(next.y).toBeCloseTo(12);
  });

  it('uses the level elevation for eye height', () => {
    expect(stepWalk(pose, { ...still, elevation: 109.75 }).z).toBeCloseTo(175.75);
  });

  it('clamps pitch short of straight up', () => {
    const next = stepWalk(pose, { ...still, pitch: 10 });
    expect(next.pitch).toBeCloseTo(PITCH_LIMIT);
    const down = stepWalk(pose, { ...still, pitch: -10 });
    expect(down.pitch).toBeCloseTo(-PITCH_LIMIT);
  });

  it('looks along +X at pitch 0', () => {
    const at = walkLook({ x: 0, y: 0, z: 66, yaw: 0, pitch: 0 });
    expect(at).toMatchObject({ x: 1, y: 0, z: 66 });
  });

  it('builds a pose from an eye and a target, then snaps height to the eye line', () => {
    const next = poseFromLook({ x: 5, y: 5, z: 200 }, { x: 5, y: 15, z: 200 }, 0);
    expect(next.x).toBe(5);
    expect(next.y).toBe(5);
    expect(next.z).toBe(66);
    expect(next.yaw).toBeCloseTo(Math.PI / 2);
    expect(next.pitch).toBeCloseTo(0);
  });
});
