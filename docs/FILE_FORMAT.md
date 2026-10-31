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

## Top level (schema version 1)

| Key | Contents |
| --- | --- |
| `format` | Always `"framewright-plan"` |
| `schemaVersion` | Integer, currently `1` |
| `meta` | `id`, `title`, `created` and `modified` (ISO 8601), and `appVersion` of the app that last saved |
| `settings` | `lengthFormat` (display units and precision) and `gridSpacing` |
| `levels` | Map of level id to `{ id, name, elevation, ceilingHeight, floorDepth, ceilingFinish }` |
| `levelOrder` | Level ids from the bottom level up; at least one |
| `wallTypes` | Map of wall type id to `{ id, name, layers[], coreIndex }`. Layers run from the wall's left side to its right (relative to its start and end points), each `{ materialId, thickness, fn }` |
| `materials` | Map of material id to `{ id, name, category, color }` |
| `elements` | Map of element id to an element, discriminated by `kind` (`wallNode`, `wall`; more kinds arrive with later milestones) |

Level elevations are stacked: each level above the bottom one sits at `below.elevation + below.ceilingHeight + this.floorDepth`. Only the bottom level's elevation is free. The app recomputes the stack on load, so hand-edited elevations of upper levels are corrected.

## Validation and repair

Loading validates the whole file against the schema. A file that fails validation is not opened, and the user sees the first few problems with their JSON paths. A file that passes but breaks a cross-reference rule (for example, a wall pointing at a missing node, or an inconsistent level stack) is repaired. The user is told what was fixed, and the plan opens with unsaved changes so the original file is untouched until they save. The app refuses to save a plan that breaks these rules.

## Versioning

- `schemaVersion` increases whenever the format changes incompatibly.
- Older files are upgraded on load, and open with unsaved changes, by a chain of migrations, one per version step (`MIGRATIONS` in `packages/core/src/file/format.ts`). Each migration has a frozen fixture file under `packages/core/test/fixtures/v<N>/`.
- A file from a newer version of Framewright is not opened. The message tells the user to update rather than risk losing data the older app doesn't understand.

## Saving safety

Saves write to a temporary file in the same folder, flush it to disk, and rename it over the target. The previous version is kept next to it as `<name>.fwplan.bak`. Autosaves (see `ARCHITECTURE.md` §11) use the same format, wrapped in a small envelope in the app's data folder, and never touch the user's file.
