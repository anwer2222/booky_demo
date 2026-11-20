"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { isLocked, lockLabel, SHELF_SLOTS, type BookManifest, type ShelfBook } from "@/data/books";
import { MAX_LEAVES, type ReaderAction, type ReaderState } from "@/lib/reader";
import { playBoing, playChime, playPageTurn } from "@/lib/sound";
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
const SLOT_GAP = 0.3; // distance between book centres on the shelf
const FLIP_SECONDS = 0.28; // a shelf book tipping forward (or back up) when the shelf scrolls
// Arrow signs at the ends of the book ledge scroll the shelf. RTL: the right one (Nav_Prev) goes
// back to the previous books, the left one (Nav_Next) on to more books.
const NAV = /^Nav_(Prev|Next)$/;

export type PanState = { x: number; max: number; metresPerPx: number; init: boolean };

type Props = {
  state: ReaderState;
  dispatch: Dispatch<ReaderAction>;
  manifest: BookManifest | null;
  basePath: string; // folder of the open book (manifest, page images)
  shelf: (ShelfBook | null)[]; // the books in the visible shelf slots, slot 1 (right-most) first
  openSlot: number; // the slot the open book came from
  muted: boolean;
  reducedMotion: boolean;
  onLocked: (b: ShelfBook) => void;
  onPick: (slot: number) => void;
  onToy: (name: string) => void; // a toy was tapped (toys on the toy shelf pick a category)
  canPrev: boolean;
  canNext: boolean;
  onTurnShelf: (dir: 1 | -1) => void;
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

  // The model has five slots; the shelf shows SHELF_SLOTS books at a time, centred on the shelf.
  const allSlots = [1, 2, 3, 4, 5].map((i) => get(`Book_Slot_${i}`));
  allSlots.slice(SHELF_SLOTS).forEach((o) => (o.visible = false));
  const slots = allSlots.slice(0, SHELF_SLOTS);
  slots.forEach((o, i) => (o.position.x = ((SHELF_SLOTS - 1) / 2 - i) * SLOT_GAP));
  scene.updateMatrixWorld(true);
  // Each slot gets its own cover material, so any book's cover can go in any slot.
  const slotBase = slots.map((o, i) => {
    const art = get(`ShelfBook_${i + 1}_CoverArt`) as THREE.Mesh;
    const cover = (art.material as THREE.MeshStandardMaterial).clone();
    art.material = cover;
    const ribbon = o.getObjectByName(`ShelfBook_${i + 1}_Ribbon`) ?? null;
    return {
      p: o.position.clone(), q: o.quaternion.clone(), hover: 0, cover, ribbon,
      flip: 0, shown: null as string | null, // key of the book whose cover is showing
      hasBook: false, pending: "", wait: 0,
    };
  });

  // The table book's cover art and boards change with the book that is opened.
  const tableCover = (get("Book_CoverFront_Art") as THREE.Mesh);
  tableCover.material = (tableCover.material as THREE.MeshStandardMaterial).clone();
  const boards = ["Book_CoverFront", "Book_CoverBack", "Book_Spine"].map((n) => {
    const m = get(n) as THREE.Mesh;
    m.material = (m.material as THREE.MeshStandardMaterial).clone();
    return m.material as THREE.MeshStandardMaterial;
  });

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

  // The two arrow signs: each fades out when there is nothing more that way.
  const navs = (["Nav_Prev", "Nav_Next"] as const).map((name) => {
    const o = get(name);
    const mats: THREE.Material[] = [];
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clone = (m: THREE.Material) => { const n = m.clone(); n.transparent = true; mats.push(n); return n; };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    return {
      o, mats, name, dir: name === "Nav_Prev" ? (-1 as const) : (1 as const),
      side: name === "Nav_Prev" ? 1 : -1, // which way the arrow points in world x
      base: { x: o.position.x, scale: o.scale.clone() }, hover: 0, nudge: 0, fade: 1,
    };
  });

  // The table book, standing upright in a slot with its front cover facing the room. Read from the
  // slot's current transform, so a book that is leaning out under the pointer leaves from there.
  const onShelf = new THREE.Matrix4()
    .makeTranslation((PAGE_W + OVERHANG) / 2, PAGE_H / 2 + OVERHANG, -BOOK_T / 2)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const pose = (m: THREE.Matrix4) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    return { p, q };
  };
  const shelfPose = (slot: number) => {
    slots[slot].updateMatrixWorld(true);
    return pose(slots[slot].matrixWorld.clone().multiply(onShelf));
  };

  const spot = new THREE.Vector3();
  get("Table_ReadSpot").getWorldPosition(spot);
  const slotPos = slots.map((s) => s.getWorldPosition(new THREE.Vector3()));

  book.visible = false;
  return {
    root: scene, book, parts, slots, slotBase, slotPos, toys, navs, sparkles, spot, shelfPose,
    tableCover: tableCover.material as THREE.MeshStandardMaterial, boards,
    start: shelfPose(0), end: pose(tableMatrix),
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
    if (/^(Book_Slot_\d|Book)$/.test(o.name) || TOY.test(o.name) || NAV.test(o.name)) return o.name;
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

/** Cover images for the shelf, loaded once per URL. glTF UVs, so no vertical flip. */
const coverCache = new Map<string, THREE.Texture>();
function coverTexture(url: string) {
  let tex = coverCache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    coverCache.set(url, tex);
  }
  return tex;
}

export default function RoomScene({
  state, dispatch, manifest, basePath, shelf, openSlot, muted, reducedMotion, onLocked, onPick, onToy,
  canPrev, canNext, onTurnShelf, pan,
}: Props) {
  const { scene: cached } = useGLTF(MODEL, DRACO);
  // Build on a fresh copy each time: the loader caches one scene, and React runs memos twice in development.
  const rig: Rig = useMemo(() => buildRig(cached.clone(true)), [cached]);
  const scene = rig.root;
  const shaped = useMemo(() => new Float32Array(MAX_LEAVES).fill(-1), [rig]);
  const { camera, size } = useThree();

  // animation progress, 0..1 per item: [cover, leaf1..leaf13]
  const turnU = useRef<number[]>(new Array(MAX_LEAVES + 1).fill(0));
  const moveU = useRef(0);
  const settledSent = useRef(true);
  const snapped = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const shelfRef = useRef(shelf);
  shelfRef.current = shelf;
  const openSlotRef = useRef(openSlot);
  openSlotRef.current = openSlot;
  const hovered = useRef<string | null>(null);
  const navOk = useRef({ Nav_Prev: canPrev, Nav_Next: canNext });
  navOk.current = { Nav_Prev: canPrev, Nav_Next: canNext };

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
    if (state.mode === "toTable" || state.mode === "toShelf") rig.start = rig.shelfPose(openSlot);
  }, [state.mode, rig, openSlot]);

  // a paper sound for each page turn (and a heavier one for the cover)
  const lastTurned = useRef(0);
  useEffect(() => {
    const prev = lastTurned.current;
    lastTurned.current = state.turned;
    if (prev === state.turned || muted || state.mode === "shelf") return;
    playPageTurn(Math.min(prev, state.turned) === 0);
  }, [state.turned, state.mode, muted]);

  // the open book's cover and board colour
  useEffect(() => {
    if (!manifest) return;
    const tex = coverTexture(`${basePath}/${manifest.pages[0].src}`);
    rig.tableCover.map = tex;
    rig.tableCover.color.set("#ffffff");
    rig.tableCover.needsUpdate = true;
    if (manifest.cover_color) rig.boards.forEach((m) => m.color.set(manifest.cover_color!));
  }, [manifest, basePath, rig]);

  // ---- page textures: only the spreads around the open one are kept in memory ----
  const textures = useRef(new Map<number, THREE.Texture>());
  const texturesOf = useRef<BookManifest | null>(null);
  useEffect(() => {
    if (!manifest || state.mode === "shelf") return;
    if (texturesOf.current !== manifest) {
      // a different book: its page images replace the old ones
      textures.current.forEach((t) => t.dispose());
      textures.current.clear();
      texturesOf.current = manifest;
    }
    const t = state.turned;
    const wanted = new Set<number>();
    for (let k = Math.max(1, t - 2); k <= Math.min(state.leaves, t + 2); k++) wanted.add(2 * k + 1).add(2 * k + 2);
    const base = basePath;
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
  }, [manifest, basePath, state.turned, state.leaves, state.mode, rig]);

  useEffect(() => () => textures.current.forEach((t) => t.dispose()), []);

  // endpapers (PDF page 2 and the second-last page) stay loaded while the book is off the shelf
  useEffect(() => {
    if (!manifest) return;
    const base = basePath;
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
  }, [manifest, basePath, rig]);

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
      const target = s.turned >= i + 1 && i <= s.leaves ? 1 : 0;
      const next = approach(u, target, step);
      if (next !== target) moving = true;
      return next;
    });
    // RTL: cover and leaves turn right-to-left over the spine; a shorter book uses fewer leaves
    poseBook(rig.parts, turnU.current.slice(0, s.leaves + 1), shaped);
    if (s.busy && !moving && s.mode === "table") {
      if (!settledSent.current) { settledSent.current = true; dispatch({ type: "SETTLED" }); }
    } else if (s.busy) settledSent.current = false;

    // book move between its shelf slot and the table
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
    tmp.v.lerpVectors(rig.start.p, rig.end.p, m);
    tmp.v.y += Math.sin(m * Math.PI) * 0.25;
    tmp.v.z += Math.sin(m * Math.PI) * 0.2;
    rig.book.position.copy(tmp.v);
    rig.book.quaternion.slerpQuaternions(rig.start.q, rig.end.q, m);

    // Shelf books lean out a little under the pointer. When the shelf scrolls, each book tips
    // forward onto its face, takes its new cover, and stands up again, one after another.
    rig.slots.forEach((slot, i) => {
      const b = rig.slotBase[i];
      const book = shelfRef.current[i] ?? null;
      const key = book ? `${book._id}:${book.cover}:${isLocked(book)}` : "";
      const show = () => {
        b.shown = key;
        b.hasBook = !!book;
        if (!book) return;
        b.cover.map = coverTexture(book.cover);
        b.cover.color.set("#ffffff");
        b.cover.needsUpdate = true;
        if (b.ribbon) b.ribbon.visible = isLocked(book);
      };
      if (b.shown === null) show(); // first frame: no animation
      const flipStep = (dt / FLIP_SECONDS) * fast;
      if (b.shown !== key) {
        // stagger from right to left, the way an Arabic reader scans the shelf
        if (b.pending !== key) { b.pending = key; b.wait = (i * 0.07) / fast; }
        b.wait -= dt;
        if (b.wait <= 0) b.flip = Math.min(1, b.flip + flipStep);
        if (b.flip === 1) show();
      } else b.flip = Math.max(0, b.flip - flipStep);
      const away = s.mode !== "shelf" && i === openSlotRef.current; // this book is on the table
      slot.visible = b.hasBook && !away;
      const want = s.mode === "shelf" && hovered.current === slot.name ? 1 : 0;
      b.hover = THREE.MathUtils.damp(b.hover, want, 12, dt);
      const f = ease(b.flip);
      slot.position.copy(b.p).add(tmp.v.set(0, 0.02 * b.hover, 0.05 * b.hover + 0.06 * f));
      slot.quaternion.copy(b.q).premultiply(tmp.q.setFromAxisAngle(X_AXIS, 0.16 * b.hover + 1.45 * f));
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

    // arrow signs: lean out under the pointer, jump the way they point when tapped, fade when there is nothing more
    rig.navs.forEach((n) => {
      const ok = navOk.current[n.name] && s.mode === "shelf";
      n.hover = THREE.MathUtils.damp(n.hover, ok && hovered.current === n.name ? 1 : 0, 12, dt);
      n.nudge = Math.max(0, n.nudge - dt / 0.35);
      n.fade = THREE.MathUtils.damp(n.fade, ok ? 1 : 0.3, 8, dt);
      n.o.position.x = n.base.x + n.side * 0.04 * Math.sin(n.nudge * Math.PI);
      n.o.scale.copy(n.base.scale).multiplyScalar(1 + 0.12 * n.hover);
      n.mats.forEach((m) => (m.opacity = n.fade));
    });

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
      onToy(toy.o.name);
      return;
    }
    const nav = rig.navs.find((n) => n.name === who);
    if (nav) {
      if (s.mode !== "shelf" || !navOk.current[nav.name]) return;
      nav.nudge = 1;
      if (!muted) playChime(nav.dir > 0 ? 3 : 1);
      onTurnShelf(nav.dir);
      return;
    }
    if (s.mode === "shelf" && who.startsWith("Book_Slot_")) {
      const slot = Number(who.slice(-1)) - 1;
      const b = shelfRef.current[slot];
      if (!b) return;
      if (isLocked(b)) onLocked(b);
      else onPick(slot);
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
    const live = who && (TOY.test(who) || (s.mode === "shelf" && who.startsWith("Book_Slot_")) || (s.mode === "table" && who === "Book")
      || (s.mode === "shelf" && NAV.test(who) && navOk.current[who as "Nav_Prev" | "Nav_Next"]));
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
        shelf.map((b, i) =>
          b && hoverSlot === `Book_Slot_${i + 1}` ? (
            <Html key={b._id} position={[rig.slotPos[i].x, rig.slotPos[i].y + 0.27, rig.slotPos[i].z + 0.04]} center zIndexRange={[10, 0]} wrapperClass="html-anchor" style={{ pointerEvents: "none" }}>
              <div className={isLocked(b) ? "shelf-label locked" : "shelf-label"} dir="rtl">
                <span className="shelf-title">{b.title_ar}</span>
                <span className="shelf-tag">{isLocked(b) ? lockLabel(b) : "اضغط لتقرأ"}</span>
              </div>
            </Html>
          ) : null,
        )}
    </>
  );
}

useGLTF.preload(MODEL, DRACO);
