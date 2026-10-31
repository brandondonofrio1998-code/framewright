# Bundled assets and licenses

Every asset that ships inside Framewright is listed here with its source and license. Accepted licenses: MIT, Apache-2.0, BSD, ISC, BSL-1.0, CC0, and CC-BY (with attribution below).

| Asset | Used for | Source | License |
|---|---|---|---|
| Lucide icons (via `lucide-react`) | Toolbar icons | https://lucide.dev | ISC |
| Dockview base stylesheet | Docking panel layout | https://github.com/mathuo/dockview | MIT |

Fonts: none are bundled. The UI uses the operating system's font (Segoe UI on Windows, San Francisco on macOS).

3D textures are ambientCG scans, CC0, at 1K JPG. Each set is color, OpenGL normal, and roughness. The plan stores the published size (converted to inches) and the meshes are UV-mapped in inches, so one repeat is that size. Sheathing has no map: ambientCG had no OSB or plywood scan with a published size. Glass is untinted.

| Files | Used for | Source | Published size | License |
|---|---|---|---|---|
| `smooth-wall/color.jpg`, `normal.jpg`, `roughness.jpg` | Gypsum board (Concrete 046, a smooth white wall) | https://ambientcg.com/view?id=Concrete046 | 240 × 240 cm | CC0 |
| `softwood/color.jpg`, `normal.jpg`, `roughness.jpg` | Framing lumber, door panels, and catalog boxes (Wood 096) | https://ambientcg.com/view?id=Wood096 | 50 × 50 cm | CC0 |
| `wood-planks/color.jpg`, `normal.jpg`, `roughness.jpg` | Lap siding (Planks 021, rough wall planks) | https://ambientcg.com/view?id=Planks021 | 140 × 140 cm | CC0 |
| `oak-floor/color.jpg`, `normal.jpg`, `roughness.jpg` | Room floors (Wood Floor 051) | https://ambientcg.com/view?id=WoodFloor051 | 180 × 180 cm | CC0 |

The files live in `apps/desktop/src/renderer/src/view3d/textures/`.
