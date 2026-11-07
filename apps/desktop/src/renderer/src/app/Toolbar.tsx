import type { LucideIcon } from 'lucide-react';
import {
  AppWindow,
  Archive,
  BrickWall,
  DoorOpen,
  DoorStairwell,
  Droplets,
  Fence,
  Map,
  House,
  Zap,
  LandPlot,
  MousePointer2,
  Pyramid,
  Route,
  RulerDimensionLine,
  Scissors,
  Spline,
  TreeDeciduous,
  Type,
  Video,
} from 'lucide-react';
import type { ToolId } from '../../../shared/ipc';
import { setTool, TOOL_LABELS, useEditor } from '../editor/store';
import { buildFoundation, buildGable, buildHip } from '../editor/actions';
import { toggleCameras, useView3d } from '../view3d/view-state';

type ToolButton =
  | { id: ToolId; icon: LucideIcon }
  | { id: 'garage'; label: string; icon: LucideIcon }
  | { id: 'camera'; label: string; icon: LucideIcon }
  | { id: 'roof'; label: string; icon: LucideIcon }
  | { id: 'hip'; label: string; icon: LucideIcon }
  | { id: 'foundation'; label: string; icon: LucideIcon };

const TOOL_GROUPS: ToolButton[][] = [
  [{ id: 'select', icon: MousePointer2 }],
  [
    { id: 'walls', icon: BrickWall },
    { id: 'break', icon: Scissors },
    { id: 'doors', icon: DoorOpen },
    { id: 'garage', label: 'Garage Door', icon: House },
    { id: 'windows', icon: AppWindow },
  ],
  [
    { id: 'objects', icon: Archive },
    { id: 'stairs', icon: DoorStairwell },
    { id: 'deck', icon: Fence },
    { id: 'electrical', icon: Zap },
    { id: 'plumbing', icon: Droplets },
    { id: 'pipe', icon: Spline },
    { id: 'site', icon: Map },
    { id: 'plant', icon: TreeDeciduous },
    { id: 'road', icon: Route },
    { id: 'roof', label: 'Roof', icon: House },
    { id: 'hip', label: 'Hip Roof', icon: Pyramid },
    { id: 'foundation', label: 'Foundation', icon: LandPlot },
  ],
  [
    { id: 'dimensions', icon: RulerDimensionLine },
    { id: 'text', icon: Type },
  ],
  [{ id: 'camera', label: 'Camera Views', icon: Video }],
];

export function Toolbar() {
  const active = useEditor((s) => s.tool);
  const camerasOpen = useView3d((s) => s.camerasOpen);
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOL_GROUPS.map((group, index) => (
        <div className="toolbar-group" key={index}>
          {group.map((button) => {
            const Icon = button.icon;
            if (button.id === 'garage') return <button key={button.id} type="button" className="tool-button" aria-label="Garage Door" title="Garage door - set width and height in Properties" onClick={() => {
              useEditor.setState({ doorDefaults: { ...useEditor.getState().doorDefaults, style: 'garage', width: 108, height: 84 } });
              setTool('doors');
            }}><Icon size={18} strokeWidth={1.75} aria-hidden /></button>;
            if (button.id === 'camera') {
              return (
                <button key={button.id} type="button" className="tool-button" aria-label={button.label} aria-pressed={camerasOpen} title={button.label} onClick={() => toggleCameras()}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                </button>
              );
            }
            if (button.id === 'roof') {
              return (
                <button key={button.id} type="button" className="tool-button" aria-label={button.label} title="Build Roof: gable on a rectangle; hip on other closed outlines" onClick={() => buildGable()}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                </button>
              );
            }
            if (button.id === 'hip') {
              return (
                <button key={button.id} type="button" className="tool-button" aria-label={button.label} title="Build a hip roof" onClick={() => buildHip()}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                </button>
              );
            }
            if (button.id === 'foundation') {
              return (
                <button key={button.id} type="button" className="tool-button" aria-label={button.label} title="Build a slab, stem wall, and footing" onClick={() => buildFoundation()}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                </button>
              );
            }
            const label = TOOL_LABELS[button.id];
            return (
              <button
                key={button.id}
                type="button"
                className="tool-button"
                aria-label={label}
                aria-pressed={active === button.id}
                title={label}
                onClick={() => setTool(button.id)}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
