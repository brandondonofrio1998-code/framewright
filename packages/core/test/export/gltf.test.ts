import { describe, expect, it } from 'vitest';
import { planGlb } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function gltfJson(bytes: Uint8Array): { asset: { version: string }; meshes?: { primitives: unknown[] }[]; accessors?: { min?: number[]; max?: number[]; type: string }[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
}

describe('plan glTF', () => {
  it('writes an empty plan as a glTF 2 scene', () => {
    const ctx = testHistory();
    const json = gltfJson(planGlb(ctx.history.doc));
    expect(json.asset.version).toBe('2.0');
    expect(json.meshes ?? []).toEqual([]);
  });

  it('writes the room in meters, Y up', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', {
      levelId: ctx.baseLevelId,
      typeId,
      points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
      closed: true,
    });
    if (!drawn.ok) throw new Error(drawn.error);
    const json = gltfJson(planGlb(ctx.history.doc));
    const positions = (json.accessors ?? []).filter((accessor) => accessor.type === 'VEC3' && accessor.min && accessor.max);
    const span = positions.reduce(
      (best, accessor) => {
        const width = accessor.max![0]! - accessor.min![0]!;
        return width > best.width ? { width, minY: accessor.min![1]!, maxY: accessor.max![1]! } : best;
      },
      { width: 0, minY: 0, maxY: 0 },
    );
    expect(json.meshes?.[0]?.primitives.length).toBeGreaterThan(0);
    expect(span.width).toBeGreaterThan(6);
    expect(span.width).toBeLessThan(8);
    expect(span.maxY - span.minY).toBeGreaterThan(2);
  });
});
