import { OrbitControls, OrthographicCamera, PerspectiveCamera, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  BufferGeometry,
  DirectionalLight,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  NoColorSpace,
  Object3D,
  PCFSoftShadowMap,
  RepeatWrapping,
  SRGBColorSpace,
  Uint32BufferAttribute,
  Vector3,
  type ColorSpace,
  type Texture,
} from 'three';
import {
  buildPlanMeshes,
  camerasIn,
  clipWalk,
  walkObstacles,
  eyeZ,
  footRise,
  meshBounds,
  partTexture,
  poseFromLook,
  stepWalk,
  walkLook,
  WALK_FAST,
  WALK_SPEED,
  type MeshPart,
  type PartTexture,
  type PlanDocument,
  type SavedCamera,
  type TextureId,
  type Vec3,
  type WalkBarrier,
  type WalkPose,
} from '@framewright/core';
import { useAppearance } from '../app/appearance';
import { dispatch, setActiveLevel, useDocument } from '../document/store';
import { notify } from '../editor/store';
import { TEXTURE_URLS } from './textures';
import { recallCamera, setOrbit, setViewMode, useView3d, type Recall } from './view-state';

Object3D.DEFAULT_UP.set(0, 0, 1);

const ROLE_COLOR: Record<MeshPart['role'], string> = {
  solid: '#c8c4be',
  floor: '#e4dfd8',
  ceiling: '#eceae6',
  panel: '#8d7355',
  glass: '#b7d4de',
};

const LOOK_SPEED = 0.002;

interface LiveView {
  eye: Vec3;
  target: Vec3;
  zoom: number;
}

interface OrbitTarget {
  target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  update: () => void;
}

function isOrbit(value: unknown): value is OrbitTarget {
  if (typeof value !== 'object' || value === null || !('target' in value) || !('update' in value)) return false;
  const target = value.target;
  return typeof target === 'object' && target !== null && 'set' in target && typeof value.update === 'function';
}

function placeOrtho(camera: { isOrthographicCamera?: boolean; zoom: number; updateProjectionMatrix: () => void }, eye: Vec3, target: Vec3, height: number, zoom?: number): void {
  if (!camera.isOrthographicCamera) return;
  if (zoom !== undefined && zoom > 0) camera.zoom = zoom;
  else {
    const distance = Math.max(Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z), 72);
    const visible = 2 * distance * Math.tan(Math.PI / 8);
    camera.zoom = Math.max(height, 1) / visible;
  }
  camera.updateProjectionMatrix();
}

function partColor(doc: PlanDocument, part: MeshPart): string {
  if (part.materialId) return doc.materials[part.materialId]?.color ?? ROLE_COLOR.solid;
  return ROLE_COLOR[part.role];
}

function configure(source: Texture, colorSpace: ColorSpace, tile: [number, number], anisotropy: number): Texture {
  const texture = source.clone();
  texture.colorSpace = colorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / tile[0], 1 / tile[1]);
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function usePrepared(id: TextureId, tile: [number, number]) {
  const loaded = useTexture(TEXTURE_URLS[id]);
  const gl = useThree((s) => s.gl);
  const maps = useMemo(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return {
      color: configure(loaded.color, SRGBColorSpace, tile, anisotropy),
      normal: configure(loaded.normal, NoColorSpace, tile, anisotropy),
      roughness: configure(loaded.roughness, NoColorSpace, tile, anisotropy),
    };
  }, [gl, loaded, tile]);
  useEffect(
    () => () => {
      maps.color.dispose();
      maps.normal.dispose();
      maps.roughness.dispose();
    },
    [maps],
  );
  return maps;
}

function PartMesh({ part, color, maps }: { part: MeshPart; color: string; maps?: { color: Texture; normal?: Texture; roughness?: Texture } }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(part.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(part.normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(part.uvs, 2));
    g.setIndex(new Uint32BufferAttribute(part.indices, 1));
    return g;
  }, [part]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const glass = part.role === 'glass';
  return (
    <mesh geometry={geometry} castShadow={!glass} receiveShadow={!glass}>
      <meshStandardMaterial
        color={color}
        map={maps?.color ?? null}
        normalMap={maps?.normal ?? null}
        roughnessMap={maps?.roughness ?? null}
        roughness={maps ? 1 : glass ? 0.05 : 0.82}
        metalness={0}
        transparent={glass}
        opacity={glass ? 0.35 : 1}
        side={DoubleSide}
      />
    </mesh>
  );
}

/** Original deterministic wood flakes; no downloaded assets or network dependency. */
function OsbMesh({ part, color }: { part: MeshPart; color: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#d3b789';
    ctx.fillRect(0, 0, 256, 256);
    let seed = 7321;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 950; i++) {
      ctx.save();
      ctx.translate(random() * 256, random() * 256);
      ctx.rotate(random() * Math.PI);
      ctx.fillStyle = ['#ead2a5', '#b4905d', '#d4b780', '#f0dcba'][i % 4]!;
      ctx.fillRect(-10, -2, 8 + random() * 26, 2 + random() * 5);
      ctx.restore();
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(1 / 24, 1 / 24);
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <PartMesh part={part} color={color} maps={{ color: texture }} />;
}

function TexturedGroup({ texture, items }: { texture: PartTexture; items: { part: MeshPart; color: string }[] }) {
  const maps = usePrepared(texture.id, texture.tile);
  return items.map((item, i) => <PartMesh key={`${item.part.elementId}:${item.part.role}:${i}`} part={item.part} color={item.color} maps={maps} />);
}

function FrameScene({
  parts,
  placedRef,
  liveRef,
  recall,
}: {
  parts: MeshPart[];
  placedRef: RefObject<boolean>;
  liveRef: RefObject<LiveView>;
  recall: Recall | null;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const height = useThree((s) => s.size.height);
  const seen = useRef(-1);
  const key = useMemo(() => {
    const b = meshBounds(parts);
    return b ? b.min.concat(b.max).map((n) => n.toFixed(1)).join(',') : '';
  }, [parts]);

  useEffect(() => {
    const writeLive = () => {
      const current = liveRef.current;
      if (!current) return;
      current.eye = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      if (isOrbit(controls)) current.target = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
      if ('isOrthographicCamera' in camera && camera.isOrthographicCamera) current.zoom = camera.zoom;
    };
    if (recall && recall.mode === 'orbit' && recall.token !== seen.current) {
      camera.up.set(0, 0, 1);
      camera.position.set(recall.eye.x, recall.eye.y, recall.eye.z);
      camera.lookAt(recall.target.x, recall.target.y, recall.target.z);
      placeOrtho(camera, recall.eye, recall.target, height, recall.zoom);
      camera.updateProjectionMatrix();
      if (isOrbit(controls)) {
        controls.target.set(recall.target.x, recall.target.y, recall.target.z);
        controls.update();
      }
      placedRef.current = true;
      seen.current = recall.token;
      writeLive();
      return;
    }
    if (placedRef.current) {
      const current = liveRef.current;
      if (current) {
        camera.up.set(0, 0, 1);
        camera.position.set(current.eye.x, current.eye.y, current.eye.z);
        camera.lookAt(current.target.x, current.target.y, current.target.z);
        placeOrtho(camera, current.eye, current.target, height, current.zoom > 0 ? current.zoom : undefined);
        if (isOrbit(controls)) {
          controls.target.set(current.target.x, current.target.y, current.target.z);
          controls.update();
        }
      }
      writeLive();
      return;
    }
    const b = meshBounds(parts);
    if (!b) return;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 72);
    camera.up.set(0, 0, 1);
    camera.position.set(cx + span * 0.85, cy - span * 1.15, cz + span * 0.65);
    camera.lookAt(cx, cy, cz);
    placeOrtho(camera, { x: camera.position.x, y: camera.position.y, z: camera.position.z }, { x: cx, y: cy, z: cz }, height);
    camera.updateProjectionMatrix();
    if (isOrbit(controls)) {
      controls.target.set(cx, cy, cz);
      controls.update();
    }
    placedRef.current = true;
    writeLive();
  }, [camera, controls, height, key, liveRef, parts, placedRef, recall]);

  useFrame(() => {
    const current = liveRef.current;
    if (!current) return;
    current.eye = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    if (isOrbit(controls)) current.target = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    if ('isOrthographicCamera' in camera && camera.isOrthographicCamera) current.zoom = camera.zoom;
  });

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.14}
      onStart={() => {
        placedRef.current = true;
      }}
    />
  );
}

interface Keys {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shift: boolean;
}

function blankKeys(): Keys {
  return { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false, shift: false };
}

function keyFlag(event: KeyboardEvent): keyof Keys | null {
  if (event.key === 'Shift') return 'shift';
  switch (event.key.toLowerCase()) {
    case 'w':
      return 'w';
    case 'a':
      return 'a';
    case 's':
      return 's';
    case 'd':
      return 'd';
    case 'arrowup':
      return 'up';
    case 'arrowdown':
      return 'down';
    case 'arrowleft':
      return 'left';
    case 'arrowright':
      return 'right';
    default:
      return null;
  }
}

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function WalkControls({ doc, levelId, elevation, recall, liveRef, barriers }: { doc: PlanDocument; levelId: string; elevation: number; recall: Recall | null; liveRef: RefObject<LiveView>; barriers: readonly WalkBarrier[] }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const pose = useRef<WalkPose | null>(null);
  const applied = useRef(-1);
  const keys = useRef<Keys>(blankKeys());
  const direction = useRef(new Vector3());

  useEffect(() => {
    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (isTyping(event)) return;
      const flag = keyFlag(event);
      if (!flag) return;
      keys.current[flag] = down;
      event.preventDefault();
    };
    const down = (event: KeyboardEvent) => onKey(event, true);
    const up = (event: KeyboardEvent) => onKey(event, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.current = blankKeys();
    };
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const onClick = () => {
      try {
        void Promise.resolve(el.requestPointerLock()).catch(() => undefined);
      } catch {
        // Pointer lock can be refused. Walking with the keys still works.
      }
    };
    const onMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== el || !pose.current) return;
      pose.current = stepWalk(pose.current, {
        forward: 0,
        strafe: 0,
        yaw: -event.movementX * LOOK_SPEED,
        pitch: -event.movementY * LOOK_SPEED,
        elevation,
      });
    };
    el.addEventListener('click', onClick);
    window.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMove);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [elevation, gl]);

  useFrame((_, dt) => {
    if (recall && recall.mode === 'walk' && recall.token !== applied.current) {
      pose.current = poseFromLook(recall.eye, recall.target, elevation);
      applied.current = recall.token;
    }
    if (!pose.current) {
      camera.getWorldDirection(direction.current);
      if (direction.current.lengthSq() < 1e-8) direction.current.set(1, 0, 0);
      const p = camera.position;
      pose.current = poseFromLook(
        { x: p.x, y: p.y, z: p.z },
        { x: p.x + direction.current.x, y: p.y + direction.current.y, z: p.z + direction.current.z },
        elevation,
      );
    }
    const held = keys.current;
    const forward = (held.w || held.up ? 1 : 0) - (held.s || held.down ? 1 : 0);
    const strafe = (held.d || held.right ? 1 : 0) - (held.a || held.left ? 1 : 0);
    const mag = Math.hypot(forward, strafe);
    if (mag > 0) {
      const speed = (held.shift ? WALK_FAST : WALK_SPEED) * Math.min(dt, 0.05);
      const next = stepWalk(pose.current, { forward: (forward / mag) * speed, strafe: (strafe / mag) * speed, yaw: 0, pitch: 0, elevation });
      const clipped = clipWalk(pose.current, next, barriers);
      pose.current = { ...next, x: clipped.x, y: clipped.y, z: eyeZ(elevation) + footRise(doc, levelId, clipped) };
    } else {
      pose.current = { ...pose.current, z: eyeZ(elevation) + footRise(doc, levelId, pose.current) };
    }
    const now = pose.current;
    camera.up.set(0, 0, 1);
    camera.position.set(now.x, now.y, now.z);
    const look = walkLook(now);
    camera.lookAt(look.x, look.y, look.z);
    const current = liveRef.current;
    if (current) {
      current.eye = { x: now.x, y: now.y, z: now.z };
      current.target = look;
    }
  });

  return null;
}

function EyeProbe({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const el = rootRef.current;
    if (!el) return;
    el.dataset.eye = [camera.position.x, camera.position.y, camera.position.z].map((n) => n.toFixed(1)).join(',');
  });
  return null;
}

function MarkTextured({ count, onReady }: { count: number; onReady: (count: number) => void }) {
  useEffect(() => onReady(count), [count, onReady]);
  return null;
}

function Sun({ parts }: { parts: MeshPart[] }) {
  const light = useRef<DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const sun = light.current;
    if (!sun) return;
    scene.add(sun.target);
    const bounds = meshBounds(parts);
    const span = bounds ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2], 240) : 480;
    const cx = bounds ? (bounds.min[0] + bounds.max[0]) / 2 : 0;
    const cy = bounds ? (bounds.min[1] + bounds.max[1]) / 2 : 0;
    const cz = bounds ? (bounds.min[2] + bounds.max[2]) / 2 : 0;
    sun.position.set(cx + span, cy - span * 0.75, cz + span * 1.1);
    sun.target.position.set(cx, cy, cz);
    sun.target.updateMatrixWorld();
    const cover = span * 1.4;
    const cam = sun.shadow.camera;
    cam.left = -cover;
    cam.right = cover;
    cam.top = cover;
    cam.bottom = -cover;
    cam.near = 1;
    cam.far = span * 8;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 1.5;
    return () => {
      scene.remove(sun.target);
    };
  }, [parts, scene]);
  return <directionalLight ref={light} intensity={1.15} castShadow shadow-mapSize={[2048, 2048]} />;
}

function PlanNotes({ doc, levelId, elevation }: { doc: PlanDocument; levelId: string; elevation: number }) {
  const notes = Object.values(doc.elements).filter((el): el is Extract<typeof el, { kind: 'text' }> => el.kind === 'text' && el.levelId === levelId);
  return (
    <>
      {notes.map((note) => (
        <PlanNote key={note.id} text={note.text} x={note.p.x} y={note.p.y} size={note.size} rot={note.rot ?? 0} elevation={elevation} />
      ))}
    </>
  );
}

function PlanNote({ text, x, y, size, rot, elevation }: { text: string; x: number; y: number; size: number; rot: number; elevation: number }) {
  const map = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = '#1f2328';
    context.font = '64px sans-serif';
    context.textBaseline = 'middle';
    context.fillText(text.slice(0, 40), 8, 64);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [text]);
  useEffect(() => () => map?.dispose(), [map]);
  if (!map) return null;
  const width = Math.max(size, text.length * size * 0.55);
  return (
    <mesh position={[x + Math.cos(rot) * width * 0.5, y + Math.sin(rot) * width * 0.5, elevation + size * 0.5]} rotation={[Math.PI / 2, rot, 0]}>
      <planeGeometry args={[width, size]} />
      <meshBasicMaterial map={map} transparent side={DoubleSide} />
    </mesh>
  );
}

function Scene({
  doc,
  levelId,
  parts,
  elevation,
  mode,
  projection,
  recall,
  placedRef,
  liveRef,
  rootRef,
  textured,
  onTextured,
  dark,
  barriers,
}: {
  doc: PlanDocument;
  levelId: string;
  parts: MeshPart[];
  elevation: number;
  mode: 'orbit' | 'walk';
  projection: 'perspective' | 'orthographic';
  recall: Recall | null;
  placedRef: RefObject<boolean>;
  liveRef: RefObject<LiveView>;
  rootRef: RefObject<HTMLDivElement | null>;
  textured: number;
  onTextured: (count: number) => void;
  dark: boolean;
  barriers: readonly WalkBarrier[];
}) {
  const groups = useMemo(() => {
    const flat: { part: MeshPart; color: string }[] = [];
    const byTexture = new Map<string, { texture: PartTexture; items: { part: MeshPart; color: string }[] }>();
    parts.forEach((part) => {
      const color = partColor(doc, part);
      const texture = partTexture(doc, part);
      if (!texture) {
        flat.push({ part, color });
        return;
      }
      const key = `${texture.id}:${texture.tile[0]}:${texture.tile[1]}`;
      const group = byTexture.get(key) ?? { texture, items: [] };
      group.items.push({ part, color });
      byTexture.set(key, group);
    });
    return { flat, textured: [...byTexture.values()] };
  }, [doc, parts]);

  return (
    <>
      {mode === 'walk' || projection === 'perspective' ? (
        <PerspectiveCamera makeDefault fov={45} near={1} far={100000} />
      ) : (
        <OrthographicCamera makeDefault near={1} far={100000} zoom={1} />
      )}
      <color attach="background" args={[dark ? '#1c1f24' : '#e4e7ec']} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#f4f7fb', '#d9cbb8', 0.4]} />
      <Sun parts={parts} />
      <gridHelper args={[720, 30, '#d4d0ca', '#eceae6']} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, elevation]} />
      {groups.flat.map((item, i) => (
        item.part.materialId && doc.materials[item.part.materialId]?.category === 'sheathing' && /\bOSB\b/i.test(doc.materials[item.part.materialId]!.name)
          ? <OsbMesh key={`${item.part.elementId}:flat:${i}`} part={item.part} color={item.color} />
          : <PartMesh key={`${item.part.elementId}:flat:${i}`} part={item.part} color={item.color} />
      ))}
      {groups.textured.map((group) => (
        <TexturedGroup key={`${group.texture.id}:${group.texture.tile.join(',')}`} texture={group.texture} items={group.items} />
      ))}
      {mode === 'walk' ? <WalkControls doc={doc} levelId={levelId} elevation={elevation} recall={recall} liveRef={liveRef} barriers={barriers} /> : <FrameScene parts={parts} placedRef={placedRef} liveRef={liveRef} recall={recall} />}
      <PlanNotes doc={doc} levelId={levelId} elevation={elevation} />
      <EyeProbe rootRef={rootRef} />
      <MarkTextured count={textured} onReady={onTextured} />
    </>
  );
}

const errorOf = (result: { ok: boolean; error?: string }) => (result.ok ? null : (result.error ?? 'Rejected'));

/** Orbit and walk views of the plan, with saved cameras. */
export function View3D() {
  const doc = useDocument((s) => s.doc);
  const levelId = useDocument((s) => s.activeLevelId);
  const mode = useView3d((s) => s.mode);
  const projection = useView3d((s) => s.projection);
  const camerasOpen = useView3d((s) => s.camerasOpen);
  const recall = useView3d((s) => s.recall);
  const dark = useAppearance((s) => s.dark);
  const rootRef = useRef<HTMLDivElement>(null);
  const placedRef = useRef(false);
  const liveRef = useRef<LiveView>({ eye: { x: 0, y: -10, z: 66 }, target: { x: 0, y: 0, z: 66 }, zoom: 0 });
  const [name, setName] = useState('');
  const [shownTextures, setShownTextures] = useState(0);
  const [wallDisplay, setWallDisplay] = useState('finished');
  const [showRoof, setShowRoof] = useState(true);
  const [showCeilings, setShowCeilings] = useState(true);
  const allParts = useMemo(() => buildPlanMeshes(doc), [doc]);
  const parts = useMemo(() => allParts.filter((part) => {
    const element = doc.elements[part.elementId];
    if (!showRoof && element?.kind === 'roofPlane') return false;
    if (!showCeilings && part.role === 'ceiling') return false;
    if (element?.kind !== 'wall' || wallDisplay === 'finished') return true;
    const category = part.materialId ? doc.materials[part.materialId]?.category : null;
    return category === 'framing' || (wallDisplay === 'insulated' && category === 'insulation');
  }), [allParts, doc, wallDisplay, showRoof, showCeilings]);
  const cameras = useMemo(() => camerasIn(doc), [doc]);
  const textured = useMemo(() => parts.filter((part) => partTexture(doc, part)).length, [doc, parts]);
  const elevation = doc.levels[levelId]?.elevation ?? doc.levels[doc.levelOrder[0] ?? '']?.elevation ?? 0;
  const barriers = useMemo(() => walkObstacles(doc, levelId), [doc, levelId]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const current = liveRef.current;
    const ortho = mode === 'orbit' && projection === 'orthographic';
    const result = dispatch('camera.save', {
      levelId,
      name: name.trim() || 'View',
      mode,
      eye: current.eye,
      target: current.target,
      ...(ortho ? { projection: 'orthographic' as const, ...(current.zoom > 0 ? { zoom: current.zoom } : {}) } : {}),
    });
    notify(errorOf(result));
    if (result.ok) setName('');
  };

  const restore = (camera: SavedCamera) => {
    setActiveLevel(camera.levelId);
    recallCamera(camera.mode, camera.eye, camera.target, camera.projection === 'orthographic' ? 'orthographic' : 'perspective', camera.zoom);
  };

  return (
    <div className="view-3d" ref={rootRef} data-testid="view-3d" data-mesh-count={parts.length} data-mode={mode} data-projection={mode === 'walk' ? 'perspective' : projection} data-shadows="on" data-textured={shownTextures}>
      <Canvas className="view-3d-canvas" shadows camera={{ fov: 45, near: 1, far: 100000, position: [240, -280, 180] }} gl={{ antialias: true, preserveDrawingBuffer: true }} onCreated={({ gl }) => { gl.shadowMap.type = PCFSoftShadowMap; }}>
        <Suspense fallback={null}>
          <Scene
            doc={doc}
            levelId={levelId}
            parts={parts}
            elevation={elevation}
            mode={mode}
            projection={projection}
            recall={recall}
            placedRef={placedRef}
            liveRef={liveRef}
            rootRef={rootRef}
            textured={textured}
            onTextured={setShownTextures}
            dark={dark}
            barriers={barriers}
          />
        </Suspense>
      </Canvas>
      {parts.length === 0 && <p className="view-3d-empty">Draw walls in the plan to see them here.</p>}
      <div className="view-3d-inspect">
        <label>Walls <select aria-label="3D wall display" value={wallDisplay} onChange={(e) => setWallDisplay(e.target.value)}>
          <option value="finished">All materials</option><option value="framing">Framing & utilities</option><option value="insulated">Framing & insulation</option>
        </select></label>
        <label><input type="checkbox" checked={showRoof} onChange={(e) => setShowRoof(e.target.checked)} /> Roof sheathing</label>
        <label><input type="checkbox" checked={showCeilings} onChange={(e) => setShowCeilings(e.target.checked)} /> Ceilings</label>
      </div>
      <div className="view-3d-bar">
        <div className="view-3d-modes" role="group" aria-label="Camera mode">
          <button type="button" aria-pressed={mode === 'orbit' && projection === 'perspective'} onClick={() => setOrbit('perspective')}>
            Orbit
          </button>
          <button type="button" aria-pressed={mode === 'orbit' && projection === 'orthographic'} onClick={() => setOrbit('orthographic')}>
            Ortho
          </button>
          <button type="button" aria-pressed={mode === 'walk'} onClick={() => setViewMode('walk')}>
            Walk
          </button>
        </div>
        <p className="view-3d-hint">{mode === 'walk' ? 'Click to look. WASD to walk, Shift to go faster.' : 'Drag to orbit, scroll to zoom, right-drag to pan.'}</p>
      </div>
      {camerasOpen && (
        <aside className="view-3d-cameras" aria-label="Saved cameras">
          <h3 className="panel-heading">Cameras</h3>
          <form onSubmit={save}>
            <input className="field-input" aria-label="Camera name" value={name} maxLength={100} placeholder="View" onChange={(event) => setName(event.target.value)} />
            <button className="text-button primary" type="submit">
              Save camera
            </button>
          </form>
          {cameras.length === 0 ? (
            <p className="panel-hint">No saved cameras.</p>
          ) : (
            <ul className="view-3d-camera-list">
              {cameras.map((camera) => (
                <li key={camera.id} className="view-3d-camera-row">
                  <button type="button" onClick={() => restore(camera)}>
                    {camera.name}
                  </button>
                  <button type="button" className="text-button" aria-label={`Delete ${camera.name}`} onClick={() => notify(errorOf(dispatch('elements.delete', { ids: [camera.id] })))}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}
