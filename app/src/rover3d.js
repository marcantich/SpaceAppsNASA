// 3D rover with clickable parts (three.js). Loaded on demand by rover.js, so the three.js bundle
// is only downloaded when the rover planner is opened.
//
// The model is NASA's Mars 2020 Perseverance (NASA 3D Resources, free of copyright). Its glTF nodes
// are named (Wheels_objs, rtg, turret_obj…): data/rover.json maps node names → parts, so swapping
// the model or regrouping parts needs no code change.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const BASE = `${import.meta.env.BASE_URL}data/`;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const nodeName = (o) => o.userData?.name ?? o.name; // original glTF name (three.js may rename duplicates)

/**
 * @param {HTMLElement} stage element that will hold the canvas and the part labels
 * @param {object} config data/rover.json
 * @param {{onPick: (partId: string|null) => void}} callbacks
 */
export async function createRoverView(stage, config, { onPick } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  stage.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // soft reflections for the metal
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.0);
  sun.position.set(-3, 5, 4);
  scene.add(sun, new THREE.HemisphereLight(0xdfe8ff, 0x3a2a20, 0.5));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.9;
  controls.maxPolarAngle = Math.PI * 0.53; // never look from below the ground

  const draco = new DRACOLoader().setDecoderPath(`${BASE}rover/draco/`);
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`${BASE}${config.model.file}`);
  const root = gltf.scene;
  scene.add(root);

  // --- node names → parts -------------------------------------------------------------------
  const partOfNode = new Map();
  for (const part of config.parts) for (const name of part.nodes) partOfNode.set(norm(name), part.id);
  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    let id = null;
    for (let o = obj; o && !id; o = o.parent) id = partOfNode.get(norm(nodeName(o))) ?? null;
    obj.material = obj.material.clone(); // one material per mesh: parts are tinted separately
    const m = obj.material;
    obj.userData.partId = id;
    obj.userData.base = {
      emissive: m.emissive?.clone(), emissiveIntensity: m.emissiveIntensity,
      opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite,
    };
    meshes.push(obj);
  });
  const boxes = new Map(config.parts.map((p) => [p.id, new THREE.Box3()]));
  function measureParts() {
    root.updateMatrixWorld(true);
    for (const box of boxes.values()) box.makeEmpty();
    for (const mesh of meshes) if (mesh.userData.partId) boxes.get(mesh.userData.partId).expandByObject(mesh);
  }

  // --- deployment: the model ships stowed, with NASA's own animation (mast up, arm out, and back).
  // It is played once, fast, up to `deploy_until_s` of that timeline, and the rover stays deployed.
  const mixer = new THREE.AnimationMixer(root);
  const clock = new THREE.Clock(false);
  const longest = Math.max(0, ...gltf.animations.map((c) => c.duration));
  const hold = Math.min(config.model.deploy_until_s ?? longest, longest);
  const actions = gltf.animations.map((clip) => {
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    return a.play();
  });
  /** Put the whole rover at second `t` of the timeline (reset first: finished clips are paused). */
  function poseAt(t) {
    for (const a of actions) a.reset().play();
    mixer.timeScale = 1;
    mixer.setTime(t);
  }

  // Frame the camera on the DEPLOYED rover from the start, so nothing jumps when it unfolds
  poseAt(hold);
  measureParts();
  const all = new THREE.Box3().setFromObject(root);
  const size = all.getSize(new THREE.Vector3());
  const centre = all.getCenter(new THREE.Vector3());
  poseAt(0);
  measureParts();

  // soft contact shadow under the rover
  const shade = document.createElement('canvas');
  shade.width = shade.height = 128;
  const g = shade.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(size.x, size.z) * 0.8, 48),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shade), transparent: true, depthWrite: false }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centre.x, all.min.y + 0.004, centre.z);
  scene.add(ground);

  // camera: three-quarter view from the front (+z), mast side
  const radius = size.length() / 2;
  const home = { target: centre.clone(), dist: (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.7 };
  camera.position.copy(centre).add(new THREE.Vector3(-0.62, 0.34, 0.7).normalize().multiplyScalar(home.dist));
  controls.target.copy(centre);
  controls.minDistance = radius;
  controls.maxDistance = home.dist * 1.5;
  controls.update();

  // --- labels (HTML, positioned every frame on the projected anchor of each part) ----------------
  const findNode = (name) => {
    let found = null;
    root.traverse((o) => { if (!found && norm(nodeName(o)) === norm(name)) found = o; });
    return found;
  };
  const anchors = new Map();     // part id → world position of its label
  const anchorNodes = new Map(); // part id → node the label follows while the rover unfolds
  const labels = new Map();
  const tmpBox = new THREE.Box3();
  function placeAnchors() {
    for (const [id, node] of anchorNodes) {
      tmpBox.setFromObject(node);
      tmpBox.getCenter(anchors.get(id)).y = tmpBox.max.y;
    }
  }
  for (const part of config.parts) {
    const box = boxes.get(part.id);
    if (box.isEmpty()) continue; // none of its nodes is in this model
    const p = new THREE.Vector3();
    const node = part.anchor?.node && findNode(part.anchor.node);
    if (node) {
      anchorNodes.set(part.id, node);
    } else {
      const f = part.anchor?.frac ?? [0.5, 1, 0.5];
      const s = box.getSize(new THREE.Vector3());
      p.set(box.min.x + f[0] * s.x, box.min.y + f[1] * s.y, box.min.z + f[2] * s.z);
    }
    anchors.set(part.id, p);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rover-label';
    el.dataset.part = part.id;
    el.innerHTML = `<i></i><span>${part.short ?? part.name}</span>`;
    el.title = part.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick?.(part.id);
    });
    stage.append(el);
    labels.set(part.id, el);
  }
  placeAnchors();

  let deploying = false;
  let deployed = false;
  function deploy(seconds = 4) {
    if (deployed || !hold) return;
    deployed = true;
    mixer.timeScale = hold / seconds;
    deploying = true;
    clock.start();
  }
  function endDeploy() {
    deploying = false;
    clock.stop();
    measureParts();
    placeAnchors();
  }

  // --- look of each part: status colour (emissive tint), selection, hover -----------------------
  let colors = {};     // part id → css colour of its status
  let icons = {};
  let selected = null; // part id or null = whole rover
  let hover = null;

  function apply() {
    for (const mesh of meshes) {
      const id = mesh.userData.partId;
      const mat = mesh.material;
      const base = mesh.userData.base;
      const dim = selected && id !== selected;
      const color = id && colors[id];
      if (mat.emissive) {
        if (color && !dim) {
          mat.emissive.set(color);
          mat.emissiveIntensity = id === selected ? 0.5 : id === hover ? 0.45 : 0.2;
        } else {
          mat.emissive.copy(base.emissive);
          mat.emissiveIntensity = base.emissiveIntensity;
        }
      }
      const transparent = dim ? true : base.transparent;
      if (mat.transparent !== transparent) mat.needsUpdate = true;
      mat.transparent = transparent;
      mat.opacity = dim ? 0.1 : base.opacity;
      mat.depthWrite = dim ? false : base.depthWrite;
    }
    for (const [id, el] of labels) {
      el.style.setProperty('--c', colors[id] ?? '#9aa3b8');
      el.classList.toggle('sel', id === selected);
      el.classList.toggle('dim', Boolean(selected) && id !== selected);
      el.firstChild.textContent = icons[id] ?? '';
    }
  }

  // --- picking -----------------------------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function partAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObjects(meshes, false)) {
      const id = hit.object.userData.partId;
      if (id && labels.has(id)) return id; // skips the few loose meshes that belong to no part
    }
    return null;
  }
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    controls.autoRotate = false; // the user took over
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) onPick?.(partAt(e));
    down = null;
  });
  let hoverQueued = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (down || hoverQueued) return;
    hoverQueued = requestAnimationFrame(() => {
      hoverQueued = null;
      const id = partAt(e);
      renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      if (id !== hover) {
        hover = id;
        apply();
      }
    });
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      apply();
    }
  });

  // --- render loop (only while the planner is open) ---------------------------------------------
  const goal = home.target.clone();
  const v = new THREE.Vector3();
  function tick() {
    if (deploying) {
      mixer.update(Math.min(clock.getDelta(), 0.1));
      placeAnchors();
      if (mixer.time >= hold) endDeploy();
    }
    controls.target.lerp(goal, 0.08);
    controls.update();
    renderer.render(scene, camera);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    for (const [id, el] of labels) {
      v.copy(anchors.get(id)).project(camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -130%)`;
      el.hidden = v.z > 1 || x < 0 || x > w || y < 12 || y > h;
    }
  }
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();
  apply();

  return {
    partIds: [...labels.keys()],
    /** colours = { partId: css colour }, marks = { partId: short text shown on its label } */
    setStatuses(newColors, marks = {}) {
      colors = newColors;
      icons = marks;
      apply();
    },
    /** Highlight one part (the rest fades) or null for the whole rover. */
    select(id) {
      selected = id && labels.has(id) ? id : null;
      goal.copy(selected ? boxes.get(selected).getCenter(v.clone()).lerp(home.target, 0.5) : home.target);
      if (selected) controls.autoRotate = false;
      apply();
    },
    start() {
      resize();
      renderer.setAnimationLoop(tick);
      deploy();
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
    /** For checks from the console: jump to second `t` of NASA's deployment timeline. */
    poseAt(t) {
      deployed = true;
      poseAt(Math.min(t, longest));
      endDeploy();
    },
  };
}
