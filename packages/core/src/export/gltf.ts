import { buildPlanMeshes, type MeshPart, type MeshRole } from '../mesh/meshes';
import type { PlanDocument } from '../model/schema';

/** Inches to meters. glTF viewers treat a unit as one meter. */
const METERS_PER_INCH = 0.0254;

const ROLE_COLOR: Record<MeshRole, [number, number, number]> = {
  solid: [0.784, 0.769, 0.745],
  floor: [0.894, 0.875, 0.847],
  ceiling: [0.925, 0.918, 0.902],
  panel: [0.553, 0.451, 0.333],
  glass: [0.718, 0.831, 0.871],
};

interface Bucket {
  name: string;
  color: [number, number, number, number];
  blend: boolean;
  positions: number[];
  normals: number[];
  indices: number[];
}

/**
 * Binary glTF of the whole model. Coordinates are meters, Y up.
 * Materials are the plan colors. Texture images are not embedded.
 */
export function planGlb(doc: PlanDocument): Uint8Array {
  const buckets = new Map<string, Bucket>();
  for (const part of buildPlanMeshes(doc)) {
    if (part.indices.length < 3 || part.positions.length < 9) continue;
    const bucket = bucketFor(doc, part, buckets);
    const base = bucket.positions.length / 3;
    for (let i = 0; i < part.positions.length; i += 3) {
      const x = part.positions[i]!;
      const y = part.positions[i + 1]!;
      const z = part.positions[i + 2]!;
      bucket.positions.push(x * METERS_PER_INCH, z * METERS_PER_INCH, -y * METERS_PER_INCH);
      const nx = part.normals[i] ?? 0;
      const ny = part.normals[i + 1] ?? 0;
      const nz = part.normals[i + 2] ?? 0;
      bucket.normals.push(nx, nz, -ny);
    }
    for (const index of part.indices) bucket.indices.push(base + index);
  }
  return encodeGlb([...buckets.values()].filter((bucket) => bucket.indices.length >= 3));
}

function bucketFor(doc: PlanDocument, part: MeshPart, buckets: Map<string, Bucket>): Bucket {
  const material = part.materialId ? doc.materials[part.materialId] : undefined;
  const key = `${part.materialId ?? part.role}:${part.role === 'glass' ? 'glass' : 'solid'}`;
  const existing = buckets.get(key);
  if (existing) return existing;
  const rgb = material ? hex(material.color) : ROLE_COLOR[part.role];
  const glass = part.role === 'glass';
  const bucket: Bucket = {
    name: material?.name ?? part.role,
    color: [rgb[0], rgb[1], rgb[2], glass ? 0.35 : 1],
    blend: glass,
    positions: [],
    normals: [],
    indices: [],
  };
  buckets.set(key, bucket);
  return bucket;
}

function encodeGlb(buckets: Bucket[]): Uint8Array {
  const bin: number[] = [];
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] = [];
  const primitives: { attributes: { POSITION: number; NORMAL: number }; indices: number; material: number }[] = [];
  const materials = buckets.map((bucket) => ({
    name: bucket.name,
    doubleSided: true,
    alphaMode: bucket.blend ? 'BLEND' : 'OPAQUE',
    pbrMetallicRoughness: { baseColorFactor: bucket.color, metallicFactor: 0, roughnessFactor: bucket.blend ? 0.05 : 0.82 },
  }));

  const align = () => {
    while (bin.length % 4 !== 0) bin.push(0);
  };
  const pushFloats = (values: number[], target: number): number => {
    align();
    const byteOffset = bin.length;
    let min0 = Infinity;
    let min1 = Infinity;
    let min2 = Infinity;
    let max0 = -Infinity;
    let max1 = -Infinity;
    let max2 = -Infinity;
    for (let i = 0; i < values.length; i += 3) {
      const x = values[i]!;
      const y = values[i + 1]!;
      const z = values[i + 2]!;
      min0 = Math.min(min0, x);
      min1 = Math.min(min1, y);
      min2 = Math.min(min2, z);
      max0 = Math.max(max0, x);
      max1 = Math.max(max1, y);
      max2 = Math.max(max2, z);
      const view = new DataView(new ArrayBuffer(12));
      view.setFloat32(0, x, true);
      view.setFloat32(4, y, true);
      view.setFloat32(8, z, true);
      bin.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3), view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7), view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    }
    const viewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: values.length * 4, target });
    accessors.push({ bufferView: viewIndex, componentType: 5126, count: values.length / 3, type: 'VEC3', min: [min0, min1, min2], max: [max0, max1, max2] });
    return accessors.length - 1;
  };
  const pushIndices = (values: number[]): number => {
    align();
    const byteOffset = bin.length;
    for (const index of values) {
      const view = new DataView(new ArrayBuffer(4));
      view.setUint32(0, index, true);
      bin.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    }
    const viewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: values.length * 4, target: 34963 });
    accessors.push({ bufferView: viewIndex, componentType: 5125, count: values.length, type: 'SCALAR' });
    return accessors.length - 1;
  };

  buckets.forEach((bucket, material) => {
    const position = pushFloats(bucket.positions, 34962);
    const normal = pushFloats(bucket.normals, 34962);
    const indices = pushIndices(bucket.indices);
    primitives.push({ attributes: { POSITION: position, NORMAL: normal }, indices, material });
  });

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Framewright' },
    scene: 0,
    scenes: [{ nodes: primitives.length > 0 ? [0] : [] }],
  };
  if (primitives.length > 0) {
    json.nodes = [{ name: 'Model', mesh: 0 }];
    json.meshes = [{ name: 'Model', primitives }];
    json.materials = materials;
    json.accessors = accessors;
    json.bufferViews = bufferViews;
    json.buffers = [{ byteLength: bin.length }];
  }
  return packGlb(JSON.stringify(json), primitives.length > 0 ? new Uint8Array(bin) : null);
}

function packGlb(jsonText: string, bin: Uint8Array | null): Uint8Array {
  const jsonBytes = utf8(jsonText);
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;
  const total = 12 + 8 + jsonBytes.length + jsonPad + (bin ? 8 + bin.length + binPad : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length + jsonPad, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  if (bin) {
    const binStart = 20 + jsonBytes.length + jsonPad;
    view.setUint32(binStart, bin.length + binPad, true);
    view.setUint32(binStart + 4, 0x004e4942, true);
    out.set(bin, binStart + 8);
  }
  return out;
}

function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(bytes);
}

function hex(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
