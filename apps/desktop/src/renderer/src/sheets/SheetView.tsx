import { useCallback, useEffect, useMemo, useRef } from 'react';
import { buildPlanDisplayList, layoutSheet, type SheetLayout, type Vec2 } from '@framewright/core';
import { useDocument } from '../document/store';
import { drawDisplayList } from '../plan/render';
import { Viewport } from '../plan/viewport';

/** Draws one ARCH D sheet: border, title block, and the active level's plan at a standard scale. */
export function SheetView() {
  const doc = useDocument((s) => s.doc);
  const levelId = useDocument((s) => s.activeLevelId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const layout = useMemo(() => layoutSheet(doc, levelId), [doc, levelId]);
  const items = useMemo(() => buildPlanDisplayList(doc, levelId), [doc, levelId]);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !wrap || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (width < 2 || height < 2) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e4e7ec';
    ctx.fillRect(0, 0, width, height);
    const pad = 16;
    const fit = Math.min((width - pad * 2) / layout.width, (height - pad * 2) / layout.height);
    if (!(fit > 0)) return;
    const origin = { x: (width - layout.width * fit) / 2, y: (height + layout.height * fit) / 2 };
    const paper = (p: Vec2) => ({ x: origin.x + p.x * fit, y: origin.y - p.y * fit });
    const rect = (box: SheetLayout['border']) => {
      const a = paper({ x: box.x, y: box.y + box.h });
      ctx.fillRect(a.x, a.y, box.w * fit, box.h * fit);
      ctx.strokeRect(a.x, a.y, box.w * fit, box.h * fit);
    };
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1f2328';
    ctx.lineWidth = 1;
    rect({ x: 0, y: 0, w: layout.width, h: layout.height });
    ctx.lineWidth = 1.25;
    rect(layout.border);
    const titleTop = paper({ x: layout.title.x, y: layout.title.y + layout.title.h });
    ctx.beginPath();
    ctx.moveTo(titleTop.x, titleTop.y);
    ctx.lineTo(titleTop.x + layout.title.w * fit, titleTop.y);
    ctx.stroke();
    ctx.fillStyle = '#1f2328';
    ctx.font = `${Math.max(12, 0.22 * fit)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const mid = paper({ x: layout.title.x, y: layout.title.y + layout.title.h / 2 });
    ctx.textAlign = 'left';
    ctx.fillText(layout.titleText, mid.x + 10, mid.y);
    ctx.textAlign = 'center';
    ctx.fillText(layout.levelName, mid.x + (layout.title.w * fit) / 2, mid.y);
    ctx.textAlign = 'right';
    ctx.fillText(`${layout.scaleLabel}    Sheet 1    ${layout.date}`, mid.x + layout.title.w * fit - 10, mid.y);

    const viewTop = paper({ x: layout.viewport.x, y: layout.viewport.y + layout.viewport.h });
    const viewW = layout.viewport.w * fit;
    const viewH = layout.viewport.h * fit;
    ctx.save();
    ctx.beginPath();
    ctx.rect(viewTop.x, viewTop.y, viewW, viewH);
    ctx.clip();
    ctx.translate(viewTop.x, viewTop.y);
    const view = new Viewport();
    view.width = viewW;
    view.height = viewH;
    view.center = layout.center;
    view.scale = fit / layout.modelPerPaper;
    drawDisplayList(ctx, view, items);
    ctx.restore();
  }, [items, layout]);

  const redraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      draw();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  return (
    <div className="sheet-view" ref={wrapRef} data-testid="sheet-view" data-scale={layout.scaleLabel}>
      <canvas ref={canvasRef} className="sheet-canvas" />
    </div>
  );
}
