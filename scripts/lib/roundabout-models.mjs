// roundabout-models.mjs: normalize and slim Grab3D GLBs for the roundabout trainer
//
// Usage: node roundabout-models.mjs <tools-dir> <src-dir> <out-dir>
//        node roundabout-models.mjs --slugs
//   tools-dir  holds node_modules with @gltf-transform/{core,extensions,functions}, meshoptimizer, sharp
//   src-dir    holds <slug>.glb downloads (untrusted data: only parsed, never executed)
//   out-dir    receives <name>.glb and meta.json
//
// Output convention: +Z is forward, +X is the vehicle's left, +Y up, metres. Vehicles have the origin on
// the ground midway between the front axle and the rear axle(s). Wheel nodes are named wheel_FL, wheel_FR,
// wheel_RL, wheel_RR (extra rear axles wheel_RL2, wheel_RR2) with their pivot at the wheel centre, so
// rotation.x spins and rotation.y steers. Props have the origin at ground level under the bbox centre.
// Materials are base colour only (normal and metal-rough maps are dropped); lamp materials are renamed
// 'headlight' / 'taillight' so the renderer can drive their emissive.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Vehicles: length is the target length (m); ratio is the triangle keep ratio.
const VEHICLES = {
  hatch: { slug: 'hatchback', length: 4.05, ratio: 0.3 },
  estate: { slug: 'station-wagon', length: 4.6, ratio: 0.3 },
  van: { slug: 'delivery-van', length: 5.0, ratio: 0.3 },
  bus: { slug: 'city-bus', length: 11, ratio: 0.35 },
  lorry: { slug: 'tanker-truck', length: 8.5, ratio: 0.35 },
};
const SCENERY = {
  tree: { slug: 'oak-tree', tris: 2500, tex: 256 },
  birch: { slug: 'birch-tree', tris: 2500, tex: 256 },
  pine: { slug: 'pine-tree', tris: 2500, tex: 256 },
  shelter: { slug: 'bus-stop-shelter', tris: 2000, normals: 'flat' },
  hedge: { slug: 'hedge', tris: 1500, tex: 256 },
  bush: { slug: 'bush', tris: 1500, tex: 256 },
  grass: { slug: 'grass-clump', tris: 600, tex: 256 },
  man: { slug: 'man', tris: 3000, tex: 256, error: 0.3 },
  woman: { slug: 'woman', tris: 3000, tex: 256, error: 0.3 },
  businessman: { slug: 'businessman', tris: 3000, tex: 256, error: 0.3 },
  streetlight: { slug: 'street-light', tris: 2000 },
  bollard: { slug: 'bollard', tris: 400 },
  bin: { slug: 'trash-can', tris: 800, normals: 'smooth' },
  railing: { slug: 'metal-fence', tris: 3000, normals: 'flat' },
  terrace: { slug: 'row-houses', tris: 7000, normals: 'flat' },
  shopfront: { slug: 'shop-front', tris: 5000, normals: 'flat' },
  cottage: { slug: 'cottage-house', tris: 4000 },
  clocktower: { slug: 'clock-tower', tris: 6000, normals: 'flat' },
};
// Props: tris is the target triangle count, tex the texture edge in px, error the simplifier's
// relative error ceiling (raise it when tris is far below the source). The output name may carry
// a folder. slug is a Grab3D slug; the matching GLB is <src-dir>/<slug>.glb.
const PROPS = {
  ...Object.fromEntries(Object.entries(SCENERY).map(([k, v]) => [`scenery/${k}`, v])),
};
const WHEELS = { fl: 'wheel_FL', fr: 'wheel_FR', rl: 'wheel_RL', rr: 'wheel_RR', r1l: 'wheel_RL', r1r: 'wheel_RR', r2l: 'wheel_RL2', r2r: 'wheel_RR2' };
const round = (v) => Math.round(v * 100) / 100;

// --slugs lists every Grab3D slug the tables use, for the download step in build-roundabout-assets.sh
if (process.argv[2] === '--slugs') {
  console.log([...Object.values(VEHICLES), ...Object.values(PROPS)].map((c) => c.slug).join('\n'));
  process.exit(0);
}
const [toolsDir, srcDir, outDir] = process.argv.slice(2);
if (!outDir) { console.error('usage: roundabout-models.mjs <tools-dir> <src-dir> <out-dir> | --slugs'); process.exit(1); }
const need = createRequire(join(toolsDir, 'package.json'));
const { NodeIO, getBounds, Logger } = need('@gltf-transform/core');
const { ALL_EXTENSIONS } = need('@gltf-transform/extensions');
const fn = need('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = need('meshoptimizer');
const sharp = need('sharp');

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// Scales positions about the origin; meshes are unshared in these sources, so baking in place is safe.
function bakeScale(root, s) {
  const m = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  root.traverse((n) => {
    n.setTranslation(n.getTranslation().map((v) => v * s));
    if (n.getMesh()) fn.transformMesh(n.getMesh(), m);
  });
}

function shiftChildren(root, [dx, dy, dz]) {
  for (const c of root.listChildren()) {
    const [x, y, z] = c.getTranslation();
    c.setTranslation([x + dx, y + dy, z + dz]);
  }
}

function simplifyMaterials(doc) {
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setNormalTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.85);
    const name = mat.getName();
    if (/taillight/.test(name)) mat.setName('taillight');
    else if (/(^|_)light_/.test(name)) mat.setName('headlight');
    else if (/glass/.test(name)) mat.setName('glass');
  }
}

// One simplify pass stalls well above the target on meshes with many UV seams or tiny parts, so it
// repeats (each pass at most 10x) until the target is met or a pass gains under 3%.
async function simplifyTo(doc, target, error) {
  for (let pass = 0; pass < 8; pass++) {
    const before = triangles(doc);
    if (before <= target * 1.05) return;
    await doc.transform(fn.simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.1, target / before), error }));
    if (triangles(doc) > before * 0.97) return;
  }
}

// Area-weighted vertex normals; vertices split at UV seams get separate normals.
function smoothNormals(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION').getArray();
      const idx = p.getIndices().getArray();
      const n = new Float32Array(pos.length);
      for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
        const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
        const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
        const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k] += f[k];
      }
      for (let v = 0; v < n.length; v += 3) {
        const len = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
        for (let k = 0; k < 3; k++) n[v + k] /= len;
      }
      p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n));
    }
  }
}

// normals: hard-edged (flat-shaded) sources keep a vertex per face corner, which stops simplification
// outright. 'flat' drops them (three.js then shades flat), 'smooth' drops them and recomputes
// smooth normals after simplifying.
async function slim(doc, target, { error = 0.01, tex = 512, normals } = {}) {
  if (normals) {
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('NORMAL', null);
  }
  await doc.transform(fn.weld());
  await simplifyTo(doc, target, error);
  if (normals === 'smooth') smoothNormals(doc);
  await doc.transform(
    fn.dedup(),
    fn.prune(),
    fn.reorder({ encoder: MeshoptEncoder }),
    fn.quantize(),
    fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }),
    fn.meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
}

function triangles(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? 0) / 3;
  return Math.round(t);
}

const meta = {};

async function vehicle(name, { slug, length, ratio }) {
  const doc = await io.read(join(srcDir, `${slug}.glb`));
  const scene = doc.getRoot().listScenes()[0];
  const root = scene.listChildren()[0];
  const b0 = getBounds(scene);
  bakeScale(root, length / (b0.max[2] - b0.min[2]));

  const wheels = {};
  let body = null;
  for (const n of root.listChildren()) {
    const suffix = n.getName().match(/_wheel_(\w+)$/)?.[1];
    if (suffix) {
      if (!WHEELS[suffix]) throw new Error(`${slug}: unknown wheel ${suffix}`);
      n.setName(WHEELS[suffix]);
      wheels[WHEELS[suffix]] = n;
    } else if (n.getName().endsWith('_body')) {
      body = n;
    }
    if (!suffix) n.setName(n.getName().replace(`${slug}_`, ''));
  }
  if (!body || !wheels.wheel_FL || !wheels.wheel_FR || !wheels.wheel_RL || !wheels.wheel_RR) throw new Error(`${slug}: body or wheels missing`);

  const rearZ = Object.entries(wheels).filter(([k]) => k.startsWith('wheel_R')).map(([, n]) => n.getTranslation()[2]);
  const midZ = (wheels.wheel_FL.getTranslation()[2] + rearZ.reduce((a, b) => a + b) / rearZ.length) / 2;
  const minY = getBounds(scene).min[1];
  shiftChildren(root, [0, -minY, -midZ]);
  root.setName(name);
  simplifyMaterials(doc);
  await slim(doc, ratio * triangles(doc));
  await io.write(join(outDir, `${name}.glb`), doc);

  const b = getBounds(scene);
  const bb = getBounds(body);
  const d = 2 * Math.abs(wheels.wheel_FL.getTranslation()[1]);
  const half = Math.max(Math.abs(bb.min[0]), bb.max[0]) - 0.2;
  const lamp = (y, z) => ({ L: [round(half), round(y), round(z)], R: [round(-half), round(y), round(z)] });
  meta[name] = {
    forward: '+Z',
    size: { length: round(b.max[2] - b.min[2]), width: round(b.max[0] - b.min[0]), height: round(b.max[1]) },
    z: [round(b.min[2]), round(b.max[2])],
    triangles: triangles(doc),
    wheels: Object.fromEntries(Object.entries(wheels).map(([k, n]) => [k, n.getTranslation().map(round)])),
    wheelRadius: round(d / 2),
    indicators: { front: lamp(1.15 * d, bb.max[2]), rear: lamp(1.25 * d, bb.min[2]) },
    lampMaterials: doc.getRoot().listMaterials().map((m) => m.getName()).filter((n) => n === 'headlight' || n === 'taillight'),
  };
}

// Props keep their native metre scale. Flatten + join leave one primitive per material, which is
// what the renderer instances, so the primitive count is the draw-call cost of one prop.
async function prop(name, { slug, tris, ...opts }) {
  const doc = await io.read(join(srcDir, `${slug}.glb`));
  const scene = doc.getRoot().listScenes()[0];
  await doc.transform(fn.flatten(), fn.join());
  simplifyMaterials(doc);
  const b1 = getBounds(scene);
  shiftChildren(scene, [-(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2]);
  await slim(doc, tris, { error: 0.05, ...opts });
  mkdirSync(dirname(join(outDir, `${name}.glb`)), { recursive: true });
  await io.write(join(outDir, `${name}.glb`), doc);
  const b = getBounds(scene);
  const primitives = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);
  meta[name] = { size: { width: round(b.max[0] - b.min[0]), depth: round(b.max[2] - b.min[2]), height: round(b.max[1]) }, triangles: triangles(doc), primitives };
}

for (const [name, cfg] of Object.entries(VEHICLES)) await vehicle(name, cfg);
for (const [name, cfg] of Object.entries(PROPS)) await prop(name, cfg);
writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(JSON.stringify(meta, null, 1));
