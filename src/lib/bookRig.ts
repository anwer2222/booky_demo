// The readable book on the table: two page stacks that grow and shrink as you read, leaves that
// bend while they turn, and paper materials with a shaded gutter. Geometry comes from the Blender
// model (see assets/README.md); everything here is in the book's local space (three.js, Y up,
// spine on the right at x = 0, pages extending to -x).

import * as THREE from "three";
import { LEAVES } from "./reader";

export const PAGE_W = 0.254;
export const PAGE_H = 0.1905;
export const COVER_T = 0.0025;
const LEAF_T = 0.0006; // 13 leaves ≈ the 8 mm page block in the model
const LIFT = 0.00025; // leaf planes sit this far above their stack (they are ±0.2 mm thick)
const CURL = 0.8; // how far the free edge leads the rest of the page mid-turn (radians)
const CORNER = 1.3; // extra lead at the bottom (reader-side) edge: the turn starts from that corner
const COLS = 40; // leaf grid across the width…
const ROWS = 12; // …and along the height, so the corner can bend on its own
const SAMPLES = 80;

const PAPER_HEX = "#f4ecdc";

/** 1×1 paper texture, so page materials always have a map (the gutter shader reads its UVs). */
function paperTexture() {
  const c = new THREE.Color(PAPER_HEX);
  const tex = new THREE.DataTexture(new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]), 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Thin horizontal lines, for the visible edges of the page stacks. */
function pageEdgeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#efe4cd";
  g.fillRect(0, 0, 8, 128);
  for (let y = 0; y < 128; y += 4) {
    g.fillStyle = y % 8 ? "#e2d4b8" : "#d6c6a6";
    g.fillRect(0, y, 8, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Page paper: darker towards the spine (the gutter) and very slightly at the outer edge. */
function pageMaterial(base: THREE.MeshStandardMaterial, map: THREE.Texture, spineU: number) {
  const m = base.clone();
  m.map = map;
  m.color.set("#ffffff");
  m.roughness = 0.92;
  m.metalness = 0;
  m.side = THREE.FrontSide;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSpineU = { value: spineU };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSpineU;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float gutter = abs(vMapUv.x - uSpineU);
        diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.0, 0.1, gutter));
        diffuseColor.rgb *= mix(0.94, 1.0, smoothstep(0.0, 0.015, 1.0 - gutter));`,
      );
  };
  m.customProgramCacheKey = () => `page-${spineU}`;
  return m;
}

/**
 * Rebuild a leaf side from the model as a COLS × ROWS grid. The model's leaf is one row of quads,
 * which can bend across the width but not along the height. UVs are affine in (x, z), so they are
 * read off three corners of the original.
 */
function leafGrid(src: THREE.BufferGeometry) {
  const pos = src.getAttribute("position");
  const uv = src.getAttribute("uv");
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
  for (let i = 0; i < pos.count; i++) {
    x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i));
    z0 = Math.min(z0, pos.getZ(i)); z1 = Math.max(z1, pos.getZ(i));
    y += pos.getY(i) / pos.count;
  }
  const uvAt = (x: number, z: number) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - x) ** 2 + (pos.getZ(i) - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return [uv.getX(best), uv.getY(best)];
  };
  const [a, b, c] = [uvAt(x1, z0), uvAt(x0, z0), uvAt(x1, z1)]; // spine/far, edge/far, spine/near
  const positions = new Float32Array((COLS + 1) * (ROWS + 1) * 3);
  const uvs = new Float32Array((COLS + 1) * (ROWS + 1) * 2);
  for (let r = 0, v = 0; r <= ROWS; r++) {
    for (let i = 0; i <= COLS; i++, v++) {
      const fx = i / COLS, fz = r / ROWS;
      positions.set([x1 + (x0 - x1) * fx, y, z0 + (z1 - z0) * fz], v * 3);
      uvs.set([a[0] + (b[0] - a[0]) * fx + (c[0] - a[0]) * fz, a[1] + (b[1] - a[1]) * fx + (c[1] - a[1]) * fz], v * 2);
    }
  }
  // wind the triangles so the side faces the same way as the original (front up, back down)
  const up = y > 0;
  const index: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < COLS; i++) {
      const p = r * (COLS + 1) + i, q = p + 1, s = p + COLS + 1, t = s + 1;
      // x decreases along i and z increases along r, so (p, q, s) faces +y
      if (up) index.push(p, q, s, q, t, s);
      else index.push(p, s, q, q, s, t);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, z0, z1 };
}

type LeafMesh = { mesh: THREE.Mesh; base: Float32Array; material: THREE.MeshStandardMaterial };
export type Leaf = { hinge: THREE.Object3D; front: LeafMesh; back: LeafMesh; visible: boolean };

let leafZ0 = -PAGE_H / 2; // far (top) edge of the page, book space
let leafZ1 = PAGE_H / 2; // near (bottom) edge, towards the reader

export function buildBook(book: THREE.Object3D) {
  const get = (name: string) => {
    const o = book.getObjectByName(name);
    if (!o) throw new Error(`model is missing node ${name}`);
    return o;
  };
  const paper = paperTexture();
  const coverHinge = get("Book_Hinge_Front");
  const coverClosedY = coverHinge.position.y;
  const template = get("Book_Hinge_Leaf");
  const holder = template.parent!; // the Book node; leaves and stacks hang off it
  get("Book_PageBlock").visible = false; // replaced by the two live stacks below

  const leafMesh = (src: THREE.Mesh, spineU: number): LeafMesh => {
    const mesh = src.clone();
    const grid = leafGrid(src.geometry); // each leaf bends on its own
    mesh.geometry = grid.geo;
    leafZ0 = grid.z0;
    leafZ1 = grid.z1;
    const material = pageMaterial(src.material as THREE.MeshStandardMaterial, paper, spineU);
    mesh.material = material;
    mesh.castShadow = mesh.receiveShadow = true;
    const base = (mesh.geometry.getAttribute("position").array as Float32Array).slice();
    return { mesh, base, material };
  };
  const frontSrc = template.getObjectByName("Book_Leaf_Front") as THREE.Mesh;
  const backSrc = template.getObjectByName("Book_Leaf_Back") as THREE.Mesh;

  // Front faces up on the left stack (spine at u = 1); back faces up after the turn (spine at u = 0).
  const leaves: Leaf[] = [];
  for (let k = 1; k <= LEAVES; k++) {
    const hinge = new THREE.Object3D();
    hinge.name = `Leaf_${k}`;
    hinge.position.copy(template.position);
    const front = leafMesh(frontSrc, 1);
    const back = leafMesh(backSrc, 0);
    hinge.add(front.mesh, back.mesh);
    holder.add(hinge);
    leaves.push({ hinge, front, back, visible: true });
  }
  template.removeFromParent();

  // Live page stacks: left (unread) and right (read).
  const edge = new THREE.MeshStandardMaterial({ map: pageEdgeTexture(), roughness: 0.95 });
  const top = new THREE.MeshStandardMaterial({ color: PAPER_HEX, roughness: 0.95 });
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const stack = (side: -1 | 1) => {
    const m = new THREE.Mesh(box, [edge, edge, top, top, edge, edge]);
    m.position.set((side * PAGE_W) / 2, COVER_T, 0);
    m.scale.set(PAGE_W - 0.002, 0.0001, PAGE_H);
    m.castShadow = m.receiveShadow = true;
    holder.add(m);
    return m;
  };
  const leftStack = stack(-1);
  const rightStack = stack(1);

  // Endpapers: the inside of the front cover comes from the model; the inside of the back cover is a
  // plane under the left stack, seen only once every leaf has turned.
  const frontInside = (get("Book_CoverFront_Inside") as THREE.Mesh).material as THREE.MeshStandardMaterial;
  const backInside = new THREE.Mesh(
    new THREE.PlaneGeometry(PAGE_W, PAGE_H).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: PAPER_HEX, roughness: 0.9 }),
  );
  backInside.position.set(-PAGE_W / 2, COVER_T + 0.0001, 0);
  backInside.receiveShadow = true;
  holder.add(backInside);

  return { coverHinge, coverClosedY, leaves, leftStack, rightStack, paper, frontInside, backInside };
}

/** Put the book's endpaper designs on the inside of both covers. */
export function setEndpapers(parts: BookParts, front: THREE.Texture, back: THREE.Texture) {
  parts.frontInside.map = front;
  parts.frontInside.color.set("#ffffff");
  parts.frontInside.needsUpdate = true;
  const m = parts.backInside.material as THREE.MeshStandardMaterial;
  m.map = back;
  m.color.set("#ffffff");
  m.needsUpdate = true;
}

export type BookParts = ReturnType<typeof buildBook>;

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// scratch buffers: one curve per grid row
const N = (ROWS + 1) * (SAMPLES + 1);
const cx = new Float32Array(N);
const cy = new Float32Array(N);
const cphi = new Float32Array(N);

/**
 * Bend one leaf for turn angle theta (0 = flat on the left, π = flat on the right).
 * Each row of the grid follows its own curve: the free edge leads the spine, and the reader-side
 * corner leads most, as if a hand lifted the page by that corner.
 */
function shapeLeaf(leaf: Leaf, theta: number) {
  const env = Math.pow(Math.sin(theta), 0.6); // lift the corner early, flatten again on landing
  const ds = PAGE_W / SAMPLES;
  for (let r = 0; r <= ROWS; r++) {
    const near = r / ROWS;
    const lead = CURL * env * (1 + CORNER * near * near);
    let x = 0;
    let y = 0;
    for (let i = 0, k = r * (SAMPLES + 1); i <= SAMPLES; i++, k++) {
      const phi = Math.min(Math.PI, theta + lead * Math.pow(i / SAMPLES, 1.5));
      cx[k] = x;
      cy[k] = y;
      cphi[k] = phi;
      x -= Math.cos(phi) * ds;
      y += Math.sin(phi) * ds;
    }
  }
  for (const part of [leaf.front, leaf.back]) {
    const attr = part.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const out = attr.array as Float32Array;
    const b = part.base;
    for (let v = 0; v < b.length; v += 3) {
      const d = Math.min(PAGE_W, Math.max(0, -b[v])) / ds; // distance from the spine, in samples
      const i = Math.min(SAMPLES - 1, Math.floor(d));
      const t = d - i;
      const r = Math.round(((b[v + 2] - leafZ0) / (leafZ1 - leafZ0)) * ROWS);
      const k = r * (SAMPLES + 1) + i;
      const px = cx[k] + (cx[k + 1] - cx[k]) * t;
      const py = cy[k] + (cy[k + 1] - cy[k]) * t;
      const phi = cphi[k] + (cphi[k + 1] - cphi[k]) * t;
      const off = b[v + 1]; // ± half the leaf thickness
      out[v] = px + Math.sin(phi) * off;
      out[v + 1] = py + Math.cos(phi) * off;
      out[v + 2] = b[v + 2];
    }
    attr.needsUpdate = true;
    part.mesh.geometry.computeVertexNormals();
    part.mesh.geometry.computeBoundingSphere();
  }
}

/**
 * Place every part for the given turn progress.
 * u[0] is the cover, u[k] is leaf k (0 = unturned, 1 = turned).
 */
export function poseBook(parts: BookParts, u: number[], shaped: Float32Array) {
  const leafU = u.slice(1);
  const nLeft = leafU.filter((x) => x === 0).length;
  const nRight = leafU.filter((x) => x === 1).length;
  const leftTop = COVER_T + nLeft * LEAF_T;
  const rightTop = COVER_T + 0.0002 + nRight * LEAF_T;
  parts.leftStack.scale.y = Math.max(0.0001, nLeft * LEAF_T);
  parts.rightStack.scale.y = Math.max(0.0001, nRight * LEAF_T);
  parts.rightStack.position.y = COVER_T + 0.0002;
  parts.leftStack.visible = nLeft > 0;
  parts.rightStack.visible = nRight > 0;

  // the cover is stiff: it swings on its hinge and ends up under the right-hand stack
  const c = ease(u[0]);
  parts.coverHinge.rotation.z = -Math.PI * c;
  parts.coverHinge.position.y =
    THREE.MathUtils.lerp(parts.coverClosedY, COVER_T + 0.0002, c) + Math.sin(u[0] * Math.PI) * 0.01;

  const topLeft = leafU.indexOf(0); // first unturned leaf
  const topRight = leafU.lastIndexOf(1); // last turned leaf
  parts.leaves.forEach((leaf, i) => {
    const lu = leafU[i];
    const moving = lu > 0 && lu < 1;
    const show = moving || i === topLeft || i === topRight;
    if (show !== leaf.visible) {
      leaf.hinge.visible = show;
      leaf.visible = show;
    }
    if (!show) return;
    let y: number;
    if (lu === 0) y = leftTop + LIFT;
    else if (lu === 1) y = rightTop + LIFT;
    else y = THREE.MathUtils.lerp(leftTop + LEAF_T + LIFT, rightTop + LEAF_T + LIFT, ease(lu));
    leaf.hinge.position.y = y;
    leaf.hinge.rotation.z = 0;
    const theta = Math.PI * ease(lu);
    if (shaped[i] !== theta) {
      shapeLeaf(leaf, theta);
      shaped[i] = theta;
    }
  });
}

/** Swap a leaf side back to blank paper (its page image is no longer near the open spread). */
export function blankPage(m: THREE.MeshStandardMaterial, paper: THREE.Texture) {
  if (m.map !== paper) {
    m.map = paper;
    m.needsUpdate = true;
  }
}
