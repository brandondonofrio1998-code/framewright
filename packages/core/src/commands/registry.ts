import { documentCommands } from './document';
import { openingCommands } from './openings';
import { wallCommands } from './walls';

export const planCommands = { ...documentCommands, ...wallCommands, ...openingCommands };
export type PlanCommands = typeof planCommands;
