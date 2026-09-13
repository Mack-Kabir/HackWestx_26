// Browser-only 3D stage. Scrolling flies the camera through four chapters; each
// transition zooms through the centre of one object and arrives at the next.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type Chapter = { code: string; title: string };

const GAP = 60;
// Page sections that start chapters 2–4; chapter 1 starts at the top of the page.
const ANCHORS = [".rep-section", "#motion-replay", ".how-section"];
const DWELL = 0.5;

type Joint = [number, number, number];
// Front-squat keyframes in figure space (x forward, y up, z lateral), roughly metres.
const STAND: Record<string, Joint> = {
  head: [0, 1.72, 0],
  neck: [0, 1.52, 0],
  pelvis: [0, 1, 0],
  shoulderL: [0, 1.45, 0.2],
  shoulderR: [0, 1.45, -0.2],
  elbowL: [0.05, 1.18, 0.24],
  elbowR: [0.05, 1.18, -0.24],
  handL: [0.12, 0.95, 0.24],
  handR: [0.12, 0.95, -0.24],
  hipL: [0, 0.98, 0.12],
  hipR: [0, 0.98, -0.12],
  kneeL: [0.02, 0.53, 0.13],
  kneeR: [0.02, 0.53, -0.13],
  ankleL: [0, 0.08, 0.13],
  ankleR: [0, 0.08, -0.13],
  toeL: [0.16, 0.02, 0.13],
  toeR: [0.16, 0.02, -0.13],
};
const SQUAT: Record<string, Joint> = {
  head: [0.08, 1.25, 0],
  neck: [0.02, 1.05, 0],
  pelvis: [-0.3, 0.55, 0],
  shoulderL: [0.02, 0.98, 0.2],
  shoulderR: [0.02, 0.98, -0.2],
  elbowL: [0.3, 0.96, 0.2],
  elbowR: [0.3, 0.96, -0.2],
  handL: [0.14, 1.02, 0.14],
  handR: [0.14, 1.02, -0.14],
  hipL: [-0.3, 0.53, 0.14],
  hipR: [-0.3, 0.53, -0.14],
  kneeL: [0.2, 0.5, 0.16],
  kneeR: [0.2, 0.5, -0.16],
  ankleL: [0, 0.08, 0.13],
  ankleR: [0, 0.08, -0.13],
  toeL: [0.16, 0.02, 0.13],
  toeR: [0.16, 0.02, -0.13],
};
const BONES: [string, string][] = [
  ["head", "neck"],
  ["neck", "pelvis"],
  ["neck", "shoulderL"],
  ["neck", "shoulderR"],
  ["shoulderL", "elbowL"],
  ["elbowL", "handL"],
  ["shoulderR", "elbowR"],
  ["elbowR", "handR"],
  ["pelvis", "hipL"],
  ["pelvis", "hipR"],
  ["hipL", "kneeL"],
  ["kneeL", "ankleL"],
  ["ankleL", "toeL"],
  ["hipR", "kneeR"],
  ["kneeR", "ankleR"],
  ["ankleR", "toeR"],
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function createStage(
  host: HTMLElement,
  rail: HTMLElement,
  cutscene: HTMLElement,
  chapters: Chapter[],
) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const compact = innerWidth < 760;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, compact ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const black = new THREE.Color("#050506");
  scene.background = black;
  scene.fog = new THREE.FogExp2(black, 0.027);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(
    compact ? 58 : 42,
    innerWidth / innerHeight,
    0.05,
    260,
  );
  const baseFov = camera.fov;

  const red = new THREE.Color("#ff2440");
  // Colours above 1 exceed the bloom threshold, so only these parts glow.
  const glow = (strength: number) =>
    new THREE.MeshBasicMaterial({ color: red.clone().multiplyScalar(strength) });
  const obsidian = new THREE.MeshPhysicalMaterial({
    color: "#0a0a0c",
    metalness: 0.92,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const satin = new THREE.MeshPhysicalMaterial({
    color: "#17131a",
    metalness: 0.7,
    roughness: 0.42,
  });
  const facet = new THREE.MeshPhysicalMaterial({
    color: "#0c0b0d",
    metalness: 1,
    roughness: 0.14,
    flatShading: true,
    clearcoat: 1,
  });
  const dummy = new THREE.Object3D();

  scene.add(new THREE.HemisphereLight("#2a0d12", "#000000", 0.35));
  const key = new THREE.DirectionalLight("#ffffff", 1.4);
  scene.add(key, key.target);
  const lamp = (x: number, y: number, z: number, intensity: number) => {
    const light = new THREE.PointLight(red, intensity, 28, 1.6);
    light.position.set(x, y, z);
    scene.add(light);
  };

  // Chapter 1 — the core: an obsidian ring around a faceted crystal.
  const core = new THREE.Group();
  scene.add(core);
  const ring = new THREE.Group();
  ring.add(
    new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.42, 48, 180), obsidian),
    new THREE.Mesh(new THREE.TorusGeometry(2.76, 0.022, 8, 240), glow(2.6)),
    new THREE.Mesh(new THREE.TorusGeometry(3.66, 0.012, 8, 240), glow(1.6)),
  );
  core.add(ring);
  const halo = new THREE.Group();
  const tickGeometry = new THREE.BoxGeometry(0.05, 0.36, 0.08);
  const tickCount = 72;
  const darkTicks = new THREE.InstancedMesh(tickGeometry, satin, tickCount);
  const redTicks = new THREE.InstancedMesh(tickGeometry, glow(3), tickCount / 8);
  for (let i = 0, lit = 0, dark = 0; i < tickCount; i++) {
    const angle = (i / tickCount) * Math.PI * 2;
    dummy.position.set(Math.cos(angle) * 4.35, Math.sin(angle) * 4.35, 0);
    dummy.rotation.set(0, 0, angle - Math.PI / 2);
    dummy.scale.set(1, i % 8 === 0 ? 1.6 : 1, 1);
    dummy.updateMatrix();
    if (i % 8 === 0) redTicks.setMatrixAt(lit++, dummy.matrix);
    else darkTicks.setMatrixAt(dark++, dummy.matrix);
  }
  darkTicks.count = tickCount - tickCount / 8;
  halo.add(darkTicks, redTicks);
  core.add(halo);
  const crystal = new THREE.Group();
  crystal.position.z = -5;
  crystal.add(
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), facet),
    new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.72, 0)),
      new THREE.LineBasicMaterial({ color: red.clone().multiplyScalar(3) }),
    ),
    new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), glow(8)),
  );
  core.add(crystal);
  const shardCount = compact ? 40 : 90;
  const shards = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.16, 0),
    facet,
    shardCount,
  );
  for (let i = 0; i < shardCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 5.5 + Math.random() * 8;
    dummy.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.7,
      -10 + Math.random() * 16,
    );
    dummy.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    dummy.scale.setScalar(0.5 + Math.random() * 1.5);
    dummy.updateMatrix();
    shards.setMatrixAt(i, dummy.matrix);
  }
  core.add(shards);
  lamp(0, 0, -3, 16);
  lamp(4, 3, 4, 14);

  // Chapter 2 — the athlete: a squatting figure on a hex floor.
  const athlete = new THREE.Group();
  athlete.position.z = -GAP;
  scene.add(athlete);
  const figureScale = 2.2;
  const figure = new THREE.Group();
  figure.scale.setScalar(figureScale);
  figure.rotation.y = 0.3;
  figure.position.y = -0.53 * figureScale;
  athlete.add(figure);
  const jointNames = Object.keys(STAND);
  const boneMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1, 12),
    obsidian,
    BONES.length,
  );
  const jointMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.038, 16, 12),
    glow(2.4),
    jointNames.length,
  );
  const knees = [0, 1].map(
    () => new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), glow(4)),
  );
  figure.add(boneMesh, jointMesh, ...knees);
  const floorMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vP;
      float hexDist(vec2 p){ p = abs(p); return max(dot(p, vec2(.5, .8660254)), p.x); }
      void main(){
        vec2 p = vP * 1.3, r = vec2(1., 1.7320508), h = r * .5;
        vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
        vec2 g = dot(a, a) < dot(b, b) ? a : b;
        float edge = .5 - hexDist(g);
        float line = 1. - smoothstep(0., fwidth(edge) * 1.5 + .012, edge);
        float d = length(vP);
        float pulse = smoothstep(.5, 0., abs(fract(d * .08 - uTime * .06) - .5) * 8.);
        vec3 tint = vec3(1., .14, .25);
        gl_FragColor = vec4(tint * line * exp(-d * .22) * (.55 + pulse * 1.4) + tint * exp(-d * .6) * .08, 1.);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.53 * figureScale;
  athlete.add(floor);
  lamp(2, 3, -GAP + 3, 50);
  lamp(-3, 1, -GAP - 2, 30);

  const joints = new Map(jointNames.map((name) => [name, new THREE.Vector3()]));
  const up = new THREE.Vector3(0, 1, 0);
  const span = new THREE.Vector3();
  function pose(depth: number) {
    jointNames.forEach((name, i) => {
      const a = STAND[name],
        b = SQUAT[name];
      const point = joints
        .get(name)!
        .set(
          a[0] + (b[0] - a[0]) * depth,
          a[1] + (b[1] - a[1]) * depth,
          a[2] + (b[2] - a[2]) * depth,
        );
      dummy.position.copy(point);
      dummy.quaternion.identity();
      dummy.scale.setScalar(name === "head" ? 2.2 : 1);
      dummy.updateMatrix();
      jointMesh.setMatrixAt(i, dummy.matrix);
    });
    BONES.forEach(([from, to], i) => {
      const a = joints.get(from)!;
      span.subVectors(joints.get(to)!, a);
      const length = span.length();
      dummy.position.copy(a).addScaledVector(span, 0.5);
      dummy.quaternion.setFromUnitVectors(up, span.normalize());
      dummy.scale.set(1, length, 1);
      dummy.updateMatrix();
      boneMesh.setMatrixAt(i, dummy.matrix);
    });
    knees[0].position.copy(joints.get("kneeL")!);
    knees[1].position.copy(joints.get("kneeR")!);
    jointMesh.instanceMatrix.needsUpdate = true;
    boneMesh.instanceMatrix.needsUpdate = true;
  }

  // Chapter 3 — the measurement: layered dials the camera passes through.
  const dials = new THREE.Group();
  dials.position.z = -2 * GAP;
  scene.add(dials);
  const dialRings = [1.15, 1.8, 2.55, 3.35, 4.2].map((radius, i) => {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.TorusGeometry(radius, i % 2 ? 0.03 : 0.055, 12, 200),
        obsidian,
      ),
    );
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.022, 8, 160, Math.PI * (0.35 + i * 0.12)),
      glow(4.4 - i * 0.5),
    );
    arc.position.z = 0.02;
    group.add(arc);
    const count = Math.round(radius * 26);
    const ticks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.02, i % 2 ? 0.12 : 0.22, 0.02),
      satin,
      count,
    );
    for (let j = 0; j < count; j++) {
      const angle = (j / count) * Math.PI * 2;
      dummy.position.set(
        Math.cos(angle) * (radius + 0.14),
        Math.sin(angle) * (radius + 0.14),
        0,
      );
      dummy.rotation.set(0, 0, angle - Math.PI / 2);
      dummy.scale.set(1, j % 5 === 0 ? 1.8 : 1, 1);
      dummy.updateMatrix();
      ticks.setMatrixAt(j, dummy.matrix);
    }
    group.add(ticks);
    group.position.z = -i * 0.6;
    dials.add(group);
    return group;
  });
  dials.add(new THREE.Mesh(new THREE.RingGeometry(0.28, 0.3, 64), glow(5)));
  lamp(0, 2, -2 * GAP + 4, 45);
  lamp(-3, -2, -2 * GAP, 20);

  // Chapter 4 — the proof: linked blocks.
  const chain = new THREE.Group();
  chain.position.z = -3 * GAP;
  scene.add(chain);
  const blockGeometry = new RoundedBoxGeometry(1.5, 1.5, 1.5, 4, 0.14);
  const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.54, 1.54, 1.54));
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: red.clone().multiplyScalar(2.6),
  });
  const linkGeometry = new THREE.TorusGeometry(0.36, 0.06, 12, 48);
  const blocks: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const block = new THREE.Group();
    block.add(
      new THREE.Mesh(blockGeometry, obsidian),
      new THREE.LineSegments(edgeGeometry, edgeMaterial),
    );
    block.position.set((i - 2.5) * 2.25, Math.sin(i * 1.1) * 0.55, -Math.abs(i - 2.5) * 0.9);
    block.rotation.set(0.35 + i * 0.2, 0.6 - i * 0.25, 0);
    chain.add(block);
    if (i > 0) {
      const link = new THREE.Mesh(linkGeometry, glow(2.4));
      link.position.lerpVectors(blocks[i - 1].position, block.position, 0.5);
      link.rotation.set(i % 2 ? Math.PI / 2 : 0, 0.4, 0);
      chain.add(link);
    }
    blocks.push(block);
  }
  lamp(0, 3, -3 * GAP + 5, 50);
  lamp(-4, -1, -3 * GAP + 2, 25);

  // Speed streaks (visible only while travelling) and drifting dust.
  const streakCount = compact ? 140 : 320;
  const streakMaterial = new THREE.MeshBasicMaterial({
    color: red.clone().multiplyScalar(2.5),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const streaks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.018, 0.018, 1),
    streakMaterial,
    streakCount,
  );
  streaks.frustumCulled = false;
  scene.add(streaks);
  const streakData = Array.from({ length: streakCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 1.8 + Math.random() * 7,
    z: 12 - Math.random() * (3 * GAP + 30),
    length: 1.5 + Math.random() * 4,
  }));
  const dustCount = compact ? 900 : 2200;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions.set(
      [
        (Math.random() - 0.5) * 28,
        (Math.random() - 0.5) * 18,
        14 - Math.random() * (3 * GAP + 34),
      ],
      i * 3,
    );
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  scene.add(
    new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: "#ff5566",
        size: 0.045,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth / 2, innerHeight / 2),
    0.6,
    0.45,
    0.9,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Camera choreography: each chapter has a dwell move, then a flight through its portal.
  type Pose = { pos: THREE.Vector3; look: THREE.Vector3 };
  const at = (k: number, x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z - k * GAP);
  const dwell: [Pose, Pose][] = [
    [
      { pos: at(0, 0, 0.3, 12), look: at(0, 0, 0, 0) },
      { pos: at(0, 1.4, 0.5, 8.5), look: at(0, 0, 0, -3) },
    ],
    [
      { pos: at(1, 5.2, 1.8, 8), look: at(1, 0, 0.3, 0) },
      { pos: at(1, 3.4, 0.6, 4.6), look: at(1, 0, 0, 0) },
    ],
    [
      { pos: at(2, 0, 0, 11), look: at(2, 0, 0, 0) },
      { pos: at(2, -1.2, 0.8, 7.2), look: at(2, 0, 0, -1) },
    ],
    [
      { pos: at(3, 0, 1.4, 13), look: at(3, 0, 0, 0) },
      { pos: at(3, -1.2, 2, 10.5), look: at(3, 0, 0, 0) },
    ],
  ];
  function frameHero() {
    const wide = camera.aspect > 1.15;
    const x = wide ? -3.4 : 0,
      y = wide ? 0 : 2.6;
    dwell[0][0].pos.set(x, 0.3 + y, 12);
    dwell[0][0].look.set(x, y, 0);
    dwell[0][1].pos.set(x * 0.4 + 1.4, 0.5 + y * 0.5, 8.5);
    dwell[0][1].look.set(x * 0.3, y * 0.4, -3);
  }
  frameHero();
  const kneeWorld = new THREE.Vector3();
  const portals = [at(0, 0, 0, -5), kneeWorld, at(2, 0, 0, -2.4)];
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  let cut = 0,
    cutChapter = 1,
    roll = 0,
    warp = 0;

  function solveCamera(k: number, t: number) {
    const [start, end] = dwell[k];
    cut = roll = warp = 0;
    if (k === 3 || t <= DWELL) {
      const d = easeInOutCubic(k === 3 ? t : t / DWELL);
      camPos.lerpVectors(start.pos, end.pos, d);
      camLook.lerpVectors(start.look, end.look, d);
      return k;
    }
    // Constant speed along dwell end → portal → next chapter keeps the flight seamless.
    const u = easeInOutCubic((t - DWELL) / (1 - DWELL));
    const gate = portals[k],
      next = dwell[k + 1][0];
    const d1 = end.pos.distanceTo(gate),
      d2 = gate.distanceTo(next.pos);
    const pathAt = (distance: number, out: THREE.Vector3) => {
      const q = Math.min(d1 + d2, distance);
      return q < d1
        ? out.lerpVectors(end.pos, gate, q / d1)
        : out.lerpVectors(gate, next.pos, (q - d1) / d2);
    };
    pathAt(u * (d1 + d2), camPos);
    pathAt(u * (d1 + d2) + 6, ahead);
    camLook.lerpVectors(end.look, ahead, smooth(0, 0.25, u));
    camLook.lerp(next.look, smooth(0.7, 1, u));
    cut = smooth(0.3, 0.5, u) * (1 - smooth(0.62, 0.86, u));
    cutChapter = k + 1;
    roll = Math.sin(u * Math.PI) * 0.14 * (k % 2 ? -1 : 1);
    warp = Math.sin(u * Math.PI);
    return u > 0.55 ? k + 1 : k;
  }

  let anchors = [0, 1, 2, 3, 4];
  function measure() {
    const max = Math.max(4, document.documentElement.scrollHeight - innerHeight);
    const next = [0];
    ANCHORS.forEach((selector, i) => {
      const element = document.querySelector<HTMLElement>(selector);
      const previous = next[next.length - 1];
      let top = 0;
      for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null)
        top += node.offsetTop;
      const y = element ? top - innerHeight * 0.55 : (max * (i + 1)) / 4;
      next.push(Math.min(max - (3 - i), Math.max(previous + 1, y)));
    });
    next.push(Math.max(next[3] + 1, max));
    anchors = next;
  }
  function progressAt(y: number) {
    for (let i = 0; i < 4; i++) {
      if (y >= anchors[i + 1]) continue;
      const from = anchors[i],
        to = anchors[i + 1];
      if (i === 3) return 3 + clamp01((y - from) / (to - from));
      // The flight uses a fixed stretch of scroll just before the next section arrives,
      // so long sections stay in their calm dwell while they are being read.
      const flight = Math.min(innerHeight * 0.9, (to - from) * 0.5);
      const takeoff = to - flight;
      return y < takeoff
        ? i + DWELL * clamp01((y - from) / (takeoff - from))
        : i + DWELL + (1 - DWELL) * clamp01((y - takeoff) / flight);
    }
    return 4;
  }

  const ticks = Array.from(rail.children) as HTMLElement[];
  const cutCode = cutscene.querySelector<HTMLElement>(".cutscene-code");
  const cutTitle = cutscene.querySelector<HTMLElement>(".cutscene-title");
  const pointer = new THREE.Vector2();
  const easedPointer = new THREE.Vector2();
  const offset = new THREE.Vector3();
  const previousCam = new THREE.Vector3();
  measure();
  let smoothed = progressAt(scrollY);
  let speed = 0,
    time = 0,
    last = performance.now(),
    raf = 0,
    activeChapter = -1,
    shownCut = -1,
    shownCutValue = "";

  function render(dt: number) {
    const k = Math.min(3, Math.floor(smoothed));
    const t = k === 3 ? clamp01(smoothed - 3) : smoothed - k;
    // The athlete performs two reps while its chapter is on screen.
    pose(k === 1 && t <= DWELL ? 0.5 - 0.5 * Math.cos((t / DWELL) * Math.PI * 4) : 0);
    athlete.updateMatrixWorld(true);
    knees[0].getWorldPosition(kneeWorld);
    const chapter = solveCamera(k, t);

    easedPointer.lerp(pointer, 1 - Math.exp(-dt * 3));
    camera.position.copy(camPos).add(offset.set(easedPointer.x * 0.35, -easedPointer.y * 0.25, 0));
    camera.lookAt(camLook);
    camera.rotateZ(roll);
    camera.fov = baseFov + warp * 12;
    camera.updateProjectionMatrix();
    key.position.copy(camera.position).add(offset.set(-6, 10, 8));
    key.target.position.copy(camera.position).add(offset.set(0, -2, -12));

    const moved = dt > 0 ? previousCam.distanceTo(camPos) / dt : 0;
    previousCam.copy(camPos);
    speed += (Math.min(2, moved / 30) - speed) * (1 - Math.exp(-dt * 6));
    const streakStrength = reduceMotion ? 0 : speed;
    streakMaterial.opacity = Math.min(0.9, streakStrength * 0.9);
    streaks.visible = streakMaterial.opacity > 0.01;
    if (streaks.visible) {
      streakData.forEach((streak, i) => {
        dummy.position.set(
          Math.cos(streak.angle) * streak.radius,
          Math.sin(streak.angle) * streak.radius,
          streak.z,
        );
        dummy.quaternion.identity();
        dummy.scale.set(1, 1, streak.length * (0.4 + Math.min(streakStrength, 2) * 1.6));
        dummy.updateMatrix();
        streaks.setMatrixAt(i, dummy.matrix);
      });
      streaks.instanceMatrix.needsUpdate = true;
    }

    ring.rotation.z = time * 0.05 + smoothed * 0.6;
    halo.rotation.z = -time * 0.08 - smoothed;
    crystal.rotation.set(time * 0.3, time * 0.4, 0);
    shards.rotation.y = time * 0.02;
    dialRings.forEach((group, i) => {
      group.rotation.z = (i % 2 ? -1 : 1) * (smoothed * (0.8 + i * 0.35) + time * 0.04);
    });
    chain.rotation.y = Math.sin(time * 0.25) * 0.08 + clamp01(smoothed - 3) * 0.18;
    blocks.forEach((block, i) => {
      block.rotation.y = 0.6 - i * 0.25 + time * 0.1 * (i % 2 ? 1 : -1);
    });
    floorMaterial.uniforms.uTime.value = time;
    bloom.strength = 0.6 + warp * 0.7;
    composer.render(dt);

    rail.style.setProperty("--progress", (Math.min(3, smoothed) / 3).toFixed(4));
    if (chapter !== activeChapter) {
      activeChapter = chapter;
      ticks.forEach((tick, i) => tick.classList.toggle("is-active", i === chapter));
    }
    const cutValue = (reduceMotion ? 0 : cut).toFixed(3);
    if (cutValue !== shownCutValue) {
      shownCutValue = cutValue;
      cutscene.style.setProperty("--cut", cutValue);
    }
    if (cutChapter !== shownCut && cutCode && cutTitle) {
      shownCut = cutChapter;
      cutCode.textContent = "Chapter " + chapters[cutChapter].code;
      cutTitle.textContent = chapters[cutChapter].title;
    }
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    // Critically damped follow: the camera glides after the scroll position.
    smoothed += (progressAt(scrollY) - smoothed) * (1 - Math.exp(-dt * 4.2));
    render(dt);
    raf = requestAnimationFrame(frame);
  }
  function renderStill() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      smoothed = progressAt(scrollY);
      render(0);
    });
  }
  function start() {
    cancelAnimationFrame(raf);
    last = performance.now();
    if (reduceMotion) renderStill();
    else raf = requestAnimationFrame(frame);
  }
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    frameHero();
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    measure();
    if (reduceMotion) renderStill();
  }
  function visibility() {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  }
  function move(event: PointerEvent) {
    pointer.set(event.clientX / innerWidth - 0.5, event.clientY / innerHeight - 0.5);
  }
  const observer = new ResizeObserver(() => measure());
  observer.observe(document.body);

  addEventListener("resize", resize);
  addEventListener("pointermove", move, { passive: true });
  document.addEventListener("visibilitychange", visibility);
  if (reduceMotion) addEventListener("scroll", renderStill, { passive: true });
  start();

  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    removeEventListener("resize", resize);
    removeEventListener("pointermove", move);
    removeEventListener("scroll", renderStill);
    document.removeEventListener("visibilitychange", visibility);
    scene.traverse((object) => {
      const item = object as Partial<THREE.Mesh>;
      item.geometry?.dispose();
      const material = item.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    room.dispose();
    environment.dispose();
    pmrem.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    rail.style.removeProperty("--progress");
    cutscene.style.removeProperty("--cut");
  };
}
