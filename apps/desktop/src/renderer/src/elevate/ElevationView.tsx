import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boundsOf, buildElevation, buildPlanMeshes, ELEVATION_FACINGS, type ElevationFacing, type Vec2 } from '@framewright/core';
import { useDocument } from '../document/store';
import { useAppearance } from '../app/appearance';
import { canvasBackground, drawDisplayList, drawGrid } from '../plan/render';
import { Viewport } from '../plan/viewport';

const ZOOM_STEP = 1.25;
const LABELS: Record<ElevationFacing, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };

/** Orthographic elevation of the plan. Drag to pan, scroll to zoom. */
export function ElevationView() {
  const doc = useDocument((s) => s.doc);
  const [facing, setFacing] = useState<ElevationFacing>('front');
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<Viewport>(null);
  const frameRef = useRef(0);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const fittedRef = useRef('');

  const items = useMemo(() => buildElevation(buildPlanMeshes(doc), facing), [doc, facing]);
  const lineCount = items.reduce((n, item) => n + item.prims.length, 0);
  const bounds = useMemo(() => boundsOf(items.flatMap((item) => item.prims.flatMap((prim) => (prim.t === 'line' ? [prim.a, prim.b] : [])))), [items]);
  const fitKey = `${facing}:${bounds ? `${bounds.minX.toFixed(1)},${bounds.minY.toFixed(1)},${bounds.maxX.toFixed(1)},${bounds.maxY.toFixed(1)}` : 'empty'}`;

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const view = viewRef.current;
    if (!canvas || !ctx || !view) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = canvasBackground();
    ctx.fillRect(0, 0, view.width, view.height);
    drawGrid(ctx, view, doc.settings.gridSpacing);
    drawDisplayList(ctx, view, items);
  }, [doc.settings.gridSpacing, items]);

  const redraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const view = viewRef.current;
    if (!view || view.width < 2) return;
    view.fit(bounds);
    fittedRef.current = fitKey;
    redraw();
  }, [bounds, fitKey, redraw]);

  useEffect(() => {
    viewRef.current ??= new Viewport();
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const observer = new ResizeObserver(() => {
      const view = viewRef.current;
      if (!view) return;
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      view.width = rect.width;
      view.height = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      if (fittedRef.current !== fitKey) {
        view.fit(bounds);
        fittedRef.current = fitKey;
      }
      draw();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [bounds, draw, fitKey]);

  useEffect(() => {
    if (fittedRef.current === fitKey) {
      redraw();
      return;
    }
    fit();
  }, [fit, fitKey, redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      viewRef.current?.zoomAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.pow(1.0015, -event.deltaY));
      redraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [redraw]);

  useEffect(() => useAppearance.subscribe(() => redraw()), [redraw]);

  useEffect(
    () =>
      window.fw.menu.onCommand((command) => {
        const view = viewRef.current;
        if (!view) return;
        const center = { x: view.width / 2, y: view.height / 2 };
        if (command.type === 'view.fit') fit();
        else if (command.type === 'view.zoomIn') view.zoomAt(center, ZOOM_STEP);
        else if (command.type === 'view.zoomOut') view.zoomAt(center, 1 / ZOOM_STEP);
        else return;
        redraw();
      }),
    [fit, redraw],
  );

  const panTo = (point: Vec2) => {
    const last = panRef.current;
    const view = viewRef.current;
    if (!last || !view) return;
    view.panBy(point.x - last.x, point.y - last.y);
    panRef.current = point;
    redraw();
  };

  return (
    <div className="elevation-view" ref={wrapRef} data-testid="elevation-view" data-line-count={lineCount} data-facing={facing}>
      <canvas
        ref={canvasRef}
        className="elevation-canvas"
        aria-label="Elevation view"
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          panRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => panTo({ x: event.clientX, y: event.clientY })}
        onPointerUp={() => {
          panRef.current = null;
        }}
      />
      {lineCount === 0 && <p className="view-3d-empty">Draw walls in the plan to see the elevation.</p>}
      <div className="elevation-bar">
        <div className="elevation-modes" role="group" aria-label="Elevation side">
          {ELEVATION_FACINGS.map((side) => (
            <button key={side} type="button" aria-pressed={facing === side} onClick={() => setFacing(side)}>
              {LABELS[side]}
            </button>
          ))}
        </div>
        <p className="view-3d-hint">Drag to pan, scroll to zoom.</p>
      </div>
    </div>
  );
}
