import type { MeshRole } from '../mesh/meshes';
import type { PlanDocument, TextureId } from '../model/schema';
import { TEXTURE_IDS } from '../model/schema';

/**
 * ambientCG publishes a scan's size in centimeters. Tile sizes in the plan are inches,
 * rounded the same way the file format rounds numbers, so a new plan round-trips.
 */
export const CM_TO_INCHES = 1 / 2.54;

export interface TextureScan {
  /** ambientCG asset id. The files are listed in ASSETS.md. */
  asset: string;
  /** Published width and height, centimeters. */
  cm: readonly [number, number];
}

export const TEXTURE_SCANS: Record<TextureId, TextureScan> = {
  'smooth-wall': { asset: 'Concrete046', cm: [240, 240] },
  softwood: { asset: 'Wood096', cm: [50, 50] },
  'wood-planks': { asset: 'Planks021', cm: [140, 140] },
  'oak-floor': { asset: 'WoodFloor051', cm: [180, 180] },
};

const ROUND = 1e6;

export function tileInches(cm: readonly [number, number]): [number, number] {
  const inch = (value: number) => Math.round(value * CM_TO_INCHES * ROUND) / ROUND;
  return [inch(cm[0]), inch(cm[1])];
}

/** Used when an older plan's material has a category but no texture of its own. Sheathing has no sized scan. */
export const CATEGORY_TEXTURE: Partial<Record<PlanDocument['materials'][string]['category'], TextureId>> = {
  drywall: 'smooth-wall',
  framing: 'softwood',
  siding: 'wood-planks',
};

/** Floors and door/cabinet panels have no material id yet, so they use these display maps. */
const ROLE_TEXTURE: Partial<Record<MeshRole, TextureId>> = {
  floor: 'oak-floor',
  panel: 'softwood',
};

export interface PartTexture {
  id: TextureId;
  tile: [number, number];
}

export function partTexture(doc: PlanDocument, part: { materialId: string | null; role: MeshRole }): PartTexture | null {
  if (part.role === 'glass') return null;
  if (part.materialId) {
    const material = doc.materials[part.materialId];
    if (!material) return null;
    if (material.texture) return { id: material.texture.id, tile: [material.texture.tile[0], material.texture.tile[1]] };
    const fallback = CATEGORY_TEXTURE[material.category];
    return fallback ? { id: fallback, tile: tileInches(TEXTURE_SCANS[fallback].cm) } : null;
  }
  const role = ROLE_TEXTURE[part.role];
  return role ? { id: role, tile: tileInches(TEXTURE_SCANS[role].cm) } : null;
}

export function isTextureId(value: string): value is TextureId {
  return (TEXTURE_IDS as readonly string[]).includes(value);
}
