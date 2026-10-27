/**
 * GLB loading and flattening for the scene budget (<100 draw calls). Grab3D models arrive as many small
 * primitives; flatten() merges them so a model costs a few draws and instances cheaply:
 *   flat      every untextured, non-emissive primitive, baked to vertex colours (one geometry)
 *   glass     primitives whose material is named glass (own material: low roughness reads as glass)
 *   emissive  emissive primitives (lamp panels, bus display)
 *   <uuid>    textured primitives, one group per material
 * Every geometry is copied to plain Float32 position/normal(/uv) in the root's space: KHR_mesh_quantization
 * stores normalized ints, which cannot merge with each other or be transformed in place.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

export function loadGlb(url) {
  // One retry: a flaky connection should cost a moment, not a missing model; a failure is not cached.
  if (!cache.has(url)) {
    const p = loader.loadAsync(url).catch(() => loader.loadAsync(url)).then((g) => g.scene);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

const GETTERS = ['getX', 'getY', 'getZ', 'getW'];

function plainCopy(geometry, matrix, { uv, color, mask }) {
  const g = new THREE.BufferGeometry();
  const copy = (name) => {
    const a = geometry.getAttribute(name);
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a[GETTERS[k]](i);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  };
  copy('position');
  if (geometry.getAttribute('normal')) copy('normal');
  else g.computeVertexNormals();
  if (uv) copy('uv');
  const n = g.getAttribute('position').count;
  if (color) {
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (mask !== undefined) g.setAttribute('aMask', new THREE.BufferAttribute(new Float32Array(n).fill(mask), 1));
  const index = geometry.index ? Array.from(geometry.index.array) : [...Array(n).keys()];
  g.setIndex(index);
  g.applyMatrix4(matrix);
  return g;
}

/**
 * flatten(root, opts) -> [{ key, geometry, material }] (source material for textured/glass/emissive groups).
 * opts.include(mesh)    false skips a mesh (vehicles take wheels separately)
 * opts.colour(material) overrides a flat primitive's colour (THREE.Color, linear)
 * opts.mask(material)   per-vertex aMask on the flat group (vehicle paint); omit for no attribute
 * opts.matrix           extra transform applied after the root-relative one
 * opts.flat             everything into the flat group (textured parts take opts.colour)
 * opts.mergeGlass       glass joins the flat group (scenery: one draw fewer, nobody looks through it)
 */
export function flatten(root, opts = {}) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const add = (key, geometry, material) => {
    if (!groups.has(key)) groups.set(key, { key, material, parts: [] });
    groups.get(key).parts.push(geometry);
  };
  root.traverse((o) => {
    if (!o.isMesh || (opts.include && !opts.include(o))) return;
    const m = new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld);
    if (opts.matrix) m.premultiply(opts.matrix);
    const mat = o.material;
    const emissive = mat.emissiveMap || (mat.emissive && mat.emissive.getHex() !== 0);
    if (opts.flat) add('flat', plainCopy(o.geometry, m, { color: opts.colour?.(mat) ?? mat.color }), mat);
    else if (/glass/i.test(mat.name) && !opts.mergeGlass) add('glass', plainCopy(o.geometry, m, {}), mat);
    else if (emissive) add('emissive', plainCopy(o.geometry, m, { uv: !!mat.map || !!mat.emissiveMap }), mat);
    else if (mat.map) add(mat.uuid, plainCopy(o.geometry, m, { uv: true }), mat);
    else {
      const colour = opts.colour?.(mat) ?? mat.color;
      add('flat', plainCopy(o.geometry, m, { color: colour, mask: opts.mask ? opts.mask(mat) : undefined }), mat);
    }
  });
  return [...groups.values()].map((g) => ({ key: g.key, material: g.material, geometry: mergeGeometries(g.parts) }));
}

/**
 * Vertex-clustering simplification for distant and mirrored copies: vertices in the same `cell`-sized grid
 * cell collapse onto the first one seen (keeping its normal and uv), and triangles that collapse vanish.
 * Shares the source attributes; only the index is new.
 */
export function cluster(geometry, cell) {
  const pos = geometry.getAttribute('position');
  const rep = new Int32Array(pos.count);
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
    if (!seen.has(key)) seen.set(key, i);
    rep[i] = seen.get(key);
  }
  const src = geometry.index.array;
  const out = [];
  const tris = new Set();
  for (let i = 0; i < src.length; i += 3) {
    const a = rep[src[i]], b = rep[src[i + 1]], c = rep[src[i + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (tris.has(key)) continue;
    tris.add(key);
    out.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) g.setAttribute(name, attr);
  g.setIndex(out);
  return g;
}

export const triangles =(geometry) => (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
