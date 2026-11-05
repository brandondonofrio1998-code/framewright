import { cadCommands } from './cad';
import { cameraCommands } from './cameras';
import { catalogCommands } from './catalog';
import { deckCommands } from './decks';
import { documentCommands } from './document';
import { electricalCommands } from './electrical';
import { foundationCommands } from './foundations';
import { openingCommands } from './openings';
import { plantCommands } from './plants';
import { plumbingCommands } from './plumbing';
import { roofCommands } from './roofs';
import { siteCommands } from './site';
import { stairCommands } from './stairs';
import { textCommands } from './text';
import { layerCommands } from './layers';
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
  ...deckCommands,
  ...electricalCommands,
  ...plumbingCommands,
  ...siteCommands,
  ...plantCommands,
  ...cadCommands,
  ...textCommands,
  ...layerCommands,
};
export type PlanCommands = typeof planCommands;
