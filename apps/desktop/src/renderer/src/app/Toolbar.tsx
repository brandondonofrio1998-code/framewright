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
  Type,
  Video,
} from 'lucide-react';

interface ToolButton {
  id: string;
  label: string;
  icon: LucideIcon;
  availableIn: string;
}

const TOOL_GROUPS: ToolButton[][] = [
  [{ id: 'select', label: 'Select', icon: MousePointer2, availableIn: 'M1c' }],
  [
    { id: 'walls', label: 'Walls', icon: BrickWall, availableIn: 'M1c' },
    { id: 'doors', label: 'Doors', icon: DoorOpen, availableIn: 'M2' },
    { id: 'windows', label: 'Windows', icon: AppWindow, availableIn: 'M2' },
  ],
  [
    { id: 'cabinets', label: 'Cabinets', icon: Archive, availableIn: 'M2' },
    { id: 'stairs', label: 'Stairs', icon: DoorStairwell, availableIn: 'M5' },
    { id: 'roof', label: 'Roof', icon: House, availableIn: 'M5' },
  ],
  [
    { id: 'dimensions', label: 'Dimensions', icon: RulerDimensionLine, availableIn: 'M1c' },
    { id: 'text', label: 'Text', icon: Type, availableIn: 'M1c' },
  ],
  [{ id: 'camera', label: 'Camera Views', icon: Video, availableIn: 'M3' }],
];

export function Toolbar() {
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOL_GROUPS.map((group, index) => (
        <div className="toolbar-group" key={index}>
          {group.map(({ id, label, icon: Icon, availableIn }) => (
            <button
              key={id}
              type="button"
              className="tool-button"
              aria-label={label}
              title={`${label} (available in ${availableIn})`}
              disabled
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
