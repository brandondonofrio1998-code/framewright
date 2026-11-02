import { OrbitControls, useTexture } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  NoColorSpace,
  Object3D,
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
  eyeZ,
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
  type WalkPose,
} from '@framewright/core';
import { dispatch, setActiveLevel, useDocument } from '../document/store';
import { notify } from '../editor/store';
import { TEXTURE_URLS } from './textures';
import { recallCamera, setViewMode, useView3d, type Recall } from './view-state';

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

function PartMesh({ part, color, maps }: { part: MeshPart; color: string; maps?: { color: Texture; normal: Texture; roughness: Texture } }) {
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
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={maps ? '#ffffff' : color}
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
    };
    if (recall && recall.mode === 'orbit' && recall.token !== seen.current) {
      camera.up.set(0, 0, 1);
      camera.position.set(recall.eye.x, recall.eye.y, recall.eye.z);
      camera.lookAt(recall.target.x, recall.target.y, recall.target.z);
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
      if (current && isOrbit(controls)) {
        controls.target.set(current.target.x, current.target.y, current.target.z);
        controls.update();
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
    camera.updateProjectionMatrix();
    if (isOrbit(controls)) {
      controls.target.set(cx, cy, cz);
      controls.update();
    }
    placedRef.current = true;
    writeLive();
  }, [camera, controls, key, liveRef, parts, placedRef, recall]);

  useFrame(() => {
    const current = liveRef.current;
    if (!current) return;
    current.eye = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    if (isOrbit(controls)) current.target = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
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

function WalkControls({ elevation, recall, liveRef }: { elevation: number; recall: Recall | null; liveRef: RefObject<LiveView> }) {
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
      pose.current = stepWalk(pose.current, { forward: (forward / mag) * speed, strafe: (strafe / mag) * speed, yaw: 0, pitch: 0, elevation });
    } else {
      pose.current = { ...pose.current, z: eyeZ(elevation) };
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

function Scene({
  doc,
  parts,
  elevation,
  mode,
  recall,
  placedRef,
  liveRef,
  rootRef,
  textured,
  onTextured,
}: {
  doc: PlanDocument;
  parts: MeshPart[];
  elevation: number;
  mode: 'orbit' | 'walk';
  recall: Recall | null;
  placedRef: RefObject<boolean>;
  liveRef: RefObject<LiveView>;
  rootRef: RefObject<HTMLDivElement | null>;
  textured: number;
  onTextured: (count: number) => void;
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
      <color attach="background" args={['#e4e7ec']} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#f4f7fb', '#d9cbb8', 0.4]} />
      <directionalLight position={[180, -120, 260]} intensity={1.15} />
      <gridHelper args={[720, 30, '#d4d0ca', '#eceae6']} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, elevation]} />
      {groups.flat.map((item, i) => (
        <PartMesh key={`${item.part.elementId}:flat:${i}`} part={item.part} color={item.color} />
      ))}
      {groups.textured.map((group) => (
        <TexturedGroup key={`${group.texture.id}:${group.texture.tile.join(',')}`} texture={group.texture} items={group.items} />
      ))}
      {mode === 'walk' ? <WalkControls elevation={elevation} recall={recall} liveRef={liveRef} /> : <FrameScene parts={parts} placedRef={placedRef} liveRef={liveRef} recall={recall} />}
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
  const camerasOpen = useView3d((s) => s.camerasOpen);
  const recall = useView3d((s) => s.recall);
  const rootRef = useRef<HTMLDivElement>(null);
  const placedRef = useRef(false);
  const liveRef = useRef<LiveView>({ eye: { x: 0, y: -10, z: 66 }, target: { x: 0, y: 0, z: 66 } });
  const [name, setName] = useState('');
  const [shownTextures, setShownTextures] = useState(0);
  const parts = useMemo(() => buildPlanMeshes(doc), [doc]);
  const cameras = useMemo(() => camerasIn(doc), [doc]);
  const textured = useMemo(() => parts.filter((part) => partTexture(doc, part)).length, [doc, parts]);
  const elevation = doc.levels[levelId]?.elevation ?? doc.levels[doc.levelOrder[0] ?? '']?.elevation ?? 0;

  const save = (event: FormEvent) => {
    event.preventDefault();
    const current = liveRef.current;
    const result = dispatch('camera.save', { levelId, name: name.trim() || 'View', mode, eye: current.eye, target: current.target });
    notify(errorOf(result));
    if (result.ok) setName('');
  };

  const restore = (camera: SavedCamera) => {
    setActiveLevel(camera.levelId);
    recallCamera(camera.mode, camera.eye, camera.target);
  };

  return (
    <div className="view-3d" ref={rootRef} data-testid="view-3d" data-mesh-count={parts.length} data-mode={mode} data-textured={shownTextures}>
      <Canvas className="view-3d-canvas" camera={{ fov: 45, near: 1, far: 100000, position: [240, -280, 180] }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <Suspense fallback={null}>
          <Scene
            doc={doc}
            parts={parts}
            elevation={elevation}
            mode={mode}
            recall={recall}
            placedRef={placedRef}
            liveRef={liveRef}
            rootRef={rootRef}
            textured={textured}
            onTextured={setShownTextures}
          />
        </Suspense>
      </Canvas>
      {parts.length === 0 && <p className="view-3d-empty">Draw walls in the plan to see them here.</p>}
      <div className="view-3d-bar">
        <div className="view-3d-modes" role="group" aria-label="Camera mode">
          <button type="button" aria-pressed={mode === 'orbit'} onClick={() => setViewMode('orbit')}>
            Orbit
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
