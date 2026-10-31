import type { CatalogDef, CatalogParam } from '../model/schema';

const size = (key: string, label: string, min: number, max: number): CatalogParam => ({ key, label, min, max });

const item = (sourceId: string, name: string, category: string[], generator: CatalogDef['generator'], params: Record<string, number>, hostsToWall = true): CatalogDef => ({
  id: sourceId,
  sourceId,
  name,
  category,
  generator,
  params,
  paramSchema: [
    size('width', 'Width', 9, 120),
    size('depth', 'Depth', 6, 48),
    size('height', 'Height', 6, 120),
  ],
  hostsToWall,
});

/**
 * The bundled starter catalog: generic sizes (nothing copied from a manufacturer's library).
 * Base cabinets are 24" deep and 34 1/2" high, wall cabinets 12" deep and hung at 54", tall cabinets 84" high.
 */
export const STARTER_CATALOG: readonly CatalogDef[] = [
  item('starter.base-24', 'Base Cabinet 24', ['Kitchen', 'Base Cabinets'], 'cabinet.base', { width: 24, depth: 24, height: 34.5, elevation: 0 }),
  item('starter.base-36', 'Base Cabinet 36', ['Kitchen', 'Base Cabinets'], 'cabinet.base', { width: 36, depth: 24, height: 34.5, elevation: 0 }),
  item('starter.wall-30', 'Wall Cabinet 30', ['Kitchen', 'Wall Cabinets'], 'cabinet.wall', { width: 30, depth: 12, height: 30, elevation: 54 }),
  item('starter.pantry', 'Pantry Cabinet', ['Kitchen', 'Tall Cabinets'], 'cabinet.tall', { width: 24, depth: 24, height: 84, elevation: 0 }),
  item('starter.range-30', 'Range 30', ['Appliances'], 'appliance.range', { width: 30, depth: 25, height: 36, elevation: 0 }),
  item('starter.fridge-36', 'Refrigerator 36', ['Appliances'], 'appliance.fridge', { width: 36, depth: 30, height: 70, elevation: 0 }),
  item('starter.dishwasher', 'Dishwasher 24', ['Appliances'], 'appliance.dishwasher', { width: 24, depth: 24, height: 34, elevation: 0 }),
  item('starter.toilet', 'Toilet', ['Fixtures'], 'fixture.toilet', { width: 18, depth: 28, height: 30, elevation: 0 }),
  item('starter.sink', 'Kitchen Sink', ['Fixtures'], 'fixture.sink', { width: 33, depth: 22, height: 8, elevation: 0 }),
  item('starter.lavatory', 'Lavatory', ['Fixtures'], 'fixture.sink', { width: 24, depth: 19, height: 31, elevation: 0 }),
  item('starter.tub-60', 'Bathtub 60', ['Fixtures'], 'fixture.tub', { width: 60, depth: 30, height: 16, elevation: 0 }),
];

export function starterById(sourceId: string): CatalogDef | undefined {
  return STARTER_CATALOG.find((item) => item.sourceId === sourceId);
}
