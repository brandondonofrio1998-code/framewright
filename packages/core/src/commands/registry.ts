import { cameraCommands } from './cameras';
import { catalogCommands } from './catalog';
import { documentCommands } from './document';
import { foundationCommands } from './foundations';
import { openingCommands } from './openings';
import { roofCommands } from './roofs';
import { wallCommands } from './walls';

export const planCommands = { ...documentCommands, ...wallCommands, ...openingCommands, ...catalogCommands, ...cameraCommands, ...roofCommands, ...foundationCommands };
export type PlanCommands = typeof planCommands;
