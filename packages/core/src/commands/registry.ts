import { catalogCommands } from './catalog';
import { documentCommands } from './document';
import { openingCommands } from './openings';
import { wallCommands } from './walls';

export const planCommands = { ...documentCommands, ...wallCommands, ...openingCommands, ...catalogCommands };
export type PlanCommands = typeof planCommands;
