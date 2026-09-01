#!/usr/bin/env node
/**
 * Render the app's 3D vehicle emblems (public/emblems/glb/*.glb) to flat,
 * transparent PNGs in public/emblems/png/.
 *
 *   node apps/desktop/scripts/render-emblems.mjs --all
 *   node apps/desktop/scripts/render-emblems.mjs public/emblems/glb/kia.glb
 *   node apps/desktop/scripts/render-emblems.mjs --all --size 512 --out /tmp/png
 *   node apps/desktop/scripts/render-emblems.mjs --all --contact-sheet /tmp/sheet.png
 *
 * Flags
 *   --all                 every GLB in apps/desktop/public/emblems/glb
 *   --out <dir>           output directory (default apps/desktop/public/emblems/png)
 *   --size <px>           square edge in pixels (default 1024)
 *   --keep-text           skip the wordmark-stripping heuristic (see below)
 *   --contact-sheet <p>   also write a labelled grid of every PNG rendered
 *                         (a review aid — write it outside the repo)
 *
 * The GLB is the source of truth; these PNGs are a derived, regenerable
 * artefact. Nothing in the app reads them yet.
 *
 * The scene is a port of the desktop app's GlbEmblem (src/components/
 * emblems.tsx) as it is lit on the landing hero (apps/landing/components/
 * EmblemScene.tsx): the same chrome material, the same four-panel studio
 * environment baked through PMREM, the same key/fill/rim lights, the same
 * 30° lens and ACES tone mapping, the same "fit 2.6 units across X" model
 * normalisation — all from theme/rendering.ts, mirrored here because a
 * headless renderer cannot import the app's TypeScript.
 *
 * Three deliberate differences, all because the output is a transparent
 * still of one badge rather than a live hero:
 *   - no contact shadow (a dark radial smudge has nothing to sit on once
 *     the background is transparent),
 *   - no rotation, and a near-frontal camera instead of the hero's 30°
 *     three-quarter angle: a badge used as a flat mark should read as the
 *     logo, with just enough elevation to keep the chrome bevels alive,
 *   - the camera distance and aim are fitted to each model's own bounding
 *     box rather than fixed, so every badge fills the same fraction of its
 *     square whatever its aspect ratio.
 *
 * three.js is loaded from whichever workspace has it installed, served over
 * a throwaway localhost server because ES modules will not load over
 * file://. Rendering is headless Chrome with SwiftShader; there is no
 * WebGL in Node.
 */
import { createServer } from "node:http";
import { readFile, mkdir, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const GLB_DIR = path.join(REPO, "apps/desktop/public/emblems/glb");
const DEFAULT_OUT = path.join(REPO, "apps/desktop/public/emblems/png");
const OVERRIDES_FILE = path.join(HERE, "emblem-render-overrides.json");

// —— camera defaults ————————————————————————————————————————————————
// Near-frontal, not the hero's three-quarter. Yaw is the horizontal swing
// off dead-on and elevation the height above the badge's own centre line;
// both are small on purpose — enough for the chrome to catch the key light
// and the bevels to show depth, not enough to read as a perspective shot.
// The margin is the fraction of the half-frame the model's bounding box is
// allowed to occupy, so 0.88 leaves a 12% breathing gutter on every side.
const DEFAULT_YAW_DEG = 6;
const DEFAULT_ELEV_DEG = 10;
const DEFAULT_MARGIN = 0.88;

// —— wordmark heuristic defaults ————————————————————————————————————
// Several of these GLBs model the badge as the logo plus the maker's name
// spelled out in separate letter meshes. The PNGs are wanted as marks, not
// as lockups, so the letters go. Heuristic: three or more meshes sitting in
// a thin band along the bottom of the model that together span more than
// half its width are letters, not logo.
const DEFAULT_BAND = { maxYFrac: 0.35, minWidthFrac: 0.5, minCount: 3 };

// ————————————————————————————————————————————————————————————————————
// Argument parsing
// ————————————————————————————————————————————————————————————————————
function parseArgs(argv) {
  const opts = {
    all: false,
    files: [],
    out: DEFAULT_OUT,
    size: 1024,
    keepText: false,
    contactSheet: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = (flag) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) fail(`${flag} needs a value`);
      i += 1;
      return v;
    };
    if (a === "--") continue; // `pnpm run x -- --all` forwards the separator
    if (a === "--all") opts.all = true;
    else if (a === "--out") opts.out = path.resolve(need("--out"));
    else if (a === "--size") opts.size = Number(need("--size"));
    else if (a === "--keep-text") opts.keepText = true;
    else if (a === "--contact-sheet") opts.contactSheet = path.resolve(need("--contact-sheet"));
    else if (a === "-h" || a === "--help") usage(0);
    else if (a.startsWith("--")) fail(`unknown flag ${a}`);
    else opts.files.push(path.resolve(a));
  }
  if (!Number.isFinite(opts.size) || opts.size < 16) fail(`--size must be a number >= 16`);
  return opts;
}

function usage(code) {
  console.log(
    [
      "usage: node apps/desktop/scripts/render-emblems.mjs [--all | <emblem.glb> ...]",
      "               [--out <dir>] [--size <px>] [--keep-text] [--contact-sheet <png>]",
      "",
      "  --all               render every GLB in apps/desktop/public/emblems/glb",
      `  --out <dir>         output directory (default ${path.relative(REPO, DEFAULT_OUT)})`,
      "  --size <px>         square edge in pixels (default 1024)",
      "  --keep-text         keep wordmark letter meshes instead of stripping them",
      "  --contact-sheet <p> write a labelled review grid of the rendered PNGs",
      "",
      "Per-file camera and heuristic overrides live in",
      `  ${path.relative(REPO, OVERRIDES_FILE)}`,
    ].join("\n"),
  );
  process.exit(code);
}

function fail(msg) {
  console.error(`render-emblems: ${msg}`);
  process.exit(1);
}

// ————————————————————————————————————————————————————————————————————
// Environment resolution
// ————————————————————————————————————————————————————————————————————

// three.js is a dependency of more than one workspace here and this script
// belongs to none of them, so rather than importing it, find a copy on disk
// and serve its ES modules. THREE_DIR overrides for anyone running from a
// worktree with no node_modules of its own.
function resolveThree() {
  const candidates = [
    path.join(REPO, "apps/desktop/node_modules/three"),
    path.join(REPO, "apps/landing/node_modules/three"),
    path.join(REPO, "node_modules/three"),
  ];
  if (process.env.THREE_DIR) {
    const dir = process.env.THREE_DIR;
    if (!existsSync(path.join(dir, "build/three.module.js")))
      fail(`THREE_DIR=${dir} has no build/three.module.js`);
    return dir;
  }
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "build/three.module.js"))) return dir;
  }
  fail(
    [
      "could not find three.js. Looked in:",
      ...candidates.map((c) => `  ${c}`),
      "Run `pnpm install` at the repo root, or set THREE_DIR to a three package directory.",
    ].join("\n"),
  );
}

// Headless Chrome does the rendering (SwiftShader gives WebGL without a
// GPU). No bundled browser is downloaded — this uses whatever Chrome the
// machine already has.
function resolveChrome() {
  if (process.env.CHROME_BIN) {
    if (!existsSync(process.env.CHROME_BIN))
      fail(`CHROME_BIN=${process.env.CHROME_BIN} does not exist`);
    return process.env.CHROME_BIN;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const bin of candidates) if (existsSync(bin)) return bin;
  fail(
    [
      "could not find Chrome. Looked in:",
      ...candidates.map((c) => `  ${c}`),
      "Install Google Chrome, or set CHROME_BIN to a Chrome/Chromium binary.",
    ].join("\n"),
  );
}

function loadOverrides() {
  if (!existsSync(OVERRIDES_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(OVERRIDES_FILE, "utf-8"));
    // The file carries a "_comment" key for readers; everything else is a
    // per-emblem entry keyed by GLB basename.
    const out = {};
    for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_")) out[k] = v;
    return out;
  } catch (e) {
    fail(`could not read ${OVERRIDES_FILE}: ${e.message}`);
  }
}

// ————————————————————————————————————————————————————————————————————
// The page: one render, driven entirely by query parameters
// ————————————————————————————————————————————————————————————————————
const PAGE = `<!doctype html><meta charset="utf-8"><title>rendering</title>
<style>html,body{margin:0;background:transparent}canvas{display:block}</style>
<script type="importmap">{"imports":{
  "three":"/three/build/three.module.js",
  "three/examples/jsm/":"/three/examples/jsm/"
}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) ? Number(Q.get(k)) : d);
const SIZE = num("size", 1024);
const YAW = num("yaw", 6) * Math.PI / 180;
const ELEV = num("elev", 10) * Math.PI / 180;
const MARGIN = num("margin", 0.88);
const KEEP_TEXT = Q.get("keepText") === "1";
const BAND = { maxYFrac: num("bandMaxYFrac", 0.35), minWidthFrac: num("bandMinWidthFrac", 0.5), minCount: num("bandMinCount", 3) };
const TARGET_WIDTH = num("targetWidth", 2.6);

// —— constants mirrored from apps/desktop/src/theme/rendering.ts ——
const CHROME_MATERIAL = { color:"#f4f6f8", metalness:0.9, roughness:0.13,
  clearcoat:0.85, clearcoatRoughness:0.06, envMapIntensity:2.0 };
const STUDIO = { backdrop:[0.32,0.34,0.37], overheadPanel:[2.4,2.4,2.4],
  coolPanel:[1.3,1.5,1.8], warmPanel:[1.8,1.5,1.2], floorPanel:"#3a3a3a", rimLight:"#dfe8ff" };

const renderer = new THREE.WebGLRenderer({ alpha:true, antialias:true });
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.setSize(SIZE, SIZE, false);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

function studioEnv(){
  const s = new THREE.Scene();
  s.background = new THREE.Color(...STUDIO.backdrop);
  const panel = (p,r,sc,c) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({ color:c, side:THREE.DoubleSide, toneMapped:false }));
    m.position.set(...p); m.rotation.set(...r); m.scale.set(...sc); s.add(m);
  };
  panel([0,5,-2],[0,0,0],[8,4,1], new THREE.Color(...STUDIO.overheadPanel));
  panel([5,2,3],[0,-Math.PI/2.5,0],[4,3,1], new THREE.Color(...STUDIO.coolPanel));
  panel([-5,1.5,3],[0,Math.PI/2.5,0],[4,3,1], new THREE.Color(...STUDIO.warmPanel));
  panel([0,-3,0],[-Math.PI/2,0,0],[10,10,1], new THREE.Color(STUDIO.floorPanel));
  return s;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioEnv(), 0, 0.1, 100).texture;
pmrem.dispose();

const key = new THREE.DirectionalLight(0xffffff, 0.6); key.position.set(3,5,3);
const fill = new THREE.DirectionalLight(0xffffff, 0.2); fill.position.set(-4,2,1);
const rim = new THREE.DirectionalLight(STUDIO.rimLight, 0.9); rim.position.set(0,-2,-5);
scene.add(key, fill, rim);

const group = new THREE.Group(); scene.add(group);

function report(payload){
  return fetch("/report?" + new URLSearchParams(payload)).catch(() => {});
}

// Strip the maker's name. Returns how many meshes were removed.
function stripWordmark(obj){
  const parts = [];
  obj.traverse((o) => { if (o.isMesh) parts.push([o, new THREE.Box3().setFromObject(o)]); });
  if (parts.length < BAND.minCount) return 0;
  const all = new THREE.Box3().setFromObject(obj);
  const h = all.max.y - all.min.y, w = all.max.x - all.min.x;
  const band = parts.filter(([, b]) => b.max.y < all.min.y + BAND.maxYFrac * h);
  if (band.length < BAND.minCount) return 0;
  // A badge that is nothing but its name would be erased entirely; leave it
  // whole and let the log say so rather than emitting an empty PNG.
  if (band.length >= parts.length) return 0;
  const bx0 = Math.min(...band.map(([, b]) => b.min.x));
  const bx1 = Math.max(...band.map(([, b]) => b.max.x));
  if (bx1 - bx0 <= BAND.minWidthFrac * w) return 0;
  band.forEach(([m]) => m.parent && m.parent.remove(m));
  return band.length;
}

// Point the camera down a fixed yaw/elevation and solve for the distance
// and aim that put the model's bounding box centred and just inside the
// frame. Iterating beats a closed form here because the box is projected
// under perspective: each pass re-aims at the projected centre, then scales
// the distance by how far the worst corner overshoots the margin.
function fitCamera(obj){
  const box = new THREE.Box3().setFromObject(obj);
  const corners = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x,y,z));
  const dir = new THREE.Vector3(
    Math.sin(YAW) * Math.cos(ELEV), Math.sin(ELEV), Math.cos(YAW) * Math.cos(ELEV));
  const target = new THREE.Vector3(); box.getCenter(target);
  let dist = Math.max(box.max.distanceTo(box.min), 1) * 3;
  const right = new THREE.Vector3(), up = new THREE.Vector3(), ndc = new THREE.Vector3();
  for (let i = 0; i < 14; i += 1) {
    camera.position.copy(dir).multiplyScalar(dist).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      ndc.copy(c).project(camera);
      x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x);
      y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y);
    }
    // Re-aim so the projected box is centred, then re-fit its extent.
    const halfH = Math.tan((camera.fov * Math.PI / 180) / 2) * dist;
    camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    target.addScaledVector(right, ((x0 + x1) / 2) * halfH * camera.aspect);
    target.addScaledVector(up, ((y0 + y1) / 2) * halfH);
    const extent = Math.max((x1 - x0) / 2, (y1 - y0) / 2);
    dist *= extent / MARGIN;
  }
  camera.position.copy(dir).multiplyScalar(dist).add(target);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return dist;
}

new GLTFLoader().load("/model.glb" + location.search, (gltf) => {
  const material = new THREE.MeshPhysicalMaterial({ ...CHROME_MATERIAL });
  const obj = gltf.scene;
  let meshes = 0;
  obj.traverse((o) => { if (o.isMesh) { o.material = material; meshes += 1; } });

  const dropped = KEEP_TEXT ? 0 : stripWordmark(obj);

  // Normalise scale the way the app does (GlbEmblem's targetWidth) so the
  // baked environment reflects off a badge of the size it was tuned for;
  // framing is the camera's job, below.
  const box = new THREE.Box3().setFromObject(obj);
  const sz = new THREE.Vector3(); box.getSize(sz);
  const c = new THREE.Vector3(); box.getCenter(c);
  const k = sz.x > 0 ? TARGET_WIDTH / sz.x : 1;
  obj.scale.setScalar(k);
  obj.position.set(-c.x*k, -c.y*k, -c.z*k);
  group.add(obj);

  const dist = fitCamera(obj);
  renderer.render(scene, camera);
  requestAnimationFrame(() => {
    renderer.render(scene, camera);
    report({ meshes, dropped, dist: dist.toFixed(3) }).then(() => {
      document.title = "READY";
    });
  });
}, undefined, (e) => {
  report({ error: String(e && e.message || e) });
  document.title = "ERROR";
});
</script>`;

// A labelled grid of the rendered PNGs, for eyeballing every badge at once.
// Rendered through the same browser rather than an image tool, so the script
// keeps its "Chrome and nothing else" dependency footprint.
function sheetPage(names, cols, cell) {
  const cards = names
    .map(
      (n) => `<figure style="margin:0"><img src="/png/${n}.png" width="${cell}" height="${cell}">
  <figcaption>${n}</figcaption></figure>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>contact sheet</title>
<style>
  body{margin:0;padding:24px;background:#14141a;color:#c9c9d4;
       font:13px/1.4 ui-sans-serif,system-ui,sans-serif}
  .grid{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:16px}
  img{display:block;background:
      repeating-conic-gradient(#22222c 0 25%,#1a1a22 0 50%) 0 0/24px 24px}
  figcaption{padding-top:6px;text-align:center;letter-spacing:.04em}
</style>
<div class="grid">${cards}</div>`;
}

// ————————————————————————————————————————————————————————————————————
// Driver
// ————————————————————————————————————————————————————————————————————
const opts = parseArgs(process.argv.slice(2));
const THREE_DIR = resolveThree();
const CHROME = resolveChrome();
const overrides = loadOverrides();

let inputs = opts.files;
if (opts.all) {
  if (!existsSync(GLB_DIR)) fail(`no GLB directory at ${GLB_DIR}`);
  const found = (await readdir(GLB_DIR)).filter((f) => f.endsWith(".glb")).sort();
  inputs = [...inputs, ...found.map((f) => path.join(GLB_DIR, f))];
}
if (inputs.length === 0) usage(1);
for (const f of inputs) if (!existsSync(f)) fail(`no such file: ${f}`);
inputs = [...new Set(inputs)];

await mkdir(opts.out, { recursive: true });

// One server for the whole run: it serves three.js, the page, whichever GLB
// the current render asked for, and (at the end) the finished PNGs for the
// contact sheet.
let currentGlb = null;
let currentReport = null;
let sheetHtml = "";
const server = createServer(async (req, res) => {
  const [rawPath] = req.url.split("?");
  const url = decodeURIComponent(rawPath);
  try {
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (url === "/sheet") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(sheetHtml);
    }
    if (url === "/report") {
      currentReport = Object.fromEntries(new URL(req.url, "http://x").searchParams);
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("ok");
    }
    const file =
      url === "/model.glb" ? currentGlb
      : url.startsWith("/png/") ? path.join(opts.out, url.slice("/png/".length))
      : url.startsWith("/three/") ? path.join(THREE_DIR, url.slice("/three/".length))
      : null;
    if (!file) { res.writeHead(404); return res.end("not found"); }
    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type":
        ext === ".js" ? "text/javascript"
        : ext === ".glb" ? "model/gltf-binary"
        : ext === ".png" ? "image/png"
        : "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

function shoot(url, out, size, height = size) {
  return new Promise((resolve) => {
    const args = [
      "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader", "--hide-scrollbars", "--force-device-scale-factor=1",
      `--window-size=${size},${height}`, "--default-background-color=00000000",
      "--virtual-time-budget=20000", `--screenshot=${out}`, url,
    ];
    // Chrome's stderr is a wall of harmless macOS display/GPU warnings in
    // headless mode, so it is buffered and only surfaced if it actually
    // exits non-zero.
    const p = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("exit", (code) => {
      if (code !== 0) console.error(err.trim());
      resolve(code);
    });
  });
}

const rendered = [];
let totalBytes = 0;
for (const glb of inputs) {
  const name = path.basename(glb, ".glb");
  const ov = overrides[name] ?? {};
  const params = new URLSearchParams({
    size: String(opts.size),
    yaw: String(ov.yawDeg ?? DEFAULT_YAW_DEG),
    elev: String(ov.elevDeg ?? DEFAULT_ELEV_DEG),
    margin: String(ov.margin ?? DEFAULT_MARGIN),
    keepText: opts.keepText || ov.keepText ? "1" : "0",
    bandMaxYFrac: String(ov.bandMaxYFrac ?? DEFAULT_BAND.maxYFrac),
    bandMinWidthFrac: String(ov.bandMinWidthFrac ?? DEFAULT_BAND.minWidthFrac),
    bandMinCount: String(ov.bandMinCount ?? DEFAULT_BAND.minCount),
  });
  const out = path.join(opts.out, `${name}.png`);
  currentGlb = glb;
  currentReport = null;
  await shoot(`${base}/?${params}`, out, opts.size);
  if (!existsSync(out)) {
    console.error(`  ${name}: FAILED — no screenshot written`);
    continue;
  }
  const bytes = (await stat(out)).size;
  totalBytes += bytes;
  rendered.push(name);
  const r = currentReport ?? {};
  if (r.error) console.error(`  ${name}: load error ${r.error}`);
  const note = [
    `${r.meshes ?? "?"} meshes`,
    `${r.dropped ?? "?"} dropped`,
    Object.keys(ov).length ? `override:${Object.keys(ov).join(",")}` : null,
  ].filter(Boolean).join(", ");
  console.log(`  ${name.padEnd(14)} ${(bytes / 1024).toFixed(0).padStart(5)} KB  (${note})`);
}

if (opts.contactSheet && rendered.length) {
  const cols = Math.min(5, rendered.length);
  const cell = 220;
  sheetHtml = sheetPage(rendered, cols, cell);
  const rows = Math.ceil(rendered.length / cols);
  const width = 48 + cols * cell + (cols - 1) * 16;
  const height = 48 + rows * (cell + 24) + (rows - 1) * 16;
  await mkdir(path.dirname(opts.contactSheet), { recursive: true });
  await shoot(`${base}/sheet`, opts.contactSheet, width, height);
  console.log(`contact sheet: ${opts.contactSheet}`);
}

server.close();
console.log(
  `wrote ${rendered.length} PNG${rendered.length === 1 ? "" : "s"} ` +
  `(${(totalBytes / 1024 / 1024).toFixed(2)} MB) to ${opts.out}`,
);
