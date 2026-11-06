# Framewright Architecture

Status: **M0 draft, awaiting approval.**
Framewright is an offline desktop app for designing single-family homes. It is built on Electron, TypeScript, React, and Three.js. It follows the general workflow of professional residential CAD tools: object-based walls, openings, and catalog items, automatic roofs and framing, live linked views, and construction documents. Its code, look, assets, and file format are all original.

---

## 1. Stack decisions

| Concern | Choice | License |
|---|---|---|
| Shell | Electron (current stable), electron-vite, electron-builder | MIT |
| Language | TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | — |
| UI | React 19, Zustand (state), Immer (patches) | MIT |
| Docking | dockview | MIT |
| Icons | Lucide | ISC |
| 3D | Three.js + @react-three/fiber + selected @react-three/drei helpers | MIT |
| 3D acceleration | three-mesh-bvh (raycast, hidden-line) | MIT |
| 3D booleans | manifold-3d (WASM) | Apache-2.0 |
| 2D booleans/offsets | clipper2-js | BSL-1.0 |
| Spatial index | rbush | MIT |
| Worker RPC | Comlink | Apache-2.0 |
| Validation | zod | MIT |
| PDF | pdf-lib | MIT |
| DXF | @tarikjabiri/dxf. If it falls short, we write a small ASCII DXF (AC1015) writer of our own | MIT |
| Tests | Vitest, fast-check (property tests), Playwright `_electron` | MIT / Apache-2.0 |
| Textures | ambientCG | CC0 |

### 1.1 Three.js (via react-three-fiber) over Babylon.js
- **Ecosystem fit.** The geometry tools we need are all built for Three: three-mesh-bvh for fast raycasting and the hidden-line pass, three-bvh-csg as a fallback, and the glTF exporter. React-three-fiber lets the 3D scene live in the same React tree as the rest of the UI.
- **Size and control.** Three is a rendering library, not an engine. We want to own the scene graph that the model produces and keep Babylon's engine features (physics, GUI, inspector) out of the bundle.
- **Coordinates.** Core geometry is Z-up, matching plan conventions. Three supports Z-up cleanly with `Object3D.DEFAULT_UP = (0,0,1)` and `camera.up`.
- **Babylon's advantages** are built-in CSG2 (also backed by Manifold), a stable API, and an inspector. None of these outweighs the points above, especially since we run Manifold directly.

### 1.2 Booleans strategy
- **Walls are not built with CSG.** A wall's faces come straight from its plan footprint and the rectangles of its openings: each face is a polygon with holes, triangulated with earcut through `ShapeUtils`. This is fast, exact, and incremental for each wall.
- **manifold-3d** is used where we need general 3D booleans: gable-wall trimming under roof planes, stair openings in floors, foundation steps, and roof plane intersections when building solids.
- **clipper2-js** handles all 2D work: wall layer offsets, room polygons, unions of floor and ceiling areas, foundation footprints, and poché in sections.

### 1.3 Plan rendering: Canvas 2D
- SVG slows down with thousands of nodes (hatches, framing, dimensions). Canvas 2D with a retained **display list** redraws a full two-story plan well within a frame.
- The same display list format (§8.2) also feeds the PDF and DXF exporters, so plan output looks the same on screen, on paper, and in CAD.

---

## 2. Process model (main / preload / renderer)

```
┌──────────────── Main process (Node) ────────────────┐
│ app lifecycle · windows · native menus · dialogs     │
│ file I/O · autosave · crash recovery · recent files  │
│ user library scanning · offline enforcement · CSP    │
│ app:// and userlib:// protocol handlers              │
└───────────────▲──────────────────────────────────────┘
                │ typed IPC (invoke/handle + menu events)
┌───────────────┴─── Preload (sandboxed, contextBridge) ┐
│ window.fw = { file, autosave, library, menu, app }     │
└───────────────▲───────────────────────────────────────┘
                │
┌───────────────┴─── Renderer (sandboxed, no Node) ──────┐
│ React UI · Zustand document store · tools · views      │
│   └─ Geometry Worker (Comlink): @framewright/core      │
│        derived geometry, meshes, framing, hidden-line  │
└────────────────────────────────────────────────────────┘
```

### 2.1 BrowserWindow settings
```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,          // otherwise Chromium downloads Hunspell dictionaries
  devTools: !app.isPackaged,
  preload: <path>,
}
```
- `app.enableSandbox()` is called before `ready`.
- `will-navigate` and `will-redirect` are prevented. `setWindowOpenHandler` returns `{ action: 'deny' }`. `<webview>` is disabled via `will-attach-webview`.
- `session.setPermissionRequestHandler` and `setPermissionCheckHandler` deny every permission (camera, geolocation, notifications, and so on).

### 2.2 Preload API (minimal, typed)
The full contract lives in `apps/desktop/src/shared/ipc.ts` and is shared by main and preload. The renderer never sees `ipcRenderer`.

```ts
interface FramewrightApi {
  file: {
    open(): Promise<OpenResult | null>;                  // native dialog → { handle, displayName, text }
    openRecent(handle: FileHandle): Promise<OpenResult>;
    save(handle: FileHandle, text: string): Promise<void>;
    saveAs(suggestedName: string, text: string): Promise<SaveResult | null>;
    export(kind: 'pdf'|'dxf'|'csv'|'gltf', suggestedName: string, data: Uint8Array): Promise<boolean>;
    recent(): Promise<RecentEntry[]>;
  };
  autosave: {
    write(docId: string, text: string): Promise<void>;
    clear(docId: string): Promise<void>;
    listRecoverable(): Promise<RecoveryEntry[]>;
    readRecoverable(docId: string): Promise<string>;
  };
  library: {
    list(): Promise<LibraryIndex>;                       // user materials and catalog items
    importFolder(): Promise<ImportReport | null>;        // native folder dialog
  };
  menu: { on(cb: (cmd: MenuCommand) => void): Unsubscribe; setState(s: MenuState): void };
  app:  { platform: 'darwin'|'win32'|'linux'; version: string; confirmClose(dirty: boolean): void };
}
```
- **Opaque file handles.** `FileHandle` is a token the main process issues after a native dialog or a recent-files pick. The renderer cannot ask main to read or write an arbitrary path. Main keeps a map from handle to path.
- Every IPC payload is validated with zod in main before use.

---

## 3. Offline enforcement

1. **Request filter.** `session.defaultSession.webRequest.onBeforeRequest` allows only `app:`, `userlib:`, `devtools:`, `data:`, and `blob:` URLs. Everything else is cancelled and logged. In unpackaged dev builds only, the Vite dev server on `localhost` (http and ws) is also allowed. That exception is compiled out of packaged builds.
2. **Custom protocol.** The renderer is served from `app://framewright/...` through `protocol.handle`, registered as `standard`, `secure`, and `supportFetchAPI`. It is never served from `file://`. The handler resolves paths inside the app's `resources` folder only and rejects `..` traversal. User library textures come from `userlib://`, which is limited to the user library folder.
3. **CSP.** Sent as a response header by the protocol handler and duplicated in a `<meta>` tag:
   ```
   default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
   style-src 'self'; img-src 'self' data: blob: userlib:; font-src 'self';
   connect-src 'self' userlib:; object-src 'none'; base-uri 'none';
   form-action 'none'; frame-ancestors 'none'
   ```
   `'wasm-unsafe-eval'` is needed to compile manifold-3d's WASM. `style-src 'unsafe-inline'` is added only if a dependency turns out to need it, with the reason written here.
4. **No phoning home.** No auto-updater, no `crashReporter.start`, no analytics. Spellcheck is off, and `session.setSpellCheckerDictionaryDownloadURL` points at an invalid local URL as a second layer. All fonts use the system UI stack, and PDFs use pdf-lib's built-in standard fonts, so no font files are fetched.
5. **Tests.**
   - `scripts/check-offline.ts` (run in Vitest and CI) scans `packages/*/src`, `apps/desktop/src`, and the built `out/` bundle for `https?://` and fails on any match. A small, reviewed allowlist covers non-request identifiers such as the XML namespace `http://www.w3.org/2000/svg` and license headers inside comments in vendored code. Each allowlist entry records the file and the reason.
   - A Playwright e2e test runs the packaged app through a full workflow. Main exposes a blocked-request counter when `FW_TEST=1`, and the test asserts it is **0**.

---

## 4. Cross-platform plan

| Topic | macOS | Windows |
|---|---|---|
| Menu | App menu (About, Settings… ⌘,, Hide, Quit ⌘Q), then File, Edit, Build, View, 3D, Tools, Window, Help | Same top-level menus. Settings is under Edit, Exit is under File |
| Shortcuts | `CmdOrCtrl` accelerators. Redo is ⌘⇧Z | Redo is Ctrl+Y and Ctrl+Shift+Z |
| Window close | Closing the last window keeps the app running. Reopen on `activate` | Closing the last window quits |
| Recent files | `app.addRecentDocument` plus our own `recent.json` | Jump list through `app.addRecentDocument` plus `recent.json` |
| File association | `.dmg` Info.plist `CFBundleDocumentTypes`, handled through `open-file` | NSIS `fileAssociations`, handled through `argv` and the second-instance lock |
| App data | `app.getPath('userData')` → `~/Library/Application Support/Framewright` | `%APPDATA%\Framewright` |
| Packaging | Universal `.dmg` (arm64 + x64) | NSIS installer `.exe` plus portable `.exe` |
| Signing | Optional. Unsigned builds trigger Gatekeeper (right-click → Open, or `xattr -dr com.apple.quarantine`) | Optional. Unsigned builds trigger SmartScreen ("More info" → "Run anyway") |

- **No native Node modules.** Everything is pure JS or WASM, so the universal macOS build is just a merge with no per-arch rebuilds.
- Path handling always uses `path.join`, and line endings are irrelevant because files are JSON.
- **CI:** GitHub Actions runs a `windows-latest` and `macos-latest` matrix. Each runs typecheck, lint, Vitest, a packaged build, and Playwright e2e on that build. Tagged `v*` pushes also run electron-builder and attach artifacts to a draft GitHub Release. Network access during CI builds is fine; the offline rule applies at runtime.
- **Testing on both OSes:** development happens on Windows. macOS is covered by the CI matrix, including e2e on the packaged app. Before closing a milestone I'll also ask you for a manual smoke test on a Mac if you have one.

---

## 5. Repository layout

npm workspaces monorepo:

```
framewright/
├─ docs/ARCHITECTURE.md, BUILDING.md, FILE_FORMAT.md
├─ ASSETS.md                       every bundled asset + license
├─ LICENSE                         MIT
├─ packages/
│  ├─ core/                        @framewright/core — pure TS, no DOM, no React, no Electron
│  │  ├─ src/model/                schema types, ids, defaults, migrations, validation
│  │  ├─ src/units/                format/parse ft-in & metric, typed-length expressions
│  │  ├─ src/geom/                 vec2/vec3, segments, polygons, planar graph, clipper wrap
│  │  ├─ src/commands/             command registry, history, transactions
│  │  ├─ src/walls/                joins, layer footprints, split/merge
│  │  ├─ src/snap/                 snap engine
│  │  ├─ src/rooms/                face detection, room matching, areas
│  │  ├─ src/openings/ catalog/    parametric generators
│  │  ├─ src/roofs/ framing/ foundations/ stairs/
│  │  ├─ src/mesh/                 mesh descriptors (typed arrays) for 3D
│  │  ├─ src/drawing/              2D display list, plan/elevation/section builders, hidden-line
│  │  ├─ src/takeoff/              materials list
│  │  ├─ src/export/               csv, dxf, pdf, gltf (byte producers, no file I/O)
│  │  └─ test/                     Vitest + fixtures (*.plan documents)
│  └─ catalog/                     bundled starter catalog + materials as JSON (original)
├─ apps/desktop/
│  ├─ electron.vite.config.ts  electron-builder.yml
│  ├─ src/main/                    index, security, protocol, menu, windows, files, autosave, library, ipc
│  ├─ src/preload/                 index.ts (contextBridge)
│  ├─ src/shared/                  ipc contract types + zod schemas
│  ├─ src/renderer/
│  │  ├─ app/                      shell layout, docking, status bar, theme
│  │  ├─ store/                    document store, UI store, selection
│  │  ├─ tools/                    select, wall, door, window, object, dimension, text, camera…
│  │  ├─ views/plan/               canvas renderer, hit testing, overlays
│  │  ├─ views/three/              r3f scene, cameras, materials
│  │  ├─ views/elevation/          elevation/section viewers (display list)
│  │  ├─ panels/                   catalog browser, properties, levels
│  │  ├─ dialogs/                  spec dialogs (tabbed)
│  │  └─ worker/geometry.worker.ts
│  ├─ resources/                   icons, textures (CC0), thumbnails
│  └─ e2e/                         Playwright tests
├─ scripts/                        check-offline, build helpers, thumbnail renderer
└─ .github/workflows/              ci.yml, release.yml
```

- **Keeping `core` pure.** Its `tsconfig` uses `lib: ["ES2023"]` with no `DOM`, so any DOM use fails to compile. ESLint's `no-restricted-imports` blocks `react`, `electron`, `three`, and Node built-ins inside `packages/core`.
- `core` produces plain typed-array mesh descriptors. Only the renderer turns them into Three objects. This keeps core testable in plain Node.

---

## 6. Data model

### 6.1 Units and coordinates
- **Internal unit: inches**, stored as float64. Residential work in the US is drawn in feet, inches, and fractions, and 1/16" is exact in binary floating point. Metric display converts at the UI edge (1 in = 25.4 mm exactly).
- **Tolerances:** `EPS_LEN = 1e-4"` for geometric equality and `EPS_ANG = 1e-7 rad`. Saved files round numbers to 1e-6.
- **Coordinates:** right-handed, X east, Y north, Z up. The plan view flips Y at the view transform. Three uses Z-up.
- **Display formats:** `ft-in-frac` (12'-6 1/2"), `in-frac`, `mm`, `cm`, `m`, with precision of 1/2" to 1/64" or 1 mm. The parser accepts `12'6"`, `12' 6 1/2"`, `12-6`, `150`, `150mm`, `3.2m`, and `+`/`-` expressions such as `10'+3 1/2"`.

### 6.2 Document

```ts
type Id = string;   // crypto.randomUUID(); stable, never reused

interface PlanDocument {
  format: 'framewright-plan';
  schemaVersion: number;              // integer, starts at 1
  meta: { id: Id; title: string; created: string; modified: string; appVersion: string };
  settings: ProjectSettings;          // display units, grid, snaps, defaults per level/tool
  levels: Record<Id, Level>;
  levelOrder: Id[];                   // bottom → top
  wallTypes: Record<Id, WallType>;
  materials: Record<Id, MaterialDef>; // embedded copies of every material used
  catalogDefs: Record<Id, CatalogDef>;// embedded copies of every catalog def used
  elements: Record<Id, Element>;      // all level-hosted elements, discriminated by `kind`
}

interface Level {
  id: Id; name: string;
  elevation: number;          // top of subfloor, absolute
  ceilingHeight: number;      // finished floor → finished ceiling (default 97 1/8" → 8' stud wall)
  floorDepth: number;         // floor structure depth of this level (joists + subfloor)
  ceilingFinish: number;
}

interface ElementBase { id: Id; kind: ElementKind; levelId: Id; locked?: boolean; name?: string }
```

**Embedding definitions.** Materials and catalog definitions used by a document are copied into it. A `.plan` file opens identically on another machine without the user's library. Library items keep a `sourceId` so "update from library" can be added later.

### 6.3 Walls

```ts
interface WallNode extends ElementBase { kind: 'wallNode'; p: Vec2 }

interface Wall extends ElementBase {
  kind: 'wall';
  a: Id; b: Id;               // WallNode ids; geometry is the centerline a→b
  typeId: Id;                 // WallType
  height: number | null;      // null → derived from level (ceiling + floor above)
  baseOffset: number;         // from level elevation
  role: 'auto' | 'exterior' | 'interior' | 'divider';  // divider = invisible room divider
  roof: WallRoofSpec;         // pitch (rise/12), overhang, gable|hip|shed-high|none, gable overhang
  finishes: { left?: Id; right?: Id };  // material overrides by side (left/right of a→b)
}

interface WallType {
  id: Id; name: string;
  layers: { materialId: Id; thickness: number; fn: 'finish'|'sheathing'|'structure'|'insulation'|'air' }[]; // left→right
  coreIndex: [first: number, last: number];  // structural core, used for join priority & framing
  framing?: { member: '2x4'|'2x6'|...; spacing: number };
}
```

- **Topology through shared nodes.** Walls that meet share a `WallNode`. Moving a node moves every wall attached to it, which is how corners stay joined while dragging. T and X intersections split the through-wall at the node. Two collinear walls of the same type that share a degree-2 node are drawn and framed as one continuous wall.
- **Joins** are derived, never stored. At each node, incident walls are sorted by angle. Each pair of adjacent walls intersects its face lines layer by layer, which handles L, T, X, and n-way joins. Layers whose function ranks higher (core) run through and lower layers stop against them. Very acute joins (< 15°) are capped with a square end so miters don't spike.
- **Exterior detection** (`role: 'auto'`): a wall is exterior if one side faces the unbounded face of that level's wall graph.
- **Curved walls** are out of scope for M1–M7. They can be added later with a schema migration (an arc bulge on the wall).

### 6.4 Openings
```ts
interface Opening extends ElementBase {
  kind: 'door' | 'window';
  wallId: Id;
  t: number;                  // distance along wall from node a to opening center
  width: number; height: number; sill: number;  // sill = 0 for doors; head = sill + height
  side: 'left' | 'right';     // exterior/swing side relative to a→b
  hinge: 'start' | 'end';
  style: DoorStyle | WindowStyle;  // parametric: hinged, double, pocket, bifold, sliding / casement, double-hung, slider, fixed, awning
  casing: { width: number; materialId?: Id };
  materials: { frame?: Id; panel?: Id; glass?: Id };
}
```
- Commands keep `t` within the wall (§7.3). When a wall is split, openings are moved to whichever new wall contains their center.

### 6.5 Rooms (auto-detected, user data persistent)
- **Detection.** For each level, build a planar graph from wall centerlines, including dividers and the splits at intersections. Find faces by walking the half-edges, always taking the next edge clockwise. Bounded faces are room candidates. The room polygon is the face inset to the inner wall surfaces using the layer footprints and clipper2.
- **Stable identity.** A `Room` element stores the user's data (name, type, floor/ceiling materials, ceiling height override) plus a `seed: Vec2`. After every re-detection, each Room is matched to the face that contains its seed. If none does, it goes to the face with the largest overlap with its last polygon, and its seed moves to the new face's pole of inaccessibility. Unmatched faces get default rooms. Rooms that lose their face are kept as orphans until the next save, so undo works cleanly. This matching gets dedicated tests.
- **Area.** Interior area uses the inner wall surfaces. The exterior footprint area (for takeoffs) comes from the outer faces. Both are derived.
- **As built in M2.** The inset is a pure TypeScript offset of each centerline edge by half the wall thickness, with consecutive offset lines intersected. It is exact for straight walls. clipper2 stays out until a later milestone needs polygon booleans (section poché, floor unions). Faces whose inner area is under 2 sq ft are dropped. Reconciliation runs inside the wall command, on polygons snapshotted before the edit, so one undo restores the rooms. A room that no longer matches a face is deleted in that same command rather than kept as an orphan. The seed moves to an interior point only when it has fallen outside the face. A window's exterior side comes from the face graph (the side facing the unbounded face). A wall between two rooms is not exterior. A wall that is not part of any closed room still uses the centroid guess. Plan labels show the name and the interior area in square feet, to one decimal.

### 6.6 Catalog objects
```ts
interface CatalogDef {        // embedded copy; library holds the master
  id: Id; sourceId?: string; name: string; category: string[];   // e.g. ['Kitchen','Base Cabinets']
  generator: 'cabinet.base' | 'cabinet.wall' | 'appliance.range' | 'fixture.toilet' | ...;
  params: Record<string, number | string | boolean>;             // defaults
  paramSchema: ParamSchema;   // for spec dialog + validation
  materials: Record<string, Id>;  // slot → material
}
interface CatalogInstance extends ElementBase {
  kind: 'object'; defId: Id; p: Vec2; z: number; rotation: number;
  params: Partial<CatalogDef['params']>;  // overrides
  hostWallId?: Id;            // optional snap-to-wall host
}
```
- Generators are pure functions in `core/catalog` that produce mesh descriptors plus plan symbols. No mesh files are imported in M2. User-imported items can later add glTF meshes, licensed by the user.
- **As built in M2.** The starter catalog is code (`STARTER_CATALOG`), not JSON and not imported meshes: base, wall, and tall cabinets, a range, refrigerator, and dishwasher, and a toilet, sink, and tub, at generic sizes. A definition is copied into `catalogDefs` the first time it is placed, keyed by a stable id such as `starter.base-24`. Every starter item hosts to a wall: its back sits against the wall face, and its center is half its depth further into the room. Hosted objects follow wall edits the way openings do; if the wall is deleted the object stays where it is and loses its host. Plan symbols are parametric polylines and arcs. 3D meshes are M3. Schema version went from 1 to 2 because `catalogDefs` is a required top-level key; version 1 files gain an empty map on load.

### 6.7 Other elements (summary; detailed at their milestone)
- **`dimension`**: an ordered list of references (`{ elementId, feature: 'nodeA'|'face:left'|'opening:center'|... }`) plus a fallback point for each. It is associative and updates when walls move.
- **`text`**: point, string, size, rotation.
- **`roofPlane`** (M5): a polygon in plan with base height and pitch, made by the auto-roof generator or drawn by hand. It records `generatedFrom: wallIds` so it can be rebuilt.
- **`stair`** (M5): path type (straight, L, U later), width, run and rise rules, and the floor it connects to.
- **`foundation`** (M5): type (slab or stem wall), footing size, and the walls it sits under.
- **`camera`** (M3): a saved view. As built, `mode` is `orbit` or `walk`, and `eye` / `target` are Z-up points in inches. It is not drawn in plan.
- **`sheet` / `viewport`** (M7): sheet size, title block fields, placed views with scale.

### 6.8 Derived (never saved)
Wall footprints by layer, joins, rooms (polygons and areas), meshes, framing members, roof solids, foundation solids, takeoff quantities, and display lists. Framing is fully derived from walls and settings. Manual framing edits can come later as stored overrides.
- **As built in M5a.** Each wall's structure layer is framed instead of extruded as a solid block. Studs are 16" on center with one flush at each end, between a bottom plate and two top plates, so a default 8' wall uses a 92 5/8" stud. A door cuts the bottom plate; a window keeps it and adds a sill with cripples below. Each opening gets a king and one or more trimmers on each side, a doubled header (2x4 through 3', 2x6 through 4', 2x8 through 6', 2x10 through 8', 2x12 after that), and cripples above the header. That schedule is Framewright's, not a snow-load span table. The plan draws the studs, kings, and trimmers. The 3D view and sections use the same members, so a stud bay is open and a cut through a stud shows the lumber. Corner studs from the two walls are not combined into one post. Roofs, foundations, and stairs are still ahead.
- **As built in M5b.** Build Roof puts a gable on a closed rectangular outline, and Hip Roof puts a hip on the same kind of outline. The gable ridge runs the long way, with the end walls flush. The hip makes every side an eave: two trapezoids and two triangles on a long room, four triangles meeting at a point on a square. Both default to 6 in 12 and run 12 inches past the outside face, so the fascia is lower than the plate. A hip can give each side its own pitch; a steeper side reaches the ridge sooner, and the ridge moves toward that side. The plan draws the outlines, and the 3D view builds them as 1/2 inch sheathing. Moving, stretching, or changing the height of the walls rebuilds that roof in the same undo step, with the same pitch and overhang. A wall edit that leaves an outline that is not an axis-aligned rectangle leaves the old roof where it was. Building either roof still replaces whatever roof is there. Walls are not cut to the rake. The toolbar uses one pitch for every side.
- **As built in M5c.** Build Foundation puts a 4 inch slab under each closed outline and an 8 inch stem wall at the outside face of the exterior walls. The stem starts the same height as the slab, and the slab fills the inside of the stem, so the two do not overlap. Select the footing outside the wall and set Above the floor to continue the stem up, as far as 12 feet. Set Under the floor to drop the slab and leave that much open height, with the stem spanning the gap. A 16 inch footing is centered on those walls and extends 12 inches below the slab. The top of the slab meets the underside of the 3/4 inch floor unless Under the floor is set. An L-shaped outline works. The plan draws the slab, the stem, and the footing strips, and the 3D view extrudes them in concrete. Building it again replaces the old foundation in one undo step. It does not follow later wall edits until it is built again. When the open height is at least a 2x10, a rectangular foundation gets joists at 16 inches on center spanning the short side, lapping the stem at each end. An L is framed as two bays, and the edge where they meet does not lap. Any other outline gets none.
- **As built in M5d.** The Stairs tool takes two clicks, the bottom of the flight and the top. The flight climbs to the level above with equal risers of at most 7 3/4 inches and equal treads of at least 10 inches, and it is 36 inches wide. A run that is too short, a ceiling too low for 6'8" at the first step, or a rise over 12 feet 7 inches is refused. The plan draws the outline, the treads, and the handrail on the lower level, and the opening on the level above. The 3D view builds the treads and closed risers, cuts the stair's footprint out of the ceiling below and the floor above, and adds one handrail on the left, 36 inches above the nosings. A flight of fewer than four risers has no rail. The ends of the rail do not return, and there is no second rail. Deleting the upper level removes the stair. The plan draws both flights, the landing, and a handrail on the left of each flight. Shift-click the turn, then click the top. A turn of 90 degrees builds an L stair with a square landing. A click back along the first flight builds a U stair: the return sits beside the first flight, and the landing is one stair wide and two stairs deep. Winders come later. A straight flight is still two clicks. The Deck tool takes two clicks on the outside of a wall: the start of the edge against the house, then the outer corner. The deck is at least 3 feet each way, at most 40 feet along the wall and 20 feet out. 2x8 joists span the short side. Posts and a top rail run the three open sides. Balusters fill each bay so a 4 inch sphere cannot pass. There is no stair down from the deck. It stays where it was built. The Electrical tool clicks a wall for a receptacle, Shift-clicks a wall for a switch, and clicks off a wall for a ceiling light. A receptacle is 18 inches to center and a switch is 48 inches. A light sits on the ceiling. A device can be put on a circuit from 1 to 20, and the plan shows that number. These devices stay where they were placed. The Plumbing tool clicks a wall for a hot and cold supply at 20 inches, Shift-clicks a wall for a drain at 12 inches, and clicks off a wall for a floor drain. The Pipe tool takes two clicks for a straight supply. Shift-click the end for a drain. A supply is 3/4 inch square and centered 20 inches above the floor. A drain is 2 inches square and centered 12 inches above the floor. Wall fixtures stay where they were placed. The Site tool clicks the property corners and clicks the first corner again to close the line. Shift-click places a north arrow. North points up the plan. Set Ground in 3D on the property line to lay a pad at a grade within 20 feet of the floor. Once a property line exists, the next closed shape is a contour: a flat terrace 1 foot above the floor and 2 inches thick. It does not slope the lot. The Plant tool clicks a tree, 16 feet across and 20 feet tall. Properties edits the canopy and the height. The Road tool clicks the start and the end of a driveway. A new driveway is 12 feet wide and 4 inches thick, with its top at the level floor. Width can be from 8 feet to 40 feet.
- **As built in M6.** The Materials tab lists quantities derived from the plan: wall sheet goods with door and window holes removed, studs and plate length, finished floor area, sloped roof sheathing, concrete volume for a slab and its footings, openings, and stair treads. Export CSV, from the tab or File > Export Materials, writes those lines to a `.csv` file. The list is not stored in the plan.
- **As built in M7.** The Sheet tab draws one ARCH D sheet, 36 by 24 inches. A border and a title block show the plan title, the level name, the date, and the scale. The plan scale is the largest standard scale that fits, unless the sheet scale control picks one. An empty plan is shown at 1/4 inch to the foot. When the plan has walls, the band above the title block is split in half: the front elevation on the left and a section through the middle on the right. A second sheet shows the back, left, and right elevations and a section from the left. When the level has a door or a window, an 8 inch column on the right lists each size, marked D1 and W1, with a count. File > Export Sheet writes both pages when the plan has walls, and the plan page alone when it does not. File > Export DXF writes the active level's plan as an ASCII DXF in model inches, with one layer for reference, walls, openings, objects, rooms, and dimensions. Wall fills are closed outlines. File > Export glTF writes the whole 3D model as a binary glTF in meters, Y up, colored from the plan materials. Texture images are not embedded. File > Import DXF reads an ASCII DXF onto the active level as a reference drawing, in model inches. Unitless files are read as inches. The lines do not become walls. Blocks, hatches, and old POLYLINE entities are skipped. The sheet is not saved as its own element. View > Layers keeps named layer sets on the plan. A new plan shows every layer until a set is saved. Dark Mode stays on this computer. The sheet and a DXF still include hidden layers.

### 6.9 File format and migrations
- The file is UTF-8 JSON with the extension `.fwplan` (see §14.1 for how `.plan` is handled). The format is our own and is documented in `docs/FILE_FORMAT.md`.
- **Loading:** parse, read `schemaVersion`, run migrations one version at a time (`migrations[v]: (doc) => doc`, each pure and tested with a frozen fixture), validate with zod, then run `repairInvariants` (drop orphan nodes, clamp openings) and report anything it fixed.
- If `schemaVersion` is newer than the app supports, the file is refused with a clear message. It is never silently downgraded.
- **Saving** is atomic: write `name.tmp`, fsync, then rename. The previous file is kept as `name.bak` (configurable).

---

## 7. Commands, undo/redo

### 7.1 Design
The command pattern is combined with **Immer patches**. Commands describe intent and are serializable. Immer records the exact changes, and the inverse patches are the undo.

```ts
interface CommandDef<P> {
  type: string;                                   // 'wall.create', 'wall.split', 'opening.move'…
  label: (p: P) => string;                        // "Draw Wall", shown in Edit ▸ Undo Draw Wall
  run: (draft: Draft<PlanDocument>, payload: P, ctx: CmdContext) => void;  // mutate draft only
  mergeKey?: (p: P) => string | undefined;        // coalesce e.g. repeated typing in a field
}

interface HistoryEntry { label: string; patches: Patch[]; inverse: Patch[]; at: number; mergeKey?: string }
```
- **`dispatch(type, payload)`** runs `produceWithPatches`, validates invariants (fully in dev and tests, cheaply in production), pushes a history entry, bumps `doc.revision`, and broadcasts the patches. Redo replays `patches` and undo replays `inverse`.
- **Transactions** group several commands into one undo step, for example "Auto Roof", which deletes old roof planes and creates new ones.
- **Drags never write to the document while moving.** Tools hold an ephemeral preview (moved node positions) that views draw on top. On mouse-up a single command commits. Escape cancels with no history entry.
- **History is not saved.** Save points mark the "dirty" state. Undoing back to the save point makes the document clean again.
- Commands live in `core` and are unit-tested as pure functions of (document, payload) → document.

### 7.2 Why patches
- Undo cost grows with the size of the change, not the size of the document.
- The same patches drive incremental re-derivation in the worker (§8.1) and keep detached windows in sync (§8.4).

### 7.3 Invariants (checked after each command)
- Every wall references two existing, distinct nodes on its level. No wall has zero length.
- Every node is used by at least one wall. Orphans are removed in the same command.
- Each opening's `wallId` exists and `t ± width/2` lies within the wall length.
- `levelOrder` matches `levels`.
- Every referenced material, wall type, or def exists.

---

## 8. View pipeline

```
 Document (Zustand, main thread)
   │  patches + revision
   ▼
 Geometry Worker (holds a mirror doc, applies patches)
   │  dependency graph → dirty set → recompute
   ▼
 DerivedModel (per level): wall footprints/layers, rooms, opening cutouts,
                           mesh descriptors (transferable typed arrays),
                           roofs, framing, foundations, takeoff
   │  versioned by revision; stale results dropped
   ▼
 Views (read-only):
   Plan     → display list → Canvas 2D      (also → PDF/DXF)
   3D       → mesh descriptors → Three (r3f), instanced framing
   Elev/Sec → hidden-line display list → Canvas 2D (also → PDF/DXF)
```

### 8.1 Incremental derivation
- Every derived artifact has declared inputs. A wall footprint depends on the wall, its type, and all walls at both of its nodes. Rooms for a level depend on every wall on that level, which stays cheap: about 100 walls per level takes milliseconds. An opening mesh depends on the opening and its host wall.
- Patch paths (`elements/<id>/…`) are mapped to dirty ids, and only the affected artifacts are recomputed.
- **Instant feedback while dragging.** Because `core` is pure, the main thread runs the cheap functions (footprints of the dragged walls and their neighbors) synchronously for the preview. Heavy work (meshes, rooms, framing, hidden-line) runs in the worker after commit.

### 8.2 Display list (shared 2D primitive format)
```ts
type Prim =
  | { t: 'line'; a: Vec2; b: Vec2; pen: PenId }
  | { t: 'polyline'; pts: Vec2[]; closed: boolean; pen: PenId }
  | { t: 'poly'; rings: Vec2[][]; fill: FillId; pen?: PenId }   // holes supported
  | { t: 'arc'; c: Vec2; r: number; a0: number; a1: number; pen: PenId }
  | { t: 'text'; p: Vec2; s: string; size: number; rot: number; align: Align }
  | { t: 'dim'; ... }                          // expanded to lines+text per style
interface DisplayItem { elementId?: Id; layer: DrawLayer; prims: Prim[] }
```
- Coordinates are in model inches. Pens (weight, color, dash) and fills (solid or hatch pattern) are named styles, so the screen, PDF, and DXF backends each map them natively. DXF output uses one layer per `DrawLayer`.
- **Hit testing** uses an rbush index of item bounds, followed by exact distance checks on the primitives.
- **As of M2:** plan geometry (joins, display list, snap scene, picking, rooms, catalog symbols) is derived on the main thread with linear scans and cached per document revision. The geometry worker and rbush index arrive when meshes and framing make derivation expensive (M3/M5), behind the same `core` functions. Joins use a through/butt rule: a collinear pair runs through, preferring the thicker pair, and other walls butt into its face. Per-layer core priority comes with framing in M5. Dimension text `p` marks the bottom edge of the label. Pick order is dimensions, then openings, then objects, then walls, then rooms.

### 8.3 3D view
- The r3f scene is built from mesh descriptors, one `BufferGeometry` per element and reused across updates. Framing and other repeated members use `InstancedMesh`.
- **Cameras:** orbit (perspective or orthographic toggle) and walkthrough (WASD plus mouse look, eye height from the level, collision optional later).
- **Materials:** `MeshStandardMaterial` built from bundled ambientCG CC0 sets (1K color, normal, and roughness maps). World-space UVs come from core, so textures keep real-world scale. Each material records its real size per tile.
- **As built in M3a.** `buildPlanMeshes` extrudes each wall layer (with door and window holes cut directly, no CSG), a 3/4" floor under each room, a door slab, a glass pane, and a box for each catalog object. Coordinates are Z-up inches. UVs are inches in the face plane. A 1/2 inch gypsum ceiling fills each room up to that room's ceiling height, on the inside face. The orbit view shows that cap. A stair does not cut a hole in the ceiling, and the ceiling is not drawn in plan.
- **As built in M3b.** Four ambientCG CC0 sets are bundled (1K color, normal, and roughness): a smooth white wall for gypsum, softwood for framing and for door and cabinet panels, wood planks for lap siding, and an oak floor under each room. Each set's published size, in centimeters, is stored on the material as a tile in inches, and the mesh UVs are inches, so a repeat is that real size. OSB stays a flat color: no CC0 OSB or plywood scan had a published size. Glass stays untinted. The walk camera sits 5'-6" above the active level's floor, moves with WASD (Shift is faster) and looks with the mouse after a click. It does not collide with walls. A saved camera is an element (`orbit` or `walk`, eye and target) restored from the camera list. It is not drawn in plan. An orbit can be orthographic: 3D > Orthographic View, or the Ortho button, uses a flat camera with the same drag, scroll, and pan. Saving that view stores `projection: "orthographic"` and the zoom. A walk camera stays in perspective. One directional light casts a soft shadow onto the model. The shadow covers the house, about one and a half times its largest dimension, and glass does not cast.
- **Performance targets** (3,000 sq ft, two stories, about 150 walls, 40 openings, 120 objects, full framing): 60 fps orbit on a mid-range integrated GPU, under 16 ms main-thread work per wall-drag frame, under 300 ms worker recompute after a commit, and full framing regeneration under 1 s. A benchmark fixture house in `core/test/fixtures` is used to track these.

### 8.4 Multiple windows
- The **primary window's renderer owns the document.** A detached view window (Window ▸ Open View in New Window) gets a `MessagePort`, brokered by main with `MessageChannelMain`. It receives the full document once, then patches. Its edits are sent as commands to the primary window. Undo and history stay in a single place.

### 8.5 Elevations and sections (M4 detail preview)
- The worker uses the 3D mesh descriptors with an orthographic projection.
- **Section cut:** intersect the meshes with the cut plane to get closed loops, which are filled as poché (clipper union by material).
- **Beyond the cut:** extract feature edges (boundary edges and edges whose dihedral angle exceeds a threshold, plus silhouettes). For each edge, sample visibility by raycasting with three-mesh-bvh along the view direction. Wherever visibility changes, bisect to find the exact break point. The result is vector lines, which go directly into the display list and on to PDF and DXF.
- **As built in M4a.** `buildElevation` takes the same meshes as the 3D view. Front looks from the bottom of the plan toward +Y, and back, left, and right are the other three sides. Sheet X is to the right and sheet Y is Z. An edge is drawn when it is a boundary, a crease steeper than 15° between face normals, or a silhouette. Visibility is a ray from the edge toward the camera; where it changes, the edge is bisected. Hidden portions are left out. The Elevation tab pans and zooms like the plan. The ray test is a straight scan, which is enough for one house; three-mesh-bvh waits until that scan is slow.
- **As built in M4b.** `buildSection` cuts those meshes with a vertical plane. The plane faces the same four ways, and a slider moves it from the near side of the model to the far side. The cut is the intersection of the triangles with the plane, stitched into closed loops and filled by material: framing and floors in the structure tone, sheathing, insulation, and finishes in their own. An edge shared by two cuts of the same material is dropped, so those cuts read as one poché. Glass is an outline. Past the plane, the drawing is the elevation of what remains. clipper2 stays out: these solids do not overlap, so cancelling a shared edge is the union. A cut that can overlap, and the geometry worker, wait until a later milestone needs them.

---

## 9. UI shell

- **Layout:** native menu bar. Below it, a main toolbar with grouped buttons (Select · Walls · Doors · Windows · Objects · Stairs · Roof · Dimensions · Text · Camera). Groups with variants open flyouts. The left dock holds the Library (search, then click an item and click a wall to place it). The right dock holds properties and levels. The center has dockview tabs or tiles for Plan, Elevation, Section, and 3D. The status bar shows cursor X/Y in display units, the active tool, the snap mode toggles, and the level selector.
- **Theme:** an original palette. Light theme by default: warm graphite neutrals (`#1F2328` text, `#F4F3F1` chrome, `#FFFFFF` canvas) with a teal accent (`#0E7C86`). Dark theme later. No animations except camera movement.
- **Spec dialogs** open on double-click. They are tabbed (General, Structure, Materials, Roof, Framing, …) and built from each element kind's declarative schema. Every edit is a command, so the whole dialog applies as one undo step.
- **Tools** are state machines (`idle → placing → dragging …`) that receive normalized pointer and keyboard events in model coordinates. Typing a number while drawing opens an inline length/angle field.
- **Snapping** (`core/snap`, pure) works like this. Candidates come from the rbush index near the cursor: endpoints and nodes, midpoints, intersections, on-wall projections, extension lines, and grid. Angle snapping (15°, 45°, 90°) applies relative to the X axis and to the previous segment. Snaps resolve in priority order (point snaps > angle × length > grid) within a pixel tolerance. The result carries a reason, which the UI shows as a glyph and tooltip. Snaps are unit-tested on synthetic scenes.
- **Plan editing (M2):** the tools are Select Objects (click, shift-click, box select, drag walls, drag a selected wall's end handles, drag dimension offsets, slide openings, drag hosted objects along walls or free objects by delta), Walls (click per corner, type a length and Tab for an angle, finish on an existing end, double-click, Enter, or Esc), Break Wall, Doors, Windows, Objects (armed from the Library, then click the side of a wall), and Dimensions (two points, then an offset; ends that snap to a wall end stay attached to it). Pan with middle-drag or Space+drag, zoom with the wheel, and press F to fill the window. Snap toggles (Object, Angle, Grid) are per-session for now. Rooms can be selected and renamed; they are not dragged or deleted.

---

## 10. Testing strategy

| Layer | Tooling | Examples |
|---|---|---|
| Core math | Vitest + fast-check | L/T/X/acute joins, layer footprints, planar faces, room matching, polygon areas, offsets, snap resolution, unit parse/format round-trips |
| Commands | Vitest | each command + undo returns the identical document; invariants hold under random command sequences |
| File format | Vitest | each migration on frozen fixtures; save → load round-trip |
| Systems (M5+) | Vitest | roof planes vs hand-calculated geometry, stud counts/headers by opening width, stair rise/run per code |
| Exports | Vitest golden files | DXF entity lists, CSV takeoff, PDF page count/objects |
| Offline | Vitest + e2e | URL scan; zero blocked requests in a full session |
| UI flows | Playwright `_electron` on Win + macOS | draw walls with typed lengths, undo/redo, save/open, autosave recovery, menus |

Every milestone closes with `npm run verify` (typecheck, lint, unit, offline scan, build, e2e) passing locally and green CI on both operating systems.

---

## 11. Autosave, recovery, recent files, user libraries

- **Autosave.** While the plan has unsaved changes, it is written every 60 s (only if it changed since the last autosave) and whenever the window loses focus. Writes are atomic, to `userData/autosave/<docId>.json`, along with the title, the original file path, and a timestamp.
- **Crash detection.** An autosave file exists only while its plan has unsaved changes: saving, choosing Don't Save, or closing a clean window deletes it. Any autosave still present at launch therefore belongs to a session that ended without resolving its changes (a crash, power loss, or forced kill). The single-instance lock guarantees no other live window owns it. A recovery dialog lists the files so the user can restore, discard, or decide later. No separate lock file is needed.
- **Recent files.** `userData/recent.json` keeps the last 12 files, de-duplicated, with missing files pruned when the list is shown. The list also feeds OS recent-document integration.
- **User library.** `userData/library/{materials,catalog}/…`. Tools ▸ Import Library Folder copies a folder in after validation. The expected layout is `materials/*.json` + textures and `catalog/*.json` + optional thumbnails. Everything goes through zod schemas, and an import report lists anything rejected. Libraries are indexed by main and served over `userlib://`.

---

## 12. Milestone breakdown

M1 is too big for one pass, so I propose splitting it:

- **M1a, shell.** Workspace scaffold, Electron security and offline enforcement, `app://` protocol, CSP, menus for both platforms, the offline URL test, the CI matrix, and an empty dockview layout.
- **M1b, document core.** Data model, units parse/format, the command and history system, file open/save/save as, migrations, autosave and recovery, recent files, and levels.
- **M1c, plan editor.** Canvas plan view, wall tool with typed lengths, joins, split, move, the snap engine, dimensions, the status bar, and Playwright flows.

M2 is done: **M2a** doors and windows hosted in walls, **M2b** the starter catalog and Library panel, **M2c** room detection with area labels and exterior sides taken from the room graph. M3 is done: **M3a** the orbit view of wall, floor, opening, and object solids, and **M3b** bundled textures, the walkthrough, and saved cameras. M4 is done: **M4a** elevations (visible crease and silhouette edges) and **M4b** sections (a vertical cut filled by material, with the elevation of whatever is past the cut). M5 is split into **M5a** (wall framing: plates, studs, and headers), **M5b** (roofs), **M5c** (foundations), and **M5d** (stairs). M5a through M5d are done for their first slices: framing, a gable or hip on a rectangle, a slab with an 8 inch stem wall and a perimeter footing, and a straight stair, an L stair, or a U stair to the level above. The stem wall can continue above the floor, and the slab can drop to leave a basement under it. A basement deep enough for a 2x10 gets floor joists, including an L framed as two bays. The Text tool places a note on the plan. View > Dark Mode switches the workspace to a dark theme, remembered on this computer. View > Layers hides a kind of plan geometry without changing the file. The sheet still draws everything. **M6** lists materials from the plan and can save them as CSV. **M7** shows one ARCH D sheet of the plan, can save that sheet as a PDF, can save the plan as a DXF, can save the 3D model as a glTF, and can import an ASCII DXF as a reference drawing. Each room has a flat 1/2 inch gypsum ceiling at its ceiling height.

## 13. Known risks
- **Hip roofs with mixed pitches** need a weighted straight skeleton. No permissively licensed TS implementation is mature enough, so we will write our own with heavy tests. This is the riskiest geometry in the project and will get its own sub-milestone in M5.
- **Hidden-line performance** on full houses may need edge culling by bounding box and caching for each element.
- **Bundle size:** textures should stay around 40 MB at 1K resolution. If that grows, they can move to Git LFS.

## 14. Decisions
1. **File extension** (proposed, awaiting confirmation): Save writes `.fwplan`, and the installers register only `.fwplan`. Open also accepts `.plan`, but only files whose JSON has `format: 'framewright-plan'`. Any other `.plan` file, including Chief Architect's, is refused with a clear message. We never register a `.plan` file association, so Chief's files stay with Chief.
2. **Licenses:** ISC (Lucide) and BSL-1.0 (Clipper2) are approved in addition to MIT/Apache/BSD/CC0/CC-BY. We use system fonts, so no OFL fonts are needed.
3. **Stair code basis:** IRC 2021 R311.7 by default (max riser 7¾", min tread 10", min width 36", headroom 6'8"), configurable per project.
4. **Repo:** public on GitHub.
5. **M1** is split into M1a, M1b, and M1c, with a stop for review after each.
