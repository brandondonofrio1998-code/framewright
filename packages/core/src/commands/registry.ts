import { cameraCommands } from './cameras';
import { catalogCommands } from './catalog';
import { documentCommands } from './document';
import { openingCommands } from './openings';
import { roofCommands } from './roofs';
import { wallCommands } from './walls';

export const planCommands = { ...documentCommands, ...wallCommands, ...openingCommands, ...catalogCommands, ...cameraCommands, ...roofCommands };
export type PlanCommands = typeof planCommands;
