import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Object3D, Uint32BufferAttribute } from 'three';
import { buildPlanMeshes, meshBounds, type MeshPart, type PlanDocument } from '@framewright/core';
import { useDocument } from '../document/store';

Object3D.DEFAULT_UP.set(0, 0, 1);

const ROLE_COLOR: Record<MeshPart['role'], string> = {
  solid: '#c8c4be',
  floor: '#e4dfd8',
  panel: '#8d7355',
  glass: '#b7d4de',
};

function partColor(doc: PlanDocument, part: MeshPart): string {
  if (part.materialId) return doc.materials[part.materialId]?.color ?? ROLE_COLOR.solid;
  return ROLE_COLOR[part.role];
}

function PartMesh({ part, color }: { part: MeshPart; color: string }) {
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
        color={color}
        roughness={glass ? 0.05 : 0.82}
        metalness={0}
        transparent={glass}
        opacity={glass ? 0.35 : 1}
        side={DoubleSide}
      />
    </mesh>
  );
}

interface OrbitTarget {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

function isOrbit(value: unknown): value is OrbitTarget {
  if (typeof value !== 'object' || value === null || !('target' in value) || !('update' in value)) return false;
  const target = value.target;
  return typeof target === 'object' && target !== null && 'set' in target && typeof value.update === 'function';
}

function FrameScene({ parts }: { parts: MeshPart[] }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const moved = useRef(false);
  const key = useMemo(() => {
    const b = meshBounds(parts);
    return b ? b.min.concat(b.max).map((n) => n.toFixed(1)).join(',') : '';
  }, [parts]);

  useEffect(() => {
    if (moved.current) return;
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
  }, [camera, controls, key, parts]);

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.14}
      onStart={() => {
        moved.current = true;
      }}
    />
  );
}

/** Orbit view of the plan's solids. Drag to orbit, scroll to zoom, right-drag to pan. */
export function View3D() {
  const doc = useDocument((s) => s.doc);
  const parts = useMemo(() => buildPlanMeshes(doc), [doc]);
  const colors = useMemo(() => parts.map((part) => partColor(doc, part)), [doc, parts]);
  const ground = doc.levels[doc.levelOrder[0] ?? '']?.elevation ?? 0;

  return (
    <div className="view-3d" data-testid="view-3d" data-mesh-count={parts.length}>
      <Canvas camera={{ fov: 45, near: 1, far: 100000, position: [240, -280, 180] }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={['#e4e7ec']} />
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#f4f7fb', '#d9cbb8', 0.4]} />
        <directionalLight position={[180, -120, 260]} intensity={1.15} />
        <gridHelper args={[720, 30, '#d4d0ca', '#eceae6']} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, ground]} />
        {parts.map((part, i) => (
          <PartMesh key={`${part.elementId}:${part.role}:${i}`} part={part} color={colors[i] ?? ROLE_COLOR.solid} />
        ))}
        <FrameScene parts={parts} />
      </Canvas>
      {parts.length === 0 && <p className="view-3d-empty">Draw walls in the plan to see them here.</p>}
      <p className="view-3d-hint">Drag to orbit, scroll to zoom, right-drag to pan.</p>
    </div>
  );
}
