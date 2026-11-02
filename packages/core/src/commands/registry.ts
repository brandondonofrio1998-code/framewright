import { cadCommands } from './cad';
import { cameraCommands } from './cameras';
import { catalogCommands } from './catalog';
import { documentCommands } from './document';
import { foundationCommands } from './foundations';
import { openingCommands } from './openings';
import { roofCommands } from './roofs';
import { stairCommands } from './stairs';
import { wallCommands } from './walls';

export const planCommands = {
  ...documentCommands,
  ...wallCommands,
  ...openingCommands,
  ...catalogCommands,
  ...cameraCommands,
  ...roofCommands,
  ...foundationCommands,
  ...stairCommands,
  ...cadCommands,
};
export type PlanCommands = typeof planCommands;
