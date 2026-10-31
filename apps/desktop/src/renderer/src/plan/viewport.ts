import type { Bounds, Vec2 } from '@framewright/core';

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 200;

/** Maps model inches (Y up) to CSS pixels (Y down). `scale` is pixels per inch. */
export class Viewport {
  center: Vec2 = { x: 0, y: 0 };
  scale = 2;
  width = 1;
  height = 1;

  toScreen(p: Vec2): Vec2 {
    return { x: (p.x - this.center.x) * this.scale + this.width / 2, y: this.height / 2 - (p.y - this.center.y) * this.scale };
  }

  toModel(s: Vec2): Vec2 {
    return { x: (s.x - this.width / 2) / this.scale + this.center.x, y: (this.height / 2 - s.y) / this.scale + this.center.y };
  }

  /** Model-space length of `px` screen pixels. */
  model(px: number): number {
    return px / this.scale;
  }

  zoomAt(screen: Vec2, factor: number): void {
    const before = this.toModel(screen);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const after = this.toModel(screen);
    this.center = { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y };
  }

  panBy(dxPx: number, dyPx: number): void {
    this.center = { x: this.center.x - dxPx / this.scale, y: this.center.y + dyPx / this.scale };
  }

  fit(bounds: Bounds | null, marginPx = 48): void {
    if (!bounds) {
      this.center = { x: 0, y: 0 };
      this.scale = 2;
      return;
    }
    const w = Math.max(bounds.maxX - bounds.minX, 24);
    const h = Math.max(bounds.maxY - bounds.minY, 24);
    this.center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const sx = (this.width - marginPx * 2) / w;
    const sy = (this.height - marginPx * 2) / h;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(sx, sy)));
  }

  visibleBounds(): Bounds {
    const a = this.toModel({ x: 0, y: this.height });
    const b = this.toModel({ x: this.width, y: 0 });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
}
