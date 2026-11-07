import type { Opening } from '../model/schema';
import type { WallFraming } from './members';

export interface Cavity { s0: number; s1: number; z0: number; z1: number }

/** Disjoint rectangles inside the stud bay, excluding lumber and opening voids. */
export function insulationCavities(frame: WallFraming, openings: Opening[], base: number): Cavity[] {
  const members = frame.members;
  if (!members.length) return [];
  const blocked: Cavity[] = [...members, ...openings.map((o) => ({
    s0: o.t - o.width / 2, s1: o.t + o.width / 2,
    z0: base + (o.kind === 'window' ? o.sill : 0),
    z1: base + (o.kind === 'window' ? o.sill : 0) + o.height,
  }))];
  const minS = Math.min(...members.map((m) => m.s0));
  const maxS = Math.max(...members.map((m) => m.s1));
  const minZ = Math.min(...members.map((m) => m.z0));
  const maxZ = Math.max(...members.map((m) => m.z1));
  const ss = [...new Set(blocked.flatMap((m) => [m.s0, m.s1]).filter((s) => s >= minS && s <= maxS))].sort((a, b) => a - b);
  const zs = [...new Set(blocked.flatMap((m) => [m.z0, m.z1]).filter((z) => z >= minZ && z <= maxZ))].sort((a, b) => a - b);
  const result: Cavity[] = [];
  for (let i = 1; i < ss.length; i++) for (let j = 1; j < zs.length; j++) {
    const s0 = ss[i - 1]!, s1 = ss[i]!, z0 = zs[j - 1]!, z1 = zs[j]!;
    const s = (s0 + s1) / 2, z = (z0 + z1) / 2;
    if (!blocked.some((m) => s > m.s0 && s < m.s1 && z > m.z0 && z < m.z1)) result.push({ s0, s1, z0, z1 });
  }
  return result;
}
