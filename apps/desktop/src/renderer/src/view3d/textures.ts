import type { TextureId } from '@framewright/core';
import colorFloor from './textures/oak-floor/color.jpg?url';
import normalFloor from './textures/oak-floor/normal.jpg?url';
import roughFloor from './textures/oak-floor/roughness.jpg?url';
import colorPlanks from './textures/wood-planks/color.jpg?url';
import normalPlanks from './textures/wood-planks/normal.jpg?url';
import roughPlanks from './textures/wood-planks/roughness.jpg?url';
import colorWall from './textures/smooth-wall/color.jpg?url';
import normalWall from './textures/smooth-wall/normal.jpg?url';
import roughWall from './textures/smooth-wall/roughness.jpg?url';
import colorWood from './textures/softwood/color.jpg?url';
import normalWood from './textures/softwood/normal.jpg?url';
import roughWood from './textures/softwood/roughness.jpg?url';

/** Bundled ambientCG maps. See ASSETS.md for the source and license of each file. */
export const TEXTURE_URLS: Record<TextureId, { color: string; normal: string; roughness: string }> = {
  'smooth-wall': { color: colorWall, normal: normalWall, roughness: roughWall },
  softwood: { color: colorWood, normal: normalWood, roughness: roughWood },
  'wood-planks': { color: colorPlanks, normal: normalPlanks, roughness: roughPlanks },
  'oak-floor': { color: colorFloor, normal: normalFloor, roughness: roughFloor },
};
