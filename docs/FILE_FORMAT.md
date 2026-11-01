# Framewright plan file format

A Framewright plan is one UTF-8 JSON file, normally with the extension `.fwplan`. The format is Framewright's own and is unrelated to any other program's files. The schema in code is `packages/core/src/model/schema.ts`, which is authoritative if this page and the code ever disagree.

## Recognising a plan

A file is a Framewright plan when its top-level object has `"format": "framewright-plan"`. Open accepts `.fwplan` and `.plan` files, but only loads them if that marker is present. Anything else is rejected with "This is not a Framewright plan file." The app only registers `.fwplan` with the operating system.

## Conventions

- **Lengths** are numbers in **inches**. Display units (ft-in, in, mm, cm, m) are a per-plan setting and never change stored values.
- **Coordinates** are plan-space inches with Z up. Elevations are absolute heights of the top of subfloor.
- **Numbers** are written rounded to 6 decimal places, with `-0` written as `0`.
- **Ids** are opaque strings of 1 to 64 characters (UUIDs in practice). Objects reference each other only by id.
- **Collections** are stored as id-keyed maps. Order is kept separately where it matters (`levelOrder`, bottom to top).

## Top level (schema version 2)

| Key | Contents |
| --- | --- |
| `format` | Always `"framewright-plan"` |
| `schemaVersion` | Integer, currently `2` |
| `meta` | `id`, `title`, `created` and `modified` (ISO 8601), and `appVersion` of the app that last saved |
| `settings` | `lengthFormat` (display units and precision) and `gridSpacing` |
| `levels` | Map of level id to `{ id, name, elevation, ceilingHeight, floorDepth, ceilingFinish }` |
| `levelOrder` | Level ids from the bottom level up; at least one |
| `wallTypes` | Map of wall type id to `{ id, name, layers[], coreIndex }`. Layers run from the wall's left side to its right (relative to its start and end points), each `{ materialId, thickness, fn }` |
| `materials` | Map of material id to `{ id, name, category, color, texture? }`. `texture`, when present, is `{ id, tile }`: `id` is a bundled set (`smooth-wall`, `softwood`, `wood-planks`, `oak-floor`) and `tile` is `[width, height]` in inches, the real size of one repeat. Sheathing has no texture. Plans saved before textures omit the field and still open |
| `catalogDefs` | Map of catalog definition id to the definition embedded when an object was placed. Empty when the plan has no catalog objects. See below |
| `elements` | Map of element id to an element, discriminated by `kind` (see below) |

### Element kinds

Every element has `id`, `kind` and `levelId`, plus optional `name` and `locked`.

| Kind | Fields |
| --- | --- |
| `wallNode` | `p`: a point where walls meet. Walls that join share a node |
| `wall` | `a`, `b`: node ids (the wall's centerline runs a → b); `typeId`; `height` (`null` = from the level); `baseOffset` |
| `dimension` | `a`, `b`: ends `{ p, nodeId? }` (an end with `nodeId` follows that wall node; `p` is its last position); `offset`: distance of the dimension line, positive to the left of a → b |
| `door` | `wallId`; `t`: distance along the wall from node a to the door's center; `width`; `height`; `side` (`left`/`right` of a → b: the swing side); `hinge` (`start` = the jamb nearer node a, or `end`); `style` (`hinged`, `double`, `pocket`, `sliding`, `bifold`, `opening`) |
| `window` | Same as `door`, plus `sill` (height of the window's bottom above the wall's base). `side` is the exterior side. `style` is `double-hung`, `casement`, `slider`, `awning` or `fixed` |
| `room` | `name` (required); `roomType` (`unspecified`, `living`, `kitchen`, `dining`, `bedroom`, `bathroom`, `hall`, `closet`, `garage`, `utility`, `other`); `seed`: a point inside the room; `ceilingHeight` (`null` = the level's ceiling height). The polygon and area are not stored |
| `object` | `defId` (a key in `catalogDefs`); `p`: plan center; `z`: base height above the level; `rotation`: radians counter-clockwise from +x (local +y points at the back); `params`: overrides of the definition's defaults; optional `hostWallId`, `hostT` (distance from node a to the center), and `side` (`left`/`right` of a → b) when the object is hosted on a wall |
| `camera` | `name`; `mode` (`orbit` or `walk`); `eye` and `target`, each `{ x, y, z }` in inches (Z up). `target` is a point the camera looks at and must not be the same point as `eye`. Cameras are not drawn in the plan |
| `roofPlane` | `polygon` (the slope in plan); `pitch` (rise per 12 inches of run); `up` (a unit vector from the fascia toward the ridge); `eave` (a point on the fascia) and `eaveZ` (its height); `generatedFrom` (the wall ids the roof was built from). A gable is two of these. The file stays at schema 2 |

A door or window must lie entirely within its wall (`width/2 ≤ t ≤ length − width/2`), and openings on one wall don't overlap.

A catalog definition is `{ id, sourceId, name, category, generator, params, paramSchema, hostsToWall }`. `generator` is one of `cabinet.base`, `cabinet.wall`, `cabinet.tall`, `appliance.range`, `appliance.fridge`, `appliance.dishwasher`, `fixture.toilet`, `fixture.sink`, `fixture.tub`. `params` holds the defaults (width, depth, height, and for wall cabinets an elevation). `paramSchema` lists the numeric fields the user can edit, each `{ key, label, min, max }`. The same definition is embedded once and shared by every object placed from it. `sourceId` is the starter catalog id (for example `starter.base-24`).

Level elevations are stacked: each level above the bottom one sits at `below.elevation + below.ceilingHeight + this.floorDepth`. Only the bottom level's elevation is free. The app recomputes the stack on load, so hand-edited elevations of upper levels are corrected.

## Validation and repair

Loading validates the whole file against the schema. A file that fails validation is not opened, and the user sees the first few problems with their JSON paths. A file that passes but breaks a cross-reference rule (for example, a wall pointing at a missing node, or an inconsistent level stack) is repaired. The user is told what was fixed, and the plan opens with unsaved changes so the original file is untouched until they save. The app refuses to save a plan that breaks these rules.

## Versioning

- `schemaVersion` increases whenever the format changes incompatibly. Adding an element kind does not, because older apps never have to read a key they require. Adding a required top-level key does. The `camera` kind, the `roofPlane` kind, and the optional material `texture` were added at version 2 for that reason.
- Version 1 files upgrade to version 2 by adding `catalogDefs: {}`. The frozen fixture is `packages/core/test/fixtures/v1/two-levels.fwplan`.
- Older files are upgraded on load, and open with unsaved changes, by a chain of migrations, one per version step (`MIGRATIONS` in `packages/core/src/file/format.ts`). Each migration has a frozen fixture file under `packages/core/test/fixtures/v<N>/`.
- A file from a newer version of Framewright is not opened. The message tells the user to update rather than risk losing data the older app doesn't understand.

## Saving safety

Saves write to a temporary file in the same folder, flush it to disk, and rename it over the target. The previous version is kept next to it as `<name>.fwplan.bak`. Autosaves (see `ARCHITECTURE.md` §11) use the same format, wrapped in a small envelope in the app's data folder, and never touch the user's file.
