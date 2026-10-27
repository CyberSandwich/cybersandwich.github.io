/**
 * Traffic rendering: sim snapshots -> instanced vehicles, wheels, lamps and blob shadows.
 *
 *   const vehicles = await createVehicles(scene, { meta, base })
 *   vehicles.update(prev, curr, alpha, { showPlayer, dt, ghosts, statics })  interpolated draw of two snapshots
 *   vehicles.highlight(id | null)    rim glow on one vehicle (the freeze culprit)
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
import { loadGlb, flatten, triangles } from './gltf.js';
import { VEHICLE_TYPES, COLOURS } from './traffic-data.js';
import { wrapPi } from './geom.js';

export const TYPES = ['hatch', 'estate', 'van', 'bus', 'lorry'];
const CAPACITY = { hatch: 40, estate: 24, van: 20, bus: 4, lorry: 8 };
// Dominant body colour of each model's texture atlas (sRGB); texels near it are repainted.
const PAINT_KEY = { hatch: '#8ECFB3', estate: '#9CCFBD', van: '#F1B18C', bus: '#7AB4E3', lorry: '#D69F96' };
// Road-wheel angles at roundabout radii are 5-10 deg; a little gain keeps the cue the trainer teaches readable on a phone.
const STEER_GAIN = 1.5;
const GHOST_SECONDS = 6;
const LAMP_CAPACITY = 640;
const AMBER = new THREE.Vector3(1.0, 0.6, 0.08);
const RED = new THREE.Vector3(1.0, 0.1, 0.06);

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

function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ffd27a') }, uStrength: { value: 0.8 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        gl_FragColor = vec4(uColor, (0.18 + 0.82 * f) * uStrength);
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    toneMapped: false,
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
  g.instanceCount = 0;
  const uniforms = { uPxWorld: { value: 0.002 }, uMinPx: { value: 11 } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec3 iPos; attribute vec3 iCol; attribute vec3 iNrm; attribute float iSize;
      uniform float uPxWorld; uniform float uMinPx;
      varying vec2 vUv; varying vec3 vCol;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float d = max(0.1, -mv.z);
        // Pulled toward the eye so the lamp's own bodywork never clips it; other vehicles still occlude it.
        mv.xyz += normalize(-mv.xyz) * min(0.35, d * 0.5);
        float face = clamp(dot(iNrm, normalize(cameraPosition - iPos)), 0.0, 1.0);
        vCol = iCol * mix(0.5, 1.0, face);
        mv.xy += position.xy * max(iSize, uMinPx * uPxWorld * d);
        vUv = position.xy * 2.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec3 vCol;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float core = smoothstep(0.36, 0.16, r);
        float a = clamp(core + pow(1.0 - r, 2.6) * 0.55, 0.0, 1.0);
        gl_FragColor = vec4(mix(vCol, vec3(1.0, 0.94, 0.8), core * 0.4), a);
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, uniforms, attrs: ['iPos', 'iCol', 'iNrm', 'iSize'].map((n) => g.getAttribute(n)) };
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
  const paint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);

  const parts = flatten(root, { include: (o) => !isWheelNode(o), mask: (mat) => (/paint/i.test(mat.name) ? 1 : 0), matrix: bake });
  const meshes = [];
  let bodyGeometry = null;
  let tris = 0;
  for (const p of parts) {
    let material;
    if (p.key === 'flat') material = paintable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }), null);
    else if (p.key === 'glass') material = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.06, metalness: 0.3 });
    else if (p.key === 'emissive') material = p.material;
    else {
      material = paintable(new THREE.MeshStandardMaterial({ map: p.material.map, roughness: 0.42, metalness: 0.08 }), PAINT_KEY[type]);
      bodyGeometry ??= p.geometry;
    }
    if (p.key !== 'glass' && p.key !== 'emissive') p.geometry.setAttribute('aPaint', paint);
    const im = new THREE.InstancedMesh(p.geometry, material, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.count = 0;
    meshes.push(im);
    tris += triangles(p.geometry);
  }

  // Wheels: the FL wheel serves all four (six on the lorry); right-side wheels turn it round so the hub faces out.
  const fl = m.wheels.wheel_FL;
  const wheelGeo = flatten(root, {
    include: (o) => wheelName(o) === 'wheel_FL',
    flat: true,
    colour: (mat) => (/paint|hubcap/i.test(mat.name) ? new THREE.Color(0.32, 0.34, 0.36) : mat.map ? new THREE.Color(0.03, 0.03, 0.035) : mat.color),
    matrix: new THREE.Matrix4().makeTranslation(-fl[0], -fl[1], -fl[2]),
  })[0].geometry;
  const wheelMesh = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), cap * 6);
  wheelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wheelMesh.frustumCulled = false;
  wheelMesh.count = 0;
  meshes.push(wheelMesh);
  const wheels = Object.entries(m.wheels).map(([name, p]) => ({ pos: local(p), front: /_F/.test(name), right: /R\d?$/.test(name) }));
  tris += triangles(wheelGeo) * wheels.length;

  const ind = m.indicators;
  const inward = (p, side) => local([p[0] - side * 0.16, p[1] - 0.02, p[2]]);
  return {
    type, meshes, wheelMesh, wheels, wheelRadius: m.wheelRadius, paint, bodyGeometry, tris, count: 0, wheelCount: 0,
    lamps: {
      frontL: local(ind.front.L), frontR: local(ind.front.R), rearL: local(ind.rear.L), rearR: local(ind.rear.R),
      brakeL: inward(ind.rear.L, 1), brakeR: inward(ind.rear.R, -1),
    },
    shadow: { w: dims.width + 0.5, l: dims.length + 0.6 },
  };
}

export async function createVehicles(scene, { meta, base }) {
  const types = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t, await buildType(t, meta, base)])));
  const group = new THREE.Group();
  for (const t of Object.values(types)) for (const im of t.meshes) group.add(im);
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

  const glow = new THREE.Mesh(types.hatch.bodyGeometry, glowMaterial());
  glow.matrixAutoUpdate = false;
  glow.visible = false;
  glow.renderOrder = 4;
  group.add(glow);
  let highlightId = null;

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

  function lamp(p, normalSign, rgb, intensity, size) {
    if (lampN >= LAMP_CAPACITY) return;
    v3.copy(p).applyMatrix4(M);
    nrm.set(0, 0, normalSign).transformDirection(M);
    const [pos, col, n, sz] = lamps.attrs;
    pos.setXYZ(lampN, v3.x, v3.y, v3.z);
    col.setXYZ(lampN, rgb.x * intensity, rgb.y * intensity, rgb.z * intensity);
    n.setXYZ(lampN, nrm.x, nrm.y, nrm.z);
    sz.setX(lampN, size);
    lampN++;
  }

  // One vehicle at (x, z) facing heading h; s drives wheel spin, steer the front wheels.
  function draw(v, x, z, h, s, steer) {
    const t = types[v.type];
    if (!t || t.count >= CAPACITY[v.type]) return;
    const c = -Math.cos(h);
    const sn = Math.sin(h);
    M.set(c, 0, sn, x, 0, 1, 0, 0, -sn, 0, c, z, 0, 0, 0, 1);
    const i = t.count++;
    for (const im of t.meshes) if (im !== t.wheelMesh) im.setMatrixAt(i, M);
    colour.set(v.colourHex ?? COLOURS[v.colour] ?? '#888888');
    t.paint.setXYZ(i, colour.r, colour.g, colour.b);
    const spin = s / t.wheelRadius;
    for (const w of t.wheels) {
      W.copy(M).multiply(R.makeTranslation(w.pos.x, w.pos.y, w.pos.z));
      if (w.front) W.multiply(R.makeRotationY(steer * STEER_GAIN));
      W.multiply(R.makeRotationX(spin));
      if (w.right) W.multiply(flip);
      t.wheelMesh.setMatrixAt(t.wheelCount++, W);
    }
    if (shadows.count < 160) {
      S.copy(M).multiply(R.makeScale(t.shadow.w, 1, t.shadow.l));
      S.elements[13] = 0.03;
      shadows.setMatrixAt(shadows.count++, S);
    }
    if (v.lamp && v.indicator) {
      const L = v.indicator === 'left';
      lamp(L ? t.lamps.frontL : t.lamps.frontR, 1, AMBER, 1, 0.75);
      lamp(L ? t.lamps.rearL : t.lamps.rearR, -1, AMBER, 1, 0.75);
    }
    if (v.brake) {
      lamp(t.lamps.brakeL, -1, RED, 0.9, 0.6);
      lamp(t.lamps.brakeR, -1, RED, 0.9, 0.6);
    }
    if (v.id === highlightId && t.bodyGeometry) {
      glow.geometry = t.bodyGeometry;
      glow.matrix.copy(M);
      glow.matrixWorldNeedsUpdate = true;
      glow.visible = true;
    }
  }

  function update(prev, curr, alpha, { showPlayer = false, dt = 0, ghosts: keepGhosts = true, statics = [] } = {}) {
    for (const t of Object.values(types)) t.count = t.wheelCount = 0;
    shadows.count = 0;
    lampN = 0;
    glow.visible = false;
    const prevMap = mapOf(prev);
    const currMap = mapOf(curr);

    // A vehicle the sim retires at the far end of its exit keeps driving into the fog instead of vanishing.
    if (keepGhosts && lastCurr && curr !== lastCurr) {
      for (const v of lastCurr.vehicles) {
        if (!currMap.has(v.id) && !v.isPlayer && Math.hypot(v.x, v.z) > ringRadius + 40) ghosts.push({ ...v, lamp: false, brake: false, age: 0 });
      }
    }
    lastCurr = curr;
    ghosts = ghosts.filter((g) => (g.age += dt) < GHOST_SECONDS);
    for (const g of ghosts) {
      g.x += Math.sin(g.heading) * g.speed * dt;
      g.z -= Math.cos(g.heading) * g.speed * dt;
      g.s += g.speed * dt;
      draw(g, g.x, g.z, g.heading, g.s, 0);
    }

    if (curr) {
      for (const v of curr.vehicles) {
        if (v.isPlayer && !showPlayer) continue;
        const p = prevMap?.get(v.id) ?? v;
        const pathSwap = p.pathId !== v.pathId && Math.abs(p.s - v.s) > 5;
        const f = pathSwap ? 1 : alpha;
        draw(v, p.x + (v.x - p.x) * f, p.z + (v.z - p.z) * f, p.heading + wrapPi(v.heading - p.heading) * f,
          p.s + (v.s - p.s) * f, p.steer + (v.steer - p.steer) * f);
      }
    }
    for (const v of statics) draw(v, v.x, v.z, v.heading, 0, 0);

    for (const t of Object.values(types)) {
      for (const im of t.meshes) {
        im.count = im === t.wheelMesh ? t.wheelCount : t.count;
        im.instanceMatrix.needsUpdate = true;
      }
      t.paint.needsUpdate = true;
    }
    shadows.instanceMatrix.needsUpdate = true;
    lamps.mesh.geometry.instanceCount = lampN;
    for (const a of lamps.attrs) a.needsUpdate = true;
    if (glow.visible) glow.material.uniforms.uStrength.value = 0.62 + 0.25 * Math.sin(performance.now() / 1000 * Math.PI * 2 * 0.9);
  }

  return {
    group,
    update,
    highlight(id) { highlightId = id; },
    setLayout(layout) { ringRadius = layout.outerRadius; ghosts = []; lastCurr = null; },
    clearGhosts() { ghosts = []; },
    setTheme(palette) { shadowMat.opacity = palette.shadow; },
    lampUniforms: lamps.uniforms,
    triangles: Object.fromEntries(Object.values(types).map((t) => [t.type, t.tris])),
  };
}
