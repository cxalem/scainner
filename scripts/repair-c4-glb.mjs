// Segmentation repair for the Citroën C4 GLB (public/models/citroen-c4.glb).
//
// Source model: ~/Downloads/Citroen_C4_2022_interior_doors_windows_v4_1.glb —
// an AI-generated 6-way part split (paint/glass/plastic/tires/alloy/lamps)
// of the original 6,112-triangle C4 mesh, chosen over its sibling variants
// by a per-primitive data audit (v5 files contain material-less meshes that
// render default-white; v4_1 is the newest fully-materialed one with an
// interior).
//
// Why repair: the AI segmentation assigned hundreds of triangles to the
// wrong part — most dramatically, 279 of the 480 "Lamp Lenses" triangles
// are actually body panels scattered across the car. Under the original
// baked photo texture this was invisible (every triangle sampled
// plausible pixels); under the app's clean flat PBR materials every
// misassigned triangle renders as a dark shard on silver paint (or a
// light shard on dark trim) — the "triangle cuts" bug.
//
// Ground truth: the ORIGINAL orange photo atlas from the source asset
// (public/models/citroen-c4-diffuse.jpg, same UV layout — verified: 92% of
// paint triangles sample orange pixels, plastic/glass/tires sample dark).
// A triangle whose UV centroid samples saturated orange IS body paint,
// regardless of which part the segmentation put it in. Conservative rules
// only:
//   - non-paint, non-glass triangle sampling ORANGE -> move to paint
//   - paint triangle sampling DARK (<70/255)        -> move to plastic
// Everything ambiguous (midgray, bright chrome, red taillight) stays put.
//
// Run:
//   python3 -c "from PIL import Image; open('/tmp/atlas_rgb.bin','wb').write(Image.open('public/models/citroen-c4-diffuse.jpg').convert('RGB').tobytes())"
//   node scripts/repair-c4-glb.mjs
//
// Output: public/models/citroen-c4.glb (moved triangles appended as new
// accessors; the superseded accessor data stays orphaned in the buffer —
// ~0.7MB of waste, accepted for simplicity).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = path.join(os.homedir(), "Downloads/Citroen_C4_2022_interior_doors_windows_v4_1.glb");
const ATLAS_RGB = "/tmp/atlas_rgb.bin"; // 2048x2048 raw RGB dump of citroen-c4-diffuse.jpg
const OUT = "public/models/citroen-c4.glb";

const buf = fs.readFileSync(SRC);
const magic = buf.readUInt32LE(0), version = buf.readUInt32LE(4);
let off = 12;
const jl = buf.readUInt32LE(off);
const json = JSON.parse(buf.subarray(off + 8, off + 8 + jl).toString("utf8"));
off += 8 + jl;
const bl = buf.readUInt32LE(off);
const bin = buf.subarray(off + 8, off + 8 + bl);

const atlas = fs.readFileSync(ATLAS_RGB);
const AW = 2048, AH = 2048;

function accData(accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const CT = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[acc.componentType];
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const byteLen = acc.count * nComp * CT.BYTES_PER_ELEMENT;
  const copy = Buffer.alloc(byteLen);
  bin.copy(copy, 0, start, start + byteLen);
  return { arr: new CT(copy.buffer, 0, acc.count * nComp), acc };
}

function sample(u, v) {
  const x = Math.min(AW - 1, Math.max(0, Math.round(u * AW)));
  const y = Math.min(AH - 1, Math.max(0, Math.round(v * AH)));
  const i = (y * AW + x) * 3;
  return [atlas[i], atlas[i + 1], atlas[i + 2]];
}
function classify(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx - mn;
  if (r > 110 && r - b > 45 && r - g > 15) return "ORANGE";
  if (r > 100 && r - g > 40 && g - b >= -10 && g < 90) return "RED";
  if (mx < 70) return "DARK";
  if (mx > 190 && sat < 30) return "BRIGHT";
  return "MIDGRAY";
}

const PART = {
  paint: "Neutral Silver Automotive Paint",
  glass: "Clean Neutral Automotive Glass",
  plastic: "Black Exterior Plastic",
  tire: "Tire Rubber",
  alloy: "High-Fidelity Alloy and Chrome",
  lamp: "High-Fidelity Lamp Lenses",
};

const parts = {};
for (let mi = 0; mi < json.meshes.length; mi++) {
  for (const p of json.meshes[mi].primitives) {
    const matName = p.material !== undefined ? json.materials[p.material].name : null;
    const key = Object.keys(PART).find((k) => PART[k] === matName);
    if (!key) continue;
    parts[key] = {
      prim: p,
      pos: accData(p.attributes.POSITION),
      nrm: p.attributes.NORMAL !== undefined ? accData(p.attributes.NORMAL) : null,
      uv: accData(p.attributes.TEXCOORD_0),
      idx: accData(p.indices),
    };
  }
}

function extractTris(part) {
  const tris = [];
  const { pos, nrm, uv, idx } = part;
  const triCount = idx.arr.length / 3;
  for (let t = 0; t < triCount; t++) {
    const rec = { pos: [], nrm: [], uv: [] };
    let cu = 0, cv = 0;
    for (let k = 0; k < 3; k++) {
      const vi = idx.arr[t * 3 + k];
      rec.pos.push(pos.arr[vi * 3], pos.arr[vi * 3 + 1], pos.arr[vi * 3 + 2]);
      if (nrm) rec.nrm.push(nrm.arr[vi * 3], nrm.arr[vi * 3 + 1], nrm.arr[vi * 3 + 2]);
      rec.uv.push(uv.arr[vi * 2], uv.arr[vi * 2 + 1]);
      cu += uv.arr[vi * 2];
      cv += uv.arr[vi * 2 + 1];
    }
    const [r, g, b] = sample(cu / 3, cv / 3);
    rec.cls = classify(r, g, b);
    tris.push(rec);
  }
  return tris;
}

const triLists = {};
for (const k of Object.keys(parts)) triLists[k] = extractTris(parts[k]);

function moveWhere(fromKey, pred, toKey) {
  const src = triLists[fromKey];
  const kept = [];
  let n = 0;
  for (const t of src) {
    if (pred(t)) { triLists[toKey].push(t); n++; }
    else kept.push(t);
  }
  triLists[fromKey] = kept;
  console.log(`${fromKey} -> ${toKey}: ${n}`);
}

moveWhere("lamp", (t) => t.cls === "ORANGE", "paint");
moveWhere("tire", (t) => t.cls === "ORANGE", "paint");
moveWhere("alloy", (t) => t.cls === "ORANGE", "paint");
moveWhere("plastic", (t) => t.cls === "ORANGE", "paint");
moveWhere("paint", (t) => t.cls === "DARK", "plastic");

// --- Pass 2: lamp position gate. Real lamps only exist at the car's nose
// and tail; source-model coords run z ≈ ±93, and the verified lamp zones
// (from the OBJ pipeline's position guards, scaled) are |z| > 55. Lamp
// triangles outside those zones are misassignments the color test couldn't
// catch (they sample midgray/bright pixels): dark ones go to plastic,
// everything else to paint.
{
  const centroidZ = (t) => (t.pos[2] + t.pos[5] + t.pos[8]) / 3;
  moveWhere("lamp", (t) => Math.abs(centroidZ(t)) < 55 && t.cls === "DARK", "plastic");
  moveWhere("lamp", (t) => Math.abs(centroidZ(t)) < 55, "paint");
}

// --- Pass 3: island absorption. A triangle NONE of whose edge-neighbors
// belong to its own part, with >=2 neighbors in one other part, is an
// isolated shard — absorb it into that neighbor part. Only paint/plastic
// may grow (never wheels/lamps/glass), and glass is never touched. A few
// iterations erode 1-2-triangle tendrils without moving the boundary of
// any legitimate region (legit border triangles always keep a same-part
// neighbor).
const SOURCES = ["paint", "plastic", "lamp", "alloy", "tire"];
const TARGETS = new Set(["paint", "plastic"]);
for (let iter = 0; iter < 3; iter++) {
  const vq = (x, y, z) => `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeMap = new Map(); // edge -> [{part, ti}]
  for (const part of Object.keys(triLists)) {
    triLists[part].forEach((t, ti) => {
      const vs = [vq(t.pos[0], t.pos[1], t.pos[2]), vq(t.pos[3], t.pos[4], t.pos[5]), vq(t.pos[6], t.pos[7], t.pos[8])];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const k = edgeKey(vs[a], vs[b]);
        if (!edgeMap.has(k)) edgeMap.set(k, []);
        edgeMap.get(k).push({ part, ti });
      }
    });
  }
  const pending = []; // {from, ti, to}
  for (const part of SOURCES) {
    triLists[part].forEach((t, ti) => {
      const vs = [vq(t.pos[0], t.pos[1], t.pos[2]), vq(t.pos[3], t.pos[4], t.pos[5]), vq(t.pos[6], t.pos[7], t.pos[8])];
      const neighborParts = [];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        for (const e of edgeMap.get(edgeKey(vs[a], vs[b]))) {
          if (e.part === part && e.ti === ti) continue;
          neighborParts.push(e.part);
        }
      }
      if (neighborParts.length === 0) return;
      if (neighborParts.includes(part)) return; // has a same-part neighbor: not an island
      const counts = {};
      for (const np of neighborParts) counts[np] = (counts[np] || 0) + 1;
      const [best, bestN] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
      if (bestN >= 2 && TARGETS.has(best)) pending.push({ from: part, ti, to: best });
    });
  }
  // apply (descending index so removals don't shift)
  pending.sort((a, b) => b.ti - a.ti);
  let n = 0;
  for (const m of pending) {
    const [t] = triLists[m.from].splice(m.ti, 1);
    triLists[m.to].push(t);
    n++;
  }
  console.log(`island pass ${iter + 1}: absorbed ${n}`);
  if (n === 0) break;
}

function pad4(b, fill) { const r = b.length % 4; return r === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - r, fill)]); }

let newBin = bin;
function appendBufferView(byteBuf) {
  newBin = pad4(newBin, 0);
  const byteOffset = newBin.length;
  newBin = Buffer.concat([newBin, byteBuf]);
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength: byteBuf.length });
  return json.bufferViews.length - 1;
}
function addAccessor(bufferView, componentType, count, type, minMax) {
  json.accessors.push({ bufferView, componentType, count, type, ...(minMax || {}) });
  return json.accessors.length - 1;
}

for (const k of Object.keys(parts)) {
  const tris = triLists[k];
  const vcount = tris.length * 3;
  const posF = new Float32Array(vcount * 3);
  const nrmF = new Float32Array(vcount * 3);
  const uvF = new Float32Array(vcount * 2);
  const idxU = new Uint32Array(vcount);
  let vi = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (let kk = 0; kk < 3; kk++) {
      const px = t.pos[kk * 3], py = t.pos[kk * 3 + 1], pz = t.pos[kk * 3 + 2];
      posF.set([px, py, pz], vi * 3);
      mn[0] = Math.min(mn[0], px); mn[1] = Math.min(mn[1], py); mn[2] = Math.min(mn[2], pz);
      mx[0] = Math.max(mx[0], px); mx[1] = Math.max(mx[1], py); mx[2] = Math.max(mx[2], pz);
      if (t.nrm.length) nrmF.set([t.nrm[kk * 3], t.nrm[kk * 3 + 1], t.nrm[kk * 3 + 2]], vi * 3);
      uvF.set([t.uv[kk * 2], t.uv[kk * 2 + 1]], vi * 2);
      idxU[vi] = vi;
      vi++;
    }
  }
  const posBV = appendBufferView(Buffer.from(posF.buffer));
  const nrmBV = appendBufferView(Buffer.from(nrmF.buffer));
  const uvBV = appendBufferView(Buffer.from(uvF.buffer));
  const idxBV = appendBufferView(Buffer.from(idxU.buffer));
  const p = parts[k].prim;
  p.attributes.POSITION = addAccessor(posBV, 5126, vcount, "VEC3", { min: mn, max: mx });
  p.attributes.NORMAL = addAccessor(nrmBV, 5126, vcount, "VEC3");
  p.attributes.TEXCOORD_0 = addAccessor(uvBV, 5126, vcount, "VEC2");
  p.indices = addAccessor(idxBV, 5125, vcount, "SCALAR");
}

newBin = pad4(newBin, 0);
json.buffers[0].byteLength = newBin.length;

const jsonBuf = pad4(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
const header = Buffer.alloc(12);
header.writeUInt32LE(magic, 0);
header.writeUInt32LE(version, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
const jch = Buffer.alloc(8);
jch.writeUInt32LE(jsonBuf.length, 0);
jch.writeUInt32LE(0x4e4f534a, 4);
const bch = Buffer.alloc(8);
bch.writeUInt32LE(newBin.length, 0);
bch.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(OUT, Buffer.concat([header, jch, jsonBuf, bch, newBin]));
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
