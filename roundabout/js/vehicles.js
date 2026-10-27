/**
 * Traffic rendering: sim snapshots -> instanced vehicles, wheels, lamps and blob shadows.
 *
 *   const vehicles = await createVehicles(scene, { meta, base })
 *   vehicles.update(prev, curr, alpha, { showPlayer, dt, ghosts, statics, eye })  interpolated poses of two snapshots
 *                                    (no GPU write: commit before every render)
 *   vehicles.commit(allLod, camera?) writes the poses to the GPU; true for the mirror passes (only vehicles a
 *                                    mirror can show, as their simplified copy), false + the camera for the main
 *                                    view (frustum-culled, simplified beyond LOD_DISTANCE). eye = { x, z, heading? }
 *   vehicles.highlight(id | null, { lamp })   pulsing outline on one vehicle; lamp keeps its indicator lit
 *   vehicles.dispose()               frees every geometry, material and texture it made
 *   vehicles.setLayout(layout)       ghosts need the ring radius; clears ghosts
 *   vehicles.clearGhosts()           after debug traffic changes
 *   vehicles.setTheme(palette)       shadow strength
 *   vehicles.lampUniforms            { uPxWorld } set per camera by main
 *
 * One draw per (type, part): body (texture, repainted per instance), flat parts (vertex colours), glass,
 * wheels (every wheel of every vehicle of the type). Models face +Z with +X their left, so a vehicle at
 * compass heading h gets rotation.y = PI - h; they are stretched lengthwise to the sim's length so the gaps
 * the player judges are the gaps the sim uses.
 */
import * as THREE from 'three';
import { loadGlb, flatten, cluster, triangles } from './gltf.js';
import { VEHICLE_TYPES } from './traffic-data.js';
import { wrapPi } from './geom.js';
import { LAMP, lampsFor } from './lamps.js';

const TYPES = Object.keys(VEHICLE_TYPES);
const CAPACITY = { hatch: 40, estate: 24, van: 20, bus: 4, lorry: 8 };
// Dominant body colour of each model's texture atlas (sRGB); texels near it are repainted.
const PAINT_KEY = { hatch: '#8ECFB3', estate: '#9CCFBD', van: '#F1B18C', bus: '#7AB4E3', lorry: '#D69F96' };
// Road-wheel angles at roundabout radii are 5-10 deg; a little gain keeps the cue the trainer teaches readable on a phone.
const STEER_GAIN = 1.5;
const GHOST_SECONDS = 6;
// m from the eye beyond which a vehicle is drawn from its clustered copy (~50 px wide on a phone here; full
// models are 6-10k tris against ~3.5k, and the 200k frame budget is shared with scenery)
const LOD_DISTANCE = 20;
const LOD_CELL = 0.11; // m grid of the clustered copy
// Mirror cull: a car beyond this is a few pixels in a 256 px glass; one further ahead than this (m along the
// driver's heading) is outside every mirror's rearward view.
const MIRROR_RANGE = 45;
const MIRROR_AHEAD = 4;
const LAMP_CAPACITY = 640;

const isWheelNode = (o) => /^wheel_/.test(o.name) || /^wheel_/.test(o.parent?.name ?? '');
const wheelName = (o) => (/^wheel_/.test(o.name) ? o.name : o.parent?.name);

function vec3Of(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/**
 * Per-instance repaint. With a key, texels whose chromaticity is near the atlas's body colour take the
 * instance colour, keeping their shading; otherwise the aMask vertex attribute marks painted flat parts.
 */
function paintable(material, key) {
  material.onBeforeCompile = (shader) => {
    const vary = 'varying vec3 vPaint;' + (key ? '' : '\nvarying float vMask;');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aPaint;\n${key ? '' : 'attribute float aMask;\n'}${vary}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPaint = aPaint;${key ? '' : '\nvMask = aMask;'}`);
    const keyed = `
      vec3 rbKey = ${vec3Of(key ?? '#000000')};
      float rbKeyL = dot(rbKey, vec3(.2126, .7152, .0722));
      vec3 rbC = diffuseColor.rgb;
      float rbL = dot(rbC, vec3(.2126, .7152, .0722));
      float rbM = (1.0 - smoothstep(.1, .28, distance(rbC / max(rbL, 1e-3), rbKey / rbKeyL))) * smoothstep(.03, .08, rbL);
      diffuseColor.rgb = mix(rbC, vPaint * clamp(rbL / rbKeyL, 0.0, 1.3), rbM);`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${vary}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${key ? keyed : 'diffuseColor.rgb = mix(diffuseColor.rgb, vPaint, vMask);'}`);
  };
  material.customProgramCacheKey = () => 'rb-paint-' + (key ?? 'mask');
  return material;
}

// Culprit outline: back faces pushed out along their normals, so the car keeps its own colour (the toast names it).
function outlineMaterial() {
  return new THREE.ShaderMaterial({
    // White, not amber: an amber outline would hide the very indicator the learner should have read.
    uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uStrength: { value: 1 }, uWidth: { value: 0.06 } },
    vertexShader: `
      uniform float uWidth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * uWidth * max(1.0, -mv.z / 25.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength;
      void main() { gl_FragColor = vec4(uColor, uStrength); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false,
  });
}

// Camera-facing lamp glows with a pixel-size floor: indicators must stay readable at 60 m on a phone.
function lampMesh() {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  const attr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(LAMP_CAPACITY * n), n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', attr(3));
  g.setAttribute('iCol', attr(3));
  g.setAttribute('iNrm', attr(3));
  g.setAttribute('iSize', attr(1));
  g.setAttribute('iSoft', attr(1));
  g.instanceCount = 0;
  const uniforms = { uPxWorld: { value: 0.002 }, uMinPx: { value: 11 } };
  // iCol is written out as is (no colour-space step in a ShaderMaterial), so lamps.js colours are sRGB.
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec3 iPos; attribute vec3 iCol; attribute vec3 iNrm; attribute float iSize; attribute float iSoft;
      uniform float uPxWorld; uniform float uMinPx;
      varying vec2 vUv; varying vec3 vCol; varying float vSoft; varying float vFace;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float d = max(0.1, -mv.z);
        // Pulled toward the eye so the lamp's own bodywork never clips it; other vehicles still occlude it.
        mv.xyz += normalize(-mv.xyz) * min(0.35, d * 0.5);
        // Seen from the side a lamp fades, never darkens: a darkened amber would drift toward red.
        vFace = mix(0.45, 1.0, clamp(dot(iNrm, normalize(cameraPosition - iPos)), 0.0, 1.0));
        vCol = iCol;
        vSoft = iSoft;
        mv.xy += position.xy * max(iSize, uMinPx * uPxWorld * d);
        vUv = position.xy * 2.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec3 vCol; varying float vSoft; varying float vFace;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float core = smoothstep(0.36, 0.16, r);
        float crisp = clamp(core + pow(1.0 - r, 2.6) * 0.55, 0.0, 1.0);
        float soft = pow(1.0 - r, 1.5) * 0.95;
        // Only the crisp indicator gets a hot centre; a red lamp stays red all the way in.
        vec3 c = mix(mix(vCol, vec3(1.0, 0.94, 0.8), core * 0.4), vCol, vSoft);
        gl_FragColor = vec4(c, mix(crisp, soft, vSoft) * vFace);
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, uniforms, attrs: ['iPos', 'iCol', 'iNrm', 'iSize', 'iSoft'].map((n) => g.getAttribute(n)) };
}

export function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 4, 32, 32, 31);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.55, 'rgba(0,0,0,.7)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function buildType(type, meta, base) {
  const root = await loadGlb(`${base}/assets/models/${type}.glb`);
  const m = meta[type];
  const dims = VEHICLE_TYPES[type];
  const zc = (m.z[0] + m.z[1]) / 2;
  const sz = dims.length / m.size.length;
  const bake = new THREE.Matrix4().makeScale(1, 1, sz).multiply(new THREE.Matrix4().makeTranslation(0, 0, -zc));
  const local = ([x, y, z]) => new THREE.Vector3(x, y, (z - zc) * sz);
  const cap = CAPACITY[type];

  const parts = flatten(root, { include: (o) => !isWheelNode(o), mask: (mat) => (/paint/i.test(mat.name) ? 1 : 0), matrix: bake });
  let bodyGeometry = null;
  for (const p of parts) {
    if (p.key === 'flat') p.mat = paintable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }), null);
    else if (p.key === 'glass') p.mat = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.06, metalness: 0.3 });
    else if (p.key === 'emissive') p.mat = p.material;
    else {
      p.mat = paintable(new THREE.MeshStandardMaterial({ map: p.material.map, roughness: 0.42, metalness: 0.08 }), PAINT_KEY[type]);
      bodyGeometry ??= p.geometry;
    }
  }

  // Wheels: the FL wheel serves all four (six on the lorry); right-side wheels turn it round so the hub faces out.
  const fl = m.wheels.wheel_FL;
  const wheelGeo = flatten(root, {
    include: (o) => wheelName(o) === 'wheel_FL',
    flat: true,
    colour: (mat) => (/paint|hubcap/i.test(mat.name) ? new THREE.Color(0.32, 0.34, 0.36) : mat.map ? new THREE.Color(0.03, 0.03, 0.035) : mat.color),
    matrix: new THREE.Matrix4().makeTranslation(-fl[0], -fl[1], -fl[2]),
  })[0].geometry;
  const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const wheels = Object.entries(m.wheels).map(([name, p]) => ({ pos: local(p), front: /_F/.test(name), right: /R\d?$/.test(name) }));

  // Two instance sets sharing materials: full detail, and a clustered copy for distance and mirrors.
  const makeSet = (simplify) => {
    const paint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const mk = (geometry, material, n) => {
      const im = new THREE.InstancedMesh(geometry, material, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      return im;
    };
    let tris = 0;
    const meshes = parts.map((p) => {
      const g = simplify ? cluster(p.geometry, LOD_CELL) : p.geometry;
      if (p.key !== 'glass' && p.key !== 'emissive') g.setAttribute('aPaint', paint);
      tris += triangles(g);
      return mk(g, p.mat, cap);
    });
    const wg = simplify ? cluster(wheelGeo, LOD_CELL * 0.6) : wheelGeo;
    const wheelMesh = mk(wg, wheelMat, cap * 6);
    tris += triangles(wg) * wheels.length;
    return { meshes, wheelMesh, paint, tris, count: 0, wheelCount: 0 };
  };

  const ind = m.indicators;
  // Model +X is its left, so inboard of the left lamp is -X.
  const inboard = (p, side) => local([p[0] - side * LAMP.inboard, p[1] + LAMP.raise, p[2]]);
  return {
    type, wheels, wheelRadius: m.wheelRadius, bodyGeometry, full: makeSet(false), lod: makeSet(true),
    lamps: {
      frontL: local(ind.front.L), frontR: local(ind.front.R), rearL: local(ind.rear.L), rearR: local(ind.rear.R),
      brakeL: inboard(ind.rear.L, 1), brakeR: inboard(ind.rear.R, -1),
    },
    shadow: { w: dims.width + 0.5, l: dims.length + 0.6 },
  };
}

export async function createVehicles(scene, { meta, base }) {
  const types = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t, await buildType(t, meta, base)])));
  const group = new THREE.Group();
  const sets = Object.values(types).flatMap((t) => [t.full, t.lod]);
  for (const s of sets) group.add(...s.meshes, s.wheelMesh);
  scene.add(group);

  const lamps = lampMesh();
  group.add(lamps.mesh);

  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, 160);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.count = 0;
  shadows.renderOrder = 1;
  group.add(shadows);

  const glow = new THREE.Mesh(types.hatch.bodyGeometry, outlineMaterial());
  glow.matrixAutoUpdate = false;
  glow.visible = false;
  glow.renderOrder = 4;
  group.add(glow);
  let highlightId = null;
  let highlightLamp = false;
  let tails = false;

  let ringRadius = 30;
  let ghosts = [];
  let lastCurr = null;
  const byId = new WeakMap();
  const mapOf = (snap) => {
    if (!snap) return null;
    let m = byId.get(snap);
    if (!m) byId.set(snap, (m = new Map(snap.vehicles.map((v) => [v.id, v]))));
    return m;
  };

  const M = new THREE.Matrix4();
  const W = new THREE.Matrix4();
  const R = new THREE.Matrix4();
  const S = new THREE.Matrix4();
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);
  const v3 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const colour = new THREE.Color();
  let lampN = 0;

  // kind: a LAMP entry; normalSign: +1 front-facing, -1 rear-facing.
  function lamp(p, normalSign, kind) {
    if (lampN >= LAMP_CAPACITY) return;
    v3.copy(p).applyMatrix4(M);
    nrm.set(0, 0, normalSign).transformDirection(M);
    const [pos, col, n, sz, soft] = lamps.attrs;
    const k = kind.intensity ?? 1;
    pos.setXYZ(lampN, v3.x, v3.y, v3.z);
    col.setXYZ(lampN, kind.colour[0] * k, kind.colour[1] * k, kind.colour[2] * k);
    n.setXYZ(lampN, nrm.x, nrm.y, nrm.z);
    sz.setX(lampN, kind.size);
    soft.setX(lampN, kind.soft);
    lampN++;
  }

  // One vehicle pose { v, x, z, h, s, steer }: s drives wheel spin, steer the front wheels.
  function draw({ v, x, z, h, s, steer }, allLod, view) {
    const t = types[v.type];
    if (!t) return;
    // Main view: only vehicles in the camera frustum (the instanced meshes are never culled as a whole).
    if (view) {
      sphere.center.set(x, 1.5, z);
      sphere.radius = VEHICLE_TYPES[v.type].length / 2 + 1.5;
      if (!view.intersectsSphere(sphere)) return;
    }
    const dx = x - eye.x;
    const dz = z - eye.z;
    const d = Math.hypot(dx, dz);
    // Mirror passes: a vehicle further than MIRROR_RANGE, or well ahead of the driver, is in no mirror.
    if (allLod && (d > MIRROR_RANGE || (eye.heading != null && dx * Math.sin(eye.heading) - dz * Math.cos(eye.heading) > MIRROR_AHEAD))) return;
    const set = allLod || d > LOD_DISTANCE ? t.lod : t.full;
    if (set.count >= CAPACITY[v.type]) return;
    const c = -Math.cos(h);
    const sn = Math.sin(h);
    M.set(c, 0, sn, x, 0, 1, 0, 0, -sn, 0, c, z, 0, 0, 0, 1);
    const i = set.count++;
    for (const im of set.meshes) im.setMatrixAt(i, M);
    colour.set(v.colourHex); // every VehicleView carries it (sim.js view() owns the fallback)
    set.paint.setXYZ(i, colour.r, colour.g, colour.b);
    const spin = s / t.wheelRadius;
    for (const w of t.wheels) {
      W.copy(M).multiply(R.makeTranslation(w.pos.x, w.pos.y, w.pos.z));
      if (w.front) W.multiply(R.makeRotationY(steer * STEER_GAIN));
      W.multiply(R.makeRotationX(spin));
      if (w.right) W.multiply(flip);
      set.wheelMesh.setMatrixAt(set.wheelCount++, W);
    }
    if (shadows.count < 160) {
      S.copy(M).multiply(R.makeScale(t.shadow.w, 1, t.shadow.l));
      S.elements[13] = 0.03;
      shadows.setMatrixAt(shadows.count++, S);
    }
    // While frozen on a culprit its indicator stays lit, so the cue is on screen whatever the blink phase was.
    const on = lampsFor(v, { forceOn: v.id === highlightId && highlightLamp, tails });
    // Red first: where far lamps' pixel floors overlap, the amber is drawn over it, never under.
    const red = on.brake ? LAMP.brake : on.tail ? LAMP.tail : null;
    if (red) {
      lamp(t.lamps.brakeL, -1, red);
      lamp(t.lamps.brakeR, -1, red);
    }
    if (on.indL || on.indR) {
      lamp(on.indL ? t.lamps.frontL : t.lamps.frontR, 1, LAMP.indicator);
      lamp(on.indL ? t.lamps.rearL : t.lamps.rearR, -1, LAMP.indicator);
    }
    if (v.id === highlightId && t.bodyGeometry) {
      glow.geometry = t.bodyGeometry;
      glow.matrix.copy(M);
      glow.matrixWorldNeedsUpdate = true;
      glow.visible = true;
    }
  }

  const poses = []; // pooled: update() refills the first poseN entries
  let poseN = 0;
  const eye = { x: 0, z: 0, heading: null };

  function pose(v, x, z, h, s, steer) {
    const p = poses[poseN++] ?? (poses[poseN - 1] = {});
    p.v = v; p.x = x; p.z = z; p.h = h; p.s = s; p.steer = steer;
  }

  function update(prev, curr, alpha, { showPlayer = false, dt = 0, ghosts: keepGhosts = true, statics = [], eye: at } = {}) {
    if (at) { eye.x = at.x; eye.z = at.z; eye.heading = at.heading ?? null; }
    poseN = 0;
    const prevMap = mapOf(prev);
    const currMap = mapOf(curr);

    // A vehicle the sim retires at the far end of its exit keeps driving into the fog instead of vanishing.
    if (keepGhosts && lastCurr && curr !== lastCurr) {
      for (const v of lastCurr.vehicles) {
        if (!currMap.has(v.id) && !v.isPlayer && Math.hypot(v.x, v.z) > ringRadius + 40) ghosts.push({ ...v, lamp: false, brake: false, age: 0 });
      }
    }
    lastCurr = curr;
    let kept = 0;
    for (const g of ghosts) if ((g.age += dt) < GHOST_SECONDS) ghosts[kept++] = g;
    ghosts.length = kept;
    for (const g of ghosts) {
      g.x += Math.sin(g.heading) * g.speed * dt;
      g.z -= Math.cos(g.heading) * g.speed * dt;
      g.s += g.speed * dt;
      pose(g, g.x, g.z, g.heading, g.s, 0);
    }

    if (curr) {
      for (const v of curr.vehicles) {
        if (v.isPlayer && !showPlayer) continue;
        const p = prevMap?.get(v.id) ?? v;
        const pathSwap = p.pathId !== v.pathId && Math.abs(p.s - v.s) > 5;
        const f = pathSwap ? 1 : alpha;
        pose(v, p.x + (v.x - p.x) * f, p.z + (v.z - p.z) * f, p.heading + wrapPi(v.heading - p.heading) * f,
          p.s + (v.s - p.s) * f, p.steer + (v.steer - p.steer) * f);
      }
    }
    for (const v of statics) pose(v, v.x, v.z, v.heading, 0, 0);
  }

  // Only the first `items` entries were written and are drawn, so only they are uploaded; an empty set uploads nothing.
  function upload(attr, items) {
    if (!items) return;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, items * attr.itemSize);
    attr.needsUpdate = true;
  }

  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  function commit(allLod, camera = null) {
    let view = null;
    if (camera && !allLod) {
      camera.updateWorldMatrix(true, false);
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      view = frustum.setFromProjectionMatrix(viewProj);
    }
    for (const s of sets) s.count = s.wheelCount = 0;
    shadows.count = 0;
    lampN = 0;
    glow.visible = false;
    for (let i = 0; i < poseN; i++) draw(poses[i], allLod, view);
    for (const s of sets) {
      for (const im of s.meshes) {
        im.count = s.count;
        upload(im.instanceMatrix, s.count);
      }
      s.wheelMesh.count = s.wheelCount;
      upload(s.wheelMesh.instanceMatrix, s.wheelCount);
      upload(s.paint, s.count);
    }
    upload(shadows.instanceMatrix, shadows.count);
    lamps.mesh.geometry.instanceCount = lampN;
    for (const a of lamps.attrs) upload(a, lampN);
    if (glow.visible) glow.material.uniforms.uStrength.value = 0.75 + 0.25 * Math.sin(performance.now() / 1000 * Math.PI * 2 * 0.9);
  }

  return {
    group,
    update,
    commit,
    highlight(id, { lamp = false } = {}) { highlightId = id; highlightLamp = lamp; },
    setLayout(layout) { ringRadius = layout.outerRadius; ghosts = []; lastCurr = null; },
    clearGhosts() { ghosts = []; },
    // Tail lights follow the scene's own lights (streetlights on: the dark theme).
    setTheme(palette) { shadowMat.opacity = palette.shadow; tails = palette.leds > 0; },
    lampUniforms: lamps.uniforms,
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        for (const k of ['map', 'emissiveMap']) o.material?.[k]?.dispose();
        o.material?.dispose();
        o.dispose?.();
      });
      group.removeFromParent();
    },
    triangles: Object.fromEntries(Object.values(types).map((t) => [t.type, [t.full.tris, t.lod.tris]])),
  };
}
