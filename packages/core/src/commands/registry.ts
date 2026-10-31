import { documentCommands } from './document';
import { wallCommands } from './walls';

export const planCommands = { ...documentCommands, ...wallCommands };
export type PlanCommands = typeof planCommands;
