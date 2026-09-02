#!/usr/bin/env node
/**
 * Rotate an emblem GLB in place, baking the rotation into the mesh vertices.
 *
 *   node apps/desktop/scripts/rotate-emblem-glb.mjs --x 180 <emblem.glb> ...
 *
 * Why this exists: several badges in public/emblems/glb arrived exported
 * face-down, so a camera on +Z sees the back of the extrusion and the mark
 * renders mirrored or upside down — on the app's live canvas as much as in
 * the PNG pipeline. render-emblems.mjs can correct a still with its
 * `rotateDeg` override, but the app's GlbEmblem has no such knob, so the
 * correction belongs in the file.
 *
 * The rotation is baked into vertex positions (and normals) rather than
 * left on a node transform: the result is a file with identity transforms
 * that behaves the same however it is loaded, instead of one that depends
 * on the consumer honouring a node TRS.
 *
 * Same headless-Chrome pipeline as render-emblems.mjs and for the same
 * reason: three.js's GLTF loader and exporter are browser code. The
 * exporter posts the re-encoded binary back to the local server, which
 * writes it over the input. Files outside the repo are never written.
 *
 * Flags: --x/--y/--z <deg> (default --x 180), --dry-run.
 */
import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

const deg = { x: 0, y: 0, z: 0 };
const files = [];
let dryRun = false;
let sawAngle = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--") continue;
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--x" || a === "--y" || a === "--z") { deg[a[2]] = Number(argv[++i]); sawAngle = true; }
  else if (a.startsWith("--")) die(`unknown flag ${a}`);
  else files.push(path.resolve(a));
}
if (!sawAngle) deg.x = 180;
if (files.length === 0) die("usage: node rotate-emblem-glb.mjs [--x deg] [--y deg] [--z deg] [--dry-run] <emblem.glb> ...");
for (const f of files) {
  if (!existsSync(f)) die(`no such file: ${f}`);
  // Guard against pointing this at the pristine source downloads: it
  // overwrites what it is given.
  if (!f.startsWith(REPO + path.sep)) die(`refusing to write outside the repo: ${f}`);
}

function die(msg) { console.error(`rotate-emblem-glb: ${msg}`); process.exit(1); }

function resolveThree() {
  const candidates = [
    path.join(REPO, "apps/desktop/node_modules/three"),
    path.join(REPO, "apps/landing/node_modules/three"),
    path.join(REPO, "node_modules/three"),
  ];
  if (process.env.THREE_DIR) {
    if (!existsSync(path.join(process.env.THREE_DIR, "build/three.module.js")))
      die(`THREE_DIR=${process.env.THREE_DIR} has no build/three.module.js`);
    return process.env.THREE_DIR;
  }
  for (const d of candidates) if (existsSync(path.join(d, "build/three.module.js"))) return d;
  die(["could not find three.js. Looked in:", ...candidates.map((c) => `  ${c}`)].join("\n"));
}

function resolveChrome() {
  if (process.env.CHROME_BIN) {
    if (!existsSync(process.env.CHROME_BIN)) die(`CHROME_BIN=${process.env.CHROME_BIN} does not exist`);
    return process.env.CHROME_BIN;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  for (const b of candidates) if (existsSync(b)) return b;
  die(["could not find Chrome. Looked in:", ...candidates.map((c) => `  ${c}`)].join("\n"));
}

const THREE_DIR = resolveThree();
const CHROME = resolveChrome();

const PAGE = `<!doctype html><meta charset="utf-8"><title>baking</title>
<script type="importmap">{"imports":{
  "three":"/three/build/three.module.js",
  "three/examples/jsm/":"/three/examples/jsm/"
}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const Q = new URLSearchParams(location.search);
const RX = Number(Q.get("x")||0)*Math.PI/180;
const RY = Number(Q.get("y")||0)*Math.PI/180;
const RZ = Number(Q.get("z")||0)*Math.PI/180;

const say = (o) => fetch("/report?" + new URLSearchParams(o)).catch(() => {});

new GLTFLoader().load("/model.glb", (gltf) => {
  const root = gltf.scene;
  root.rotation.set(RX, RY, RZ);
  root.updateMatrixWorld(true);

  // Bake every node's world matrix into its geometry, then flatten the
  // transforms to identity. A geometry instanced by more than one node
  // cannot be baked this way (one buffer, two placements), so it is cloned
  // per node first.
  const seen = new Set();
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    if (seen.has(o.geometry)) o.geometry = o.geometry.clone();
    seen.add(o.geometry);
    o.geometry.applyMatrix4(o.matrixWorld);
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
  });
  root.traverse((o) => {
    if (o === root) return;
    o.position.set(0,0,0); o.quaternion.identity(); o.scale.set(1,1,1);
  });
  root.position.set(0,0,0); root.rotation.set(0,0,0); root.scale.set(1,1,1);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  new GLTFExporter().parse(root, (bin) => {
    fetch("/save", { method: "POST", body: bin })
      .then(() => say({
        meshes, bytes: bin.byteLength,
        box: [box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z]
          .map((n) => n.toFixed(4)).join(","),
      }))
      .then(() => { document.title = "READY"; });
  }, (e) => { say({ error: "export " + e }); document.title = "ERROR"; }, { binary: true });
}, undefined, (e) => { say({ error: "load " + (e && e.message || e) }); document.title = "ERROR"; });
</script>`;

let currentGlb = null;
let report = null;
let saved = null;
const server = createServer(async (req, res) => {
  const [p] = req.url.split("?");
  const url = decodeURIComponent(p);
  try {
    if (url === "/save" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      saved = Buffer.concat(chunks);
      res.writeHead(200); return res.end("ok");
    }
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(PAGE);
    }
    if (url === "/report") {
      report = Object.fromEntries(new URL(req.url, "http://x").searchParams);
      res.writeHead(200); return res.end("ok");
    }
    const file = url === "/model.glb" ? currentGlb
      : url.startsWith("/three/") ? path.join(THREE_DIR, url.slice("/three/".length)) : null;
    if (!file) { res.writeHead(404); return res.end("not found"); }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": path.extname(file) === ".js" ? "text/javascript" : "model/gltf-binary" });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const q = new URLSearchParams({ x: String(deg.x), y: String(deg.y), z: String(deg.z) });
console.log(`rotating by (${deg.x}, ${deg.y}, ${deg.z})°${dryRun ? " — dry run, nothing written" : ""}`);
for (const glb of files) {
  currentGlb = glb; report = null; saved = null;
  const before = (await stat(glb)).size;
  await new Promise((resolve) => {
    const p = spawn(CHROME, [
      "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
      "--virtual-time-budget=30000", "--window-size=64,64",
      `--screenshot=${path.join(process.env.TMPDIR || "/tmp", "rotate-emblem-glb.png")}`,
      `http://127.0.0.1:${port}/?${q}`,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => { err += d; });
    p.on("exit", (code) => { if (code !== 0) console.error(err.trim()); resolve(); });
  });
  const name = path.basename(glb);
  if (report?.error) { console.error(`  ${name}: ${report.error}`); continue; }
  if (!saved) { console.error(`  ${name}: FAILED — exporter returned nothing`); continue; }
  if (!dryRun) await writeFile(glb, saved);
  const pct = ((saved.length - before) / before) * 100;
  console.log(
    `  ${name.padEnd(14)} ${(before/1024).toFixed(0).padStart(6)} KB -> ${(saved.length/1024).toFixed(0).padStart(6)} KB` +
    ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)  ${report?.meshes ?? "?"} meshes  bbox ${report?.box ?? "?"}`,
  );
}
server.close();
