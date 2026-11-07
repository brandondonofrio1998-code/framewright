# Framewright

An open-source desktop app for residential design, for Windows and macOS. Draw any closed outline, not only a rectangle. The plan, elevation, section, and 3D views stay linked. Roofs, framing, foundations, and stairs are generated from the walls. Sheets export to PDF, and the plan also exports to DXF, glTF, and a materials CSV.

**0.1.0** is a sketch a contractor can draw in. Stairs follow IRC 2021 geometry: riser, tread, width, headroom, and flight rise. The lumber, headers, joists, and footings are ordinary starting sizes. They are not a span table, a snow-load design, or a frost-depth check. Select a wall to give it a pitch or to make it a gable end.

The app does not use the network unless you turn on Help > Allow Update Checks. That check looks only at this project's GitHub releases and can download the Windows installer or the Mac disk image. Plans stay on this computer.

Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Build and install: [docs/BUILDING.md](docs/BUILDING.md). Bundled assets: [ASSETS.md](ASSETS.md).

```sh
npm ci
npm run dev
```

License: MIT.
