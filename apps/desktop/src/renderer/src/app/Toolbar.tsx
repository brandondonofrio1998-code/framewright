import type { LucideIcon } from 'lucide-react';
import {
  AppWindow,
  Archive,
  BrickWall,
  DoorOpen,
  DoorStairwell,
  House,
  MousePointer2,
  RulerDimensionLine,
  Scissors,
  Type,
  Video,
} from 'lucide-react';
import type { ToolId } from '../../../shared/ipc';
import { setTool, TOOL_LABELS, useEditor } from '../editor/store';

type ToolButton =
  | { id: ToolId; icon: LucideIcon }
  | { id: string; label: string; icon: LucideIcon; availableIn: string };

const TOOL_GROUPS: ToolButton[][] = [
  [{ id: 'select', icon: MousePointer2 }],
  [
    { id: 'walls', icon: BrickWall },
    { id: 'break', icon: Scissors },
    { id: 'doors', icon: DoorOpen },
    { id: 'windows', icon: AppWindow },
  ],
  [
    { id: 'objects', icon: Archive },
    { id: 'stairs', label: 'Stairs', icon: DoorStairwell, availableIn: 'M5' },
    { id: 'roof', label: 'Roof', icon: House, availableIn: 'M5' },
  ],
  [
    { id: 'dimensions', icon: RulerDimensionLine },
    { id: 'text', label: 'Text', icon: Type, availableIn: 'M7' },
  ],
  [{ id: 'camera', label: 'Camera Views', icon: Video, availableIn: 'M3' }],
];

export function Toolbar() {
  const active = useEditor((s) => s.tool);
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOL_GROUPS.map((group, index) => (
        <div className="toolbar-group" key={index}>
          {group.map((button) => {
            const Icon = button.icon;
            if ('availableIn' in button) {
              return (
                <button key={button.id} type="button" className="tool-button" aria-label={button.label} title={`${button.label} (available in ${button.availableIn})`} disabled>
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
