# Doors, wall materials, and framing

These changes address the seven items in the November 7, 2026 Obsidian note, “Framewright Edits Needed.”

## Garage doors and windows

Click **Garage Door** beside Doors on the toolbar. The initial size is 9 feet wide by 7 feet high. Set any custom width and height in Properties before clicking a wall. Garage doors have an overhead plan symbol and sectional panels in 3D, and appear in opening schedules. Select an existing door to change its style or dimensions. Widths that extend beyond the host wall or overlap another opening are refused.

Click **Windows** to set width, height, and sill before placement. The Properties tab opens automatically when switching tools or selecting an element. Select an existing window to resize it. Enter lengths in the current display units or explicitly with feet/inch marks, then press Enter.

## Wall layers and insulation

Select a wall in Plan. Under **Properties → Materials & framing**, each layer has a material selector and thickness field. Nonstructural layers can be removed and added. Edits affect the selected wall; other walls keep their assemblies. Undo restores an edit, including removed layers. Room and foundation geometry follows assembly thickness changes.

Layers are ordered relative to the direction the wall was drawn. If siding is on the inside, use **Flip material sides**. This reverses the material stack without moving the wall endpoints or its openings. Existing plans are not automatically reoriented.

Click **Add insulation & material choices** to add fiberglass batts, mineral wool batts, dense-pack cellulose, open-cell and closed-cell spray foam, rigid foam board, plywood, fiber cement, and brick veneer. Choose **Cavity insulation** for fill between studs; this does not add wall thickness. Its 3D geometry and quantity exclude lumber and opening voids. Rigid foam can also be added as a separate continuous layer with its own thickness.

The Materials tab still provides quantities and CSV export. Expand **Edit material names & colors** to change a material throughout the plan. OSB uses an original wood-flake pattern in the 3D viewer; drywall uses the bundled pale wall texture. Other new materials currently use colors, not photographic scans. The generated OSB pattern is not embedded in glTF exports.

## Framing and visibility

The selected wall's **Stud spacing** chooses 16 or 24 inches on center and regenerates studs and quantities. Openings and wall ends introduce additional framing, so not every visible gap is the nominal spacing.

In 3D, the **Walls** selector switches between all materials, framing and utilities, or framing and insulation. Separate checkboxes hide roof sheathing and ceilings. These are viewing controls: they do not remove materials from the plan or quantities. Use the Electrical, Plumbing, and Pipe tools in Plan to place utilities, then inspect them in 3D.

The roof shown is sheathing, not a finished shingle or metal roof assembly. The roof toolbar tool builds a gable on an ordinary rectangle and a hip on other closed outlines; Hip Roof explicitly requests a hip. Wall Properties describes roof pitch as rise per 12 inches of run.

**Overall thickness** is the entire assembly. The default Exterior 2×6 totals 7 3/16 inches: 3/4-inch siding + 7/16-inch OSB + 5 1/2-inch framing + 1/2-inch drywall. The nominal lumber label is not the total wall thickness.

## Compatibility and validation

Older plans open with 16-inch stud spacing and no cavity insulation unless edited. New fields are optional. Plans saved with garage doors require this updated app; version 0.1.0 does not recognize that door style. Keep originals when testing new builds.

Core regression tests cover spacing, undo, isolation between wall assemblies, insulation voids and quantities, schema validation, and garage-door sizing, symbols, meshes, and schedules. The Electron regression test exercises the new controls together. This update does not change the app's existing structural-design assumptions or add thermal-performance calculations.
