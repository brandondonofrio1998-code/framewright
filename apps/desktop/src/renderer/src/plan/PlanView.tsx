import { useCallback, useEffect, useRef, useState } from 'react';
import {
  boundsOf,
  buildPlanDisplayList,
  roomFace,
  buildSnapScene,
  computeWallGeometry,
  dimensionPrims,
  dimensionsOnLevel,
  frameLevel,
  hiddenLayersOf,
  resolveDimensionEnd,
  snapPoint,
  stairCorners,
  type Id,
  type PlanDocument,
  type Vec2,
  type WallGeometry,
} from '@framewright/core';
import type { ToolId } from '../../../shared/ipc';
import { useAppearance } from '../app/appearance';
import { history, useDocument } from '../document/store';
import { deleteSelection } from '../editor/actions';
import { notify, setSelection, setTool, useEditor } from '../editor/store';
import { createBreakTool } from '../tools/break-tool';
import { createDimensionTool } from '../tools/dimension-tool';
import { createTextTool } from '../tools/text-tool';
import { createObjectTool } from '../tools/object-tool';
import { createOpeningTool } from '../tools/opening-tool';
import { createDeckTool } from '../tools/deck-tool';
import { createStairTool } from '../tools/stair-tool';
import { createSelectTool } from '../tools/select-tool';
import type { PlanPointer, SnapRequest, Tool, ToolContext } from '../tools/types';
import { createWallTool } from '../tools/wall-tool';
import { LengthEntry, type LengthEntryState } from './LengthEntry';
import { canvasBackground, drawBox, drawDisplayList, drawGrid, drawHandle, drawLine, drawOutline, drawSnapGlyph } from './render';
import { Viewport } from './viewport';

const SNAP_TOLERANCE_PX = 10;
const ZOOM_STEP = 1.25;

function geometryCache() {
  let key: [PlanDocument, Id] | null = null;
  let value = new Map<Id, WallGeometry>();
  return (doc: PlanDocument, levelId: Id) => {
    if (!key || key[0] !== doc || key[1] !== levelId) {
      value = computeWallGeometry(doc, levelId);
      key = [doc, levelId];
    }
    return value;
  };
}

function levelBounds(doc: PlanDocument, levelId: Id, geometry: Map<Id, WallGeometry>) {
  const points: Vec2[] = [...geometry.values()].flatMap((g) => g.footprint);
  for (const dim of dimensionsOnLevel(doc, levelId)) points.push(resolveDimensionEnd(doc, dim.a), resolveDimensionEnd(doc, dim.b));
  for (const el of Object.values(doc.elements)) if (el.kind === 'roofPlane' && el.levelId === levelId) points.push(...el.polygon);
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'foundation' || el.levelId !== levelId) continue;
    points.push(...el.polygon);
    for (const footing of el.footings) points.push(...footing);
  }
  for (const el of Object.values(doc.elements)) if (el.kind === 'stair' && el.levelId === levelId) points.push(...stairCorners(el));
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'cad' || el.levelId !== levelId) continue;
    for (const prim of el.prims) {
      if (prim.t === 'line') points.push(prim.a, prim.b);
      else if (prim.t === 'polyline') points.push(...prim.pts);
      else if (prim.t === 'text') points.push(prim.p);
      else points.push(prim.c);
    }
  }
  return boundsOf(points);
}

const createTools = (): Record<ToolId, Tool> => ({
  select: createSelectTool(),
  walls: createWallTool(),
  break: createBreakTool(),
  doors: createOpeningTool('door'),
  windows: createOpeningTool('window'),
  objects: createObjectTool(),
  dimensions: createDimensionTool(),
  stairs: createStairTool(),
  deck: createDeckTool(),
  text: createTextTool(),
});

const isLengthKey = (key: string) => /^[0-9.'"]$/.test(key);

export function PlanView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<Viewport>(null);
  const ctxRef = useRef<ToolContext>(null);
  const frameRef = useRef(0);
  const panRef = useRef<{ last: Vec2 } | null>(null);
  const spaceRef = useRef(false);
  const [tools] = useState(createTools);
  const [geometryOf] = useState(geometryCache);
  const [entry, setEntry] = useState<LengthEntryState | null>(null);

  const activeTool = useCallback((): Tool => tools[useEditor.getState().tool], [tools]);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext('2d');
    const view = viewRef.current;
    const toolCtx = ctxRef.current;
    if (!canvas || !ctx2d || !view || !toolCtx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.fillStyle = canvasBackground();
    ctx2d.fillRect(0, 0, view.width, view.height);

    const { doc: committed, activeLevelId } = useDocument.getState();
    const { selection } = useEditor.getState();
    const tool = activeTool();
    const shown = tool.preview?.(committed, toolCtx) ?? committed;
    const geometry = shown === committed ? geometryOf(committed, activeLevelId) : computeWallGeometry(shown, activeLevelId);

    const list = buildPlanDisplayList(shown, activeLevelId, { geometry }).filter((item) => !hiddenLayersOf(shown).includes(item.layer));
    drawGrid(ctx2d, view, shown.settings.gridSpacing);
    drawDisplayList(ctx2d, view, list, new Set(selection));
    const studs = frameLevel(shown, activeLevelId, geometry).reduce((n, wall) => n + wall.members.filter((member) => member.kind === 'stud' || member.kind === 'king').length, 0);
    if (wrapRef.current) {
      wrapRef.current.dataset.studCount = String(studs);
      wrapRef.current.dataset.cadCount = String(Object.values(shown.elements).filter((el) => el.kind === 'cad' && el.levelId === activeLevelId).length);
    }
    for (const id of selection) {
      const g = geometry.get(id);
      if (g) drawOutline(ctx2d, view, g.footprint);
      const el = shown.elements[id];
      if (el?.kind === 'room') {
        const face = roomFace(shown, el);
        if (face) drawOutline(ctx2d, view, face.polygon);
      }
    }

    const overlay = tool.overlay?.(toolCtx) ?? {};
    for (const line of overlay.lines ?? []) drawLine(ctx2d, view, line.a, line.b, line.style);
    for (const dim of overlay.dimensions ?? []) {
      const prims = dimensionPrims(dim.a, dim.b, dim.offset, dim.label);
      drawDisplayList(ctx2d, view, [{ elementId: 'temp', layer: 'dimensions', prims }], new Set(['temp']));
    }
    for (const p of overlay.handles ?? []) drawHandle(ctx2d, view, p);
    if (overlay.box) drawBox(ctx2d, view, overlay.box[0], overlay.box[1]);
    if (overlay.snap) drawSnapGlyph(ctx2d, view, overlay.snap.p, overlay.snap.kind);

    const wrap = wrapRef.current;
    if (wrap) {
      wrap.dataset.scale = String(view.scale);
      wrap.dataset.cx = String(view.center.x);
      wrap.dataset.cy = String(view.center.y);
    }
  }, [activeTool, geometryOf]);

  const redraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { doc, activeLevelId } = useDocument.getState();
    view.fit(levelBounds(doc, activeLevelId, geometryOf(doc, activeLevelId)));
    redraw();
  }, [geometryOf, redraw]);

  // The viewport and tool context live for the component's lifetime.
  useEffect(() => {
    const view = (viewRef.current ??= new Viewport());
    ctxRef.current = {
      doc: () => useDocument.getState().doc,
      levelId: () => useDocument.getState().activeLevelId,
      geometry: () => {
        const { doc, activeLevelId } = useDocument.getState();
        return geometryOf(doc, activeLevelId);
      },
      view,
      snap: (cursor: Vec2, request: SnapRequest = {}) => {
        const { doc, activeLevelId } = useDocument.getState();
        const scene = buildSnapScene(doc, geometryOf(doc, activeLevelId), request);
        const result = snapPoint(cursor, scene, {
          ...useEditor.getState().snaps,
          tolerance: view.model(SNAP_TOLERANCE_PX),
          gridSpacing: doc.settings.gridSpacing,
          ...(request.anchor && { anchor: request.anchor }),
        });
        useEditor.setState({ snapKind: result.kind });
        return result;
      },
      selection: () => useEditor.getState().selection,
      setSelection,
      setTool,
      notify,
      redraw,
    };
    redraw();
  }, [geometryOf, redraw]);

  // Size the canvas to its container at device resolution.
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
      draw();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  // Redraw on changes; abandon in-progress tool work when history jumps or the level changes.
  useEffect(() => {
    const cancelTool = (tool: Tool) => {
      if (ctxRef.current) tool.cancel(ctxRef.current);
      setEntry(null);
    };
    const offDoc = useDocument.subscribe((state, prev) => {
      if (state.activeLevelId !== prev.activeLevelId) cancelTool(activeTool());
      redraw();
    });
    const offHistory = history.subscribe((change) => {
      if (change.source !== 'command') cancelTool(activeTool());
    });
    const offEditor = useEditor.subscribe((state, prev) => {
      if (state.tool !== prev.tool) {
        cancelTool(tools[prev.tool]);
        if (canvasRef.current) canvasRef.current.style.cursor = tools[state.tool].cursor;
      }
      if (state.tool !== prev.tool || state.selection !== prev.selection || state.snaps !== prev.snaps) redraw();
    });
    const offAppearance = useAppearance.subscribe(() => redraw());
    const offMenu = window.fw.menu.onCommand((command) => {
      const view = viewRef.current;
      if (!view) return;
      const centerPx = { x: view.width / 2, y: view.height / 2 };
      if (command.type === 'view.fit') fit();
      else if (command.type === 'view.zoomIn') view.zoomAt(centerPx, ZOOM_STEP);
      else if (command.type === 'view.zoomOut') view.zoomAt(centerPx, 1 / ZOOM_STEP);
      else return;
      redraw();
    });
    return () => {
      offDoc();
      offHistory();
      offEditor();
      offAppearance();
      offMenu();
    };
  }, [activeTool, fit, redraw, tools]);

  // Wheel zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      viewRef.current?.zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, Math.pow(1.0015, -e.deltaY));
      redraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [redraw]);

  // The viewport is created in an effect, so a pointer event on the first paint has nowhere to land yet.
  const pointer = (e: React.PointerEvent | React.MouseEvent): PlanPointer | null => {
    const view = viewRef.current;
    if (!view) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return { screen, model: view.toModel(screen), button: e.button, shift: e.shiftKey };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      panRef.current = { last: { x: e.clientX, y: e.clientY } };
      e.preventDefault();
      return;
    }
    const p = pointer(e);
    const ctx = ctxRef.current;
    if (!p || !ctx) return;
    setEntry(null);
    activeTool().down?.(p, ctx);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) {
      viewRef.current?.panBy(e.clientX - panRef.current.last.x, e.clientY - panRef.current.last.y);
      panRef.current.last = { x: e.clientX, y: e.clientY };
      redraw();
      return;
    }
    const p = pointer(e);
    const ctx = ctxRef.current;
    if (!p || !ctx) return;
    useEditor.setState({ cursor: p.model });
    activeTool().move?.(p, ctx);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    const p = pointer(e);
    const ctx = ctxRef.current;
    if (!p || !ctx) return;
    activeTool().up?.(p, ctx);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const tool = activeTool();
    if (e.key === ' ') {
      if (tool.key?.(e.nativeEvent, ctx)) {
        e.preventDefault();
        return;
      }
      spaceRef.current = true;
      e.preventDefault();
      return;
    }
    const at = tool.lengthEntry?.(ctx)?.position();
    if (at && isLengthKey(e.key)) {
      e.preventDefault();
      setEntry({ length: e.key, angle: '', at: ctx.view.toScreen(at) });
      return;
    }
    if (tool.key?.(e.nativeEvent, ctx)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelection();
      e.preventDefault();
    } else if (e.key === 'f' || e.key === 'F') {
      fit();
    }
  };

  const closeEntry = () => {
    setEntry(null);
    canvasRef.current?.focus();
  };

  return (
    <div className="plan-view" ref={wrapRef} data-testid="plan-view">
      <canvas
        ref={canvasRef}
        className="plan-canvas"
        tabIndex={0}
        aria-label="Plan view"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => useEditor.setState({ cursor: null })}
        onDoubleClick={(e) => {
          const p = pointer(e);
          const ctx = ctxRef.current;
          if (p && ctx) activeTool().doubleClick?.(p, ctx);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === ' ') spaceRef.current = false;
        }}
      />
      {entry && (
        <LengthEntry
          state={entry}
          onChange={setEntry}
          onCommit={(length, angle) => {
            const ctx = ctxRef.current;
            const handler = ctx && activeTool().lengthEntry?.(ctx);
            if (!handler) {
              closeEntry();
              return null;
            }
            const error = handler.commit(length, angle);
            if (error) return error;
            closeEntry();
            redraw();
            return null;
          }}
          onCancel={closeEntry}
        />
      )}
    </div>
  );
}
