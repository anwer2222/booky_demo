"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { books, isLocked, type BookManifest } from "@/data/books";
import { LEAVES, type ReaderAction, type ReaderState } from "@/lib/reader";
import { playBoing, playChime } from "@/lib/sound";
import { haloTexture, hopHeight, Sparkles, stepSquash, type Squash } from "@/lib/toyFx";
import { blankPage, buildBook, poseBook, setEndpapers, COVER_T, PAGE_H, PAGE_W } from "@/lib/bookRig";

const MODEL = "/models/story_room.glb";
const DRACO = "/draco/";

// Book size from the Blender file (metres). See assets/README.md.
const OVERHANG = 0.004;
const BOOK_T = 2 * COVER_T + 0.008;
const TURN_SECONDS = 0.9;
const MOVE_SECONDS = 1.4;
const TOY_KINDS = ["Globe", "Sailboat", "House", "Train", "Rocket"];
const TOY = /^Toy_([A-Za-z]+)(_\d+)?$/; // Toy_Rocket, Toy_Rocket_2, …
const X_AXIS = new THREE.Vector3(1, 0, 0);
const SHELF_W = 2.0; // shelf length in the model (metres)

export type PanState = { x: number; max: number; metresPerPx: number; init: boolean };

type Props = {
  state: ReaderState;
  dispatch: Dispatch<ReaderAction>;
  manifest: BookManifest | null;
  muted: boolean;
  reducedMotion: boolean;
  onLocked: (title: string) => void;
  pan: MutableRefObject<PanState>;
};

type Rig = ReturnType<typeof buildRig>;

function buildRig(scene: THREE.Object3D) {
  scene.updateMatrixWorld(true);
  const get = (name: string) => {
    const o = scene.getObjectByName(name);
    if (!o) throw new Error(`model is missing node ${name}`);
    return o;
  };

  const book = get("Book");
  const tableMatrix = book.matrixWorld.clone();
  scene.attach(book); // book now moves in world space (the scene root has no transform)

  const parts = buildBook(book);

  // Shadows: everything casts and receives, except the room shell, which only receives.
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.receiveShadow = true;
    mesh.castShadow = !/^Room_/.test(mesh.name);
  });

  const slots = [1, 2, 3, 4, 5].map((i) => get(`Book_Slot_${i}`));
  const slotBase = slots.map((o) => ({ p: o.position.clone(), q: o.quaternion.clone(), hover: 0 }));

  // Toys, including copies (Toy_House_2 …). Each gets its own materials so it can glow alone.
  const halo = haloTexture();
  const toyRoots: THREE.Object3D[] = [];
  scene.traverse((o) => { if (TOY.test(o.name) && !TOY.test(o.parent?.name ?? "")) toyRoots.push(o); });
  const toys = toyRoots.map((o) => {
    const mats: THREE.MeshStandardMaterial[] = [];
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clone = (m: THREE.Material) => {
        const n = m.clone();
        if (n instanceof THREE.MeshStandardMaterial) {
          n.emissive.set("#ffc766");
          n.emissiveIntensity = 0;
          mats.push(n);
        }
        return n;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    const box = new THREE.Box3().setFromObject(o);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    glowSprite.position.set(center.x, center.y, box.min.z); // behind the toy, against the wall
    glowSprite.visible = false;
    scene.add(glowSprite);
    return {
      o, mats, center, size, halo: glowSprite,
      kind: Math.max(0, TOY_KINDS.indexOf(TOY.exec(o.name)![1])),
      base: { rotY: o.rotation.y, scale: o.scale.clone(), y: o.position.y },
      spin: 0, target: 0, glow: 0, hover: 0,
      sq: { x: 0, v: 0, hop: -1 } as Squash,
    };
  });
  const sparkles = new Sparkles();
  scene.add(sparkles.group);

  // The table book, standing upright in slot 1 with its front cover facing the room. Read from the
  // slot's current transform, so a book that is leaning out under the pointer leaves from there.
  const onShelf = new THREE.Matrix4()
    .makeTranslation((PAGE_W + OVERHANG) / 2, PAGE_H / 2 + OVERHANG, -BOOK_T / 2)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const pose = (m: THREE.Matrix4) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    return { p, q };
  };
  const shelfPose = () => {
    slots[0].updateMatrixWorld(true);
    return pose(slots[0].matrixWorld.clone().multiply(onShelf));
  };

  const spot = new THREE.Vector3();
  get("Table_ReadSpot").getWorldPosition(spot);
  const slotPos = slots.map((s) => s.getWorldPosition(new THREE.Vector3()));

  book.visible = false;
  return {
    root: scene, book, parts, slots, slotBase, slotPos, toys, sparkles, spot, shelfPose,
    start: shelfPose(), end: pose(tableMatrix),
  };
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

function fitDistance(w: number, h: number, vfovDeg: number, aspect: number) {
  const t = Math.tan(THREE.MathUtils.degToRad(vfovDeg) / 2);
  return Math.max(h / 2 / t, w / 2 / (t * aspect));
}

/** Camera looking at target from the front, raised by `rise` (0 = level), at distance dist. */
function orbit(target: THREE.Vector3, rise: number, dist: number) {
  const dir = new THREE.Vector3(0, rise, 1).normalize();
  return lookPose(target.clone().addScaledVector(dir, dist), target, THREE.Object3D.DEFAULT_UP);
}

function lookPose(eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3) {
  const m = new THREE.Matrix4().lookAt(eye, target, up);
  return { p: eye, q: new THREE.Quaternion().setFromRotationMatrix(m) };
}

/** Which named node (slot, toy or the book) a clicked mesh belongs to. */
function owner(o: THREE.Object3D | null): string | null {
  for (; o; o = o.parent) {
    if (/^(Book_Slot_\d|Book)$/.test(o.name) || TOY.test(o.name)) return o.name;
  }
  return null;
}

/** The nearest hit that is actually drawn: the raycaster also hits hidden objects, such as the
 * table book while it waits, invisible, in front of the shelf copy in slot 1. */
function firstShown(e: ThreeEvent<PointerEvent | MouseEvent>) {
  return e.intersections.find((h) => {
    for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (!o.visible) return false;
    return true;
  });
}

export default function RoomScene({ state, dispatch, manifest, muted, reducedMotion, onLocked, pan }: Props) {
  const { scene: cached } = useGLTF(MODEL, DRACO);
  // Build on a fresh copy each time: the loader caches one scene, and React runs memos twice in development.
  const rig: Rig = useMemo(() => buildRig(cached.clone(true)), [cached]);
  const scene = rig.root;
  const shaped = useMemo(() => new Float32Array(LEAVES).fill(-1), [rig]);
  const { camera, size } = useThree();

  // animation progress, 0..1 per item: [cover, leaf1..leaf13]
  const turnU = useRef<number[]>(new Array(LEAVES + 1).fill(0));
  const moveU = useRef(0);
  const settledSent = useRef(true);
  const snapped = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hovered = useRef<string | null>(null);

  // Mouse position for the shelf camera (desktop only): x for a little parallax, and "peek" when
  // the pointer sits near the bottom of the screen, to look down at the reading table.
  const peek = useRef(0);
  const mouse = useRef({ x: 0, peek: 0 });
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const onMove = (e: PointerEvent) => {
      const y = e.clientY / window.innerHeight;
      mouse.current.x = e.clientX / window.innerWidth - 0.5;
      mouse.current.peek = THREE.MathUtils.smoothstep(y, 0.75, 0.95);
    };
    const onLeave = () => { mouse.current.x = 0; mouse.current.peek = 0; };
    window.addEventListener("pointermove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => { window.removeEventListener("pointermove", onMove); document.removeEventListener("mouseleave", onLeave); };
  }, []);
  const [hoverSlot, setHoverSlot] = useState<string | null>(null); // a book shows its label on hover

  // the book leaves from (and returns to) wherever the shelf copy stands right now
  useEffect(() => {
    if (state.mode === "toTable" || state.mode === "toShelf") rig.start = rig.shelfPose();
  }, [state.mode, rig]);

  // ---- page textures: only the spreads around the open one are kept in memory ----
  const textures = useRef(new Map<number, THREE.Texture>());
  useEffect(() => {
    if (!manifest || state.mode === "shelf") return;
    const t = state.turned;
    const wanted = new Set<number>();
    for (let k = Math.max(1, t - 2); k <= Math.min(LEAVES, t + 2); k++) wanted.add(2 * k + 1).add(2 * k + 2);
    const base = books.find((b) => b.id === manifest.id)?.basePath ?? "";
    const loader = new THREE.TextureLoader();

    rig.parts.leaves.forEach(({ front, back }, i) => {
      const k = i + 1;
      ([[front.material, 2 * k + 1], [back.material, 2 * k + 2]] as const).forEach(([mat, page]) => {
        if (!wanted.has(page)) return blankPage(mat, rig.parts.paper);
        const apply = (tex: THREE.Texture) => {
          mat.map = tex; mat.needsUpdate = true;
        };
        const cached = textures.current.get(page);
        if (cached) return apply(cached);
        const src = manifest.pages[page - 1]?.src;
        if (!src) return;
        const tex = loader.load(`${base}/${src}`, () => {
          if (textures.current.get(page) === tex) apply(tex);
        });
        tex.flipY = false; // glTF UV convention
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        textures.current.set(page, tex);
      });
    });
    for (const [page, tex] of textures.current) {
      if (!wanted.has(page)) { tex.dispose(); textures.current.delete(page); }
    }
  }, [manifest, state.turned, state.mode, rig]);

  useEffect(() => () => textures.current.forEach((t) => t.dispose()), []);

  // endpapers (PDF pages 2 and 29) stay loaded while the book is off the shelf
  useEffect(() => {
    if (!manifest) return;
    const base = books.find((b) => b.id === manifest.id)?.basePath ?? "";
    const loader = new THREE.TextureLoader();
    const load = (page: number, glTFUVs: boolean) => {
      const tex = loader.load(`${base}/${manifest.pages[page - 1].src}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = !glTFUVs; // the cover plane comes from glTF, the back plane is a three.js plane
      return tex;
    };
    const front = load(2, true);
    const back = load(manifest.pages.length - 1, false);
    setEndpapers(rig.parts, front, back);
    return () => { front.dispose(); back.dispose(); };
  }, [manifest, rig]);

  // ---- per-frame animation: pages, book move, toys, camera ----
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = stateRef.current;
    const fast = reducedMotion ? 20 : 1;

    // pages and cover
    const step = (dt / TURN_SECONDS) * fast;
    let moving = false;
    turnU.current = turnU.current.map((u, i) => {
      const target = s.turned >= i + 1 ? 1 : 0;
      const next = approach(u, target, step);
      if (next !== target) moving = true;
      return next;
    });
    poseBook(rig.parts, turnU.current, shaped); // RTL: cover and leaves turn right-to-left over the spine
    if (s.busy && !moving && s.mode === "table") {
      if (!settledSent.current) { settledSent.current = true; dispatch({ type: "SETTLED" }); }
    } else if (s.busy) settledSent.current = false;

    // book move between shelf slot 1 and the table
    const closed = turnU.current.every((u) => u === 0);
    if (s.mode === "toTable") {
      moveU.current = Math.min(1, moveU.current + (dt / MOVE_SECONDS) * fast);
      if (moveU.current === 1) dispatch({ type: "ARRIVED" });
    } else if (s.mode === "toShelf" && closed) {
      moveU.current = Math.max(0, moveU.current - (dt / MOVE_SECONDS) * fast);
      if (moveU.current === 0) dispatch({ type: "RETURNED" });
    }
    const m = ease(moveU.current);
    rig.book.visible = s.mode !== "shelf";
    rig.slots[0].visible = s.mode === "shelf";
    tmp.v.lerpVectors(rig.start.p, rig.end.p, m);
    tmp.v.y += Math.sin(m * Math.PI) * 0.25;
    tmp.v.z += Math.sin(m * Math.PI) * 0.2;
    rig.book.position.copy(tmp.v);
    rig.book.quaternion.slerpQuaternions(rig.start.q, rig.end.q, m);

    // shelf books lean out a little under the pointer
    rig.slots.forEach((slot, i) => {
      const b = rig.slotBase[i];
      const want = s.mode === "shelf" && hovered.current === slot.name ? 1 : 0;
      b.hover = THREE.MathUtils.damp(b.hover, want, 12, dt);
      slot.position.copy(b.p).add(tmp.v.set(0, 0.02 * b.hover, 0.05 * b.hover));
      slot.quaternion.copy(b.q).premultiply(tmp.q.setFromAxisAngle(X_AXIS, 0.16 * b.hover));
    });

    // toys: spin, squash and hop, glow
    rig.toys.forEach((t) => {
      t.spin = THREE.MathUtils.damp(t.spin, t.target, reducedMotion ? 30 : 5, dt);
      stepSquash(t.sq, dt);
      t.hover = THREE.MathUtils.damp(t.hover, hovered.current === t.o.name ? 1 : 0, 12, dt);
      const sy = 1 + t.sq.x;
      const sxz = 1 / Math.sqrt(sy); // keep the volume while squashing
      t.o.rotation.y = t.base.rotY + t.spin;
      t.o.scale.set(t.base.scale.x * sxz, t.base.scale.y * sy, t.base.scale.z * sxz);
      t.o.position.y = t.base.y + hopHeight(t.sq.hop) + 0.008 * t.hover;
      if (t.glow > 0 || t.halo.visible) {
        t.glow = Math.max(0, t.glow - dt / 1.3);
        const g = t.glow * t.glow * (3 - 2 * t.glow);
        t.mats.forEach((mat) => (mat.emissiveIntensity = 0.3 * g));
        t.halo.material.opacity = 0.85 * g;
        t.halo.scale.setScalar(Math.max(t.size.x, t.size.y) * (1.8 + 0.8 * g));
        t.halo.visible = t.glow > 0;
      }
    });
    rig.sparkles.update(dt);

    // camera
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    let goal: { p: THREE.Vector3; q: THREE.Quaternion };
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const inFlight = (s.mode === "toTable" && moveU.current < 0.7) || (s.mode === "toShelf" && closed);
    peek.current = THREE.MathUtils.damp(peek.current, s.mode === "shelf" ? mouse.current.peek : 0, 3, dt);
    if (s.mode === "shelf" || inFlight) {
      // Main view: the shelves fill about 90% of the width. Moving the mouse to the bottom of the
      // screen tilts down to the reading table; while the book flies, the camera pulls back.
      const portrait = aspect < 1;
      const shelfW = portrait ? 1.0 : SHELF_W / 0.84; // measured at the books; the shelf front edge is nearer and looks ~90%
      const dist = Math.max(fitDistance(shelfW, 1.05, cam.fov, aspect), 1.0);
      const visibleW = 2 * dist * tanH * aspect;
      const p = pan.current;
      p.max = Math.max(0, (SHELF_W + 0.1 - visibleW) / 2);
      p.metresPerPx = visibleW / size.width;
      if (!p.init) { p.x = p.max; p.init = true; } // RTL: start at the right end, where slot 1 is
      p.x = THREE.MathUtils.clamp(p.x, -p.max, p.max);
      const main = orbit(new THREE.Vector3(p.x, 1.1, -0.15), 0.2, dist);
      const look = orbit(new THREE.Vector3(p.x * 0.5, 0.88, 0.45), 0.6, fitDistance(2.1, 1.45, cam.fov, aspect));
      const wide = orbit(new THREE.Vector3(0, 1.02, 0.4), 0.26, fitDistance(2.7, 2.0, cam.fov, aspect));
      const k = inFlight ? 1 : peek.current;
      const far = inFlight ? wide : look;
      goal = {
        p: main.p.clone().lerp(far.p, k).add(tmp.v.set(mouse.current.x * 0.08, 0, 0)), // slight parallax
        q: main.q.clone().slerp(far.q, k),
      };
    } else if (s.focus) {
      const x = rig.spot.x + (s.focus === "right" ? 1 : -1) * (PAGE_W / 2);
      const target = new THREE.Vector3(x, rig.spot.y, rig.spot.z);
      const margin = aspect < 1 ? 0.012 : 0.07; // leave room for the buttons on wide screens
      const dist = fitDistance(PAGE_W + margin, PAGE_H + margin, cam.fov, aspect);
      // straight down; the page top (away from the reader) is the top of the screen
      goal = lookPose(target.clone().add(new THREE.Vector3(0, dist, 0)), target, new THREE.Vector3(0, 0, -1));
    } else {
      // a closed book lies left of the spine, so centre on it until the cover opens
      const target = rig.spot.clone().add(new THREE.Vector3(s.turned === 0 ? -(PAGE_W + OVERHANG) / 2 : 0, 0, 0));
      const dist = fitDistance(aspect < 1 ? 0.56 : 0.62, 0.42, cam.fov, aspect);
      const dir = new THREE.Vector3(0, 1, 0.62).normalize();
      goal = lookPose(target.clone().addScaledVector(dir, dist), target, THREE.Object3D.DEFAULT_UP);
    }
    if (!snapped.current) {
      cam.position.copy(goal.p); cam.quaternion.copy(goal.q); snapped.current = true;
    } else {
      const k = 1 - Math.exp(-dt * (reducedMotion ? 40 : 4));
      cam.position.lerp(goal.p, k);
      cam.quaternion.slerp(goal.q, k);
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 10) return; // it was a drag, not a tap
    const s = stateRef.current;
    const hit = firstShown(e);
    const who = hit ? owner(hit.object) : null;
    if (!hit || !who) return;
    const toy = rig.toys.find((t) => t.o.name === who);
    if (toy) {
      toy.target += Math.PI * 2;
      toy.glow = 1;
      if (!reducedMotion) {
        toy.sq.v = -7; // squash first, then the spring throws it into a stretch and a hop
        toy.sq.hop = 0;
        rig.sparkles.burst(toy.center.clone().add(new THREE.Vector3(0, toy.size.y * 0.25, 0.04)));
      }
      if (!muted) { playBoing(); playChime(toy.kind); }
      return;
    }
    if (s.mode === "shelf" && who.startsWith("Book_Slot_")) {
      const slot = Number(who.slice(-1));
      const b = books.find((x) => x.slot === slot);
      if (!b) return;
      if (isLocked(b)) onLocked(b.title_ar);
      else dispatch({ type: "OPEN_BOOK" });
      return;
    }
    if (s.mode === "table" && who === "Book") {
      if (s.focus) return dispatch({ type: "UNFOCUS" });
      if (s.turned === 0) return dispatch({ type: "NEXT" }); // tapping the closed book opens it
      const local = rig.book.worldToLocal(hit.point.clone());
      dispatch({ type: "FOCUS", side: local.x > 0 ? "right" : "left" });
    }
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const hit = firstShown(e);
    const who = hit ? owner(hit.object) : null;
    const s = stateRef.current;
    const live = who && (TOY.test(who) || (s.mode === "shelf" && who.startsWith("Book_Slot_")) || (s.mode === "table" && who === "Book"));
    hovered.current = live ? who : null;
    setHoverSlot(live && who.startsWith("Book_Slot_") ? who : null);
    document.body.style.cursor = live ? "pointer" : "auto";
  };
  const onOut = () => {
    hovered.current = null;
    setHoverSlot(null);
    document.body.style.cursor = "auto";
  };

  return (
    <>
      <primitive object={scene} onClick={onClick} onPointerMove={onMove} onPointerOut={onOut} />
      {state.mode === "shelf" &&
        books.filter((b) => hoverSlot === `Book_Slot_${b.slot}`).map((b) => (
          <Html key={b.id} position={[rig.slotPos[b.slot - 1].x, rig.slotPos[b.slot - 1].y + 0.27, rig.slotPos[b.slot - 1].z + 0.04]} center zIndexRange={[10, 0]} wrapperClass="html-anchor" style={{ pointerEvents: "none" }}>
            <div className={isLocked(b) ? "shelf-label locked" : "shelf-label"} dir="rtl">
              <span className="shelf-title">{b.title_ar}</span>
              <span className="shelf-tag">{isLocked(b) ? "قريبًا" : "اضغط لتقرأ"}</span>
            </div>
          </Html>
        ))}
    </>
  );
}

useGLTF.preload(MODEL, DRACO);
