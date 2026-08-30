// The per-vehicle 3D model — your actual Citroën C4, loaded from an OBJ with
// a baked UV texture (public/models/citroen-c4.obj +
// citroen-c4-diffuse-gray.jpg), not the earlier raw STL. The OBJ source came
// with a proper photo-real diffuse map (windows, grille, wheels, trim, tire
// tread — all baked into the texture), which is what actually makes the
// model read as "a car" at a glance instead of a uniform-color blob.
//
// Color: there is no reliable way to read a car's real paint color from its
// VIN or its ECU (the VIN doesn't encode it, and the one module that might
// hold vehicle-config data — the BSI — doesn't respond over this dongle's
// path; see UDS_INVESTIGATION_LOG.md). So `color` here was designed to be
// user-entered, never detected — but that input path (a `set_body_color`
// command / `body_color` key in car_info, picked in the Vehicle tab) was
// never actually built, and this `color`-aware model (CarModel, below) is
// itself dormant — BrandEmblemModel is the active model today and takes no
// color at all. Kept for a possible future per-car-model feature, not a
// live one; don't take "picked in the Identity card" as true of the current
// UI. To make color adjustable at all, we use a *desaturated* copy of
// the original texture (citroen-c4-diffuse-gray.jpg, generated once from the
// source color map) as the material's map, and multiply it by the chosen
// color — texture × color is how three.js (and every real-time renderer)
// composites a map against a material color. Areas that are already
// dark/black in the source (glass, tires, trim, shadows) stay dark under any
// tint since black × anything is still black; only the mid/light "paint"
// pixels actually shift hue. It's an approximation, not a repaint — a chrome
// trim strip will pick up a faint tint too — but it reads correctly at this
// scale, and needs no per-part material split the source model doesn't have
// (it's a single merged mesh/material, "car_oli," not separate body/glass/
// wheel groups).
//
// The OBJ is already Y-up (Wavefront convention, unlike the earlier Z-up STL
// export), so ROTATION_FIX is the identity here — kept as a named constant
// anyway, same as before, in case a future model swap needs correcting.
import sceneModel from "@/data/scene-model.json";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { brandFromVin } from "@/lib/brand";
import { STUDIO_LIGHTING, VEHICLE_MATERIALS } from "@/theme";
import { EMBLEMS, EmblemFallback, NameplateEmblem, preloadEmblem } from "./emblems";

// Re-exported so callers that already lazy-load this module (Login's
// carousel, ConnectGate, DiscoveryFlow — see each file's own preload
// effect) can warm a brand's GLB through the same dynamic-import chunk
// boundary, instead of a second import("@/components/emblems") that risks
// Vite splitting it into a separate chunk from the one this file's own
// three.js imports already live in.
export { preloadEmblem };
import { cn } from "@/lib/utils";
import { EmblemStarfield } from "./EmblemStarfield";

export type SceneStatus = "disconnected" | "connecting" | "connected";

// Sourced from ../theme/rendering.ts (VEHICLE_MATERIALS) — see that file's
// header for why 3D-layer color constants live there instead of index.css.
const DEFAULT_TINT = VEHICLE_MATERIALS.defaultTint; // near-white — shows the texture close to its native grayscale until a real color is picked
const PULSE_COLOR = VEHICLE_MATERIALS.pulseColor;

// Asset paths live in data (src/data/scene-model.json), not here.
const MODEL_URL: string = sceneModel.model;
const TEXTURE_URL: string = sceneModel.texture;
// Matches the previous placeholder's overall body length, so the existing
// camera position/fov keep framing the car the same way.
const TARGET_LENGTH = 3.6;
// Identity for this OBJ (already Y-up). If a future model export needs a
// Z-up → Y-up fix like the earlier STL did, this is the constant to change.
const ROTATION_FIX: [number, number, number] = [0, 0, 0];

// The wheel's own UV island in the texture atlas — found empirically, not
// guessed: traced triangles that are unambiguously wheels (the ones whose
// 3D position touches y=0, the ground — nothing else on a car does that)
// back to where they sample the texture, then confirmed by cropping that
// exact region out of citroen-c4-diffuse.jpg and looking at it — it's the
// wheel closeup photo (alloy rim + tire, both in one shot), completely
// separate from the body-panel unwrap. A first attempt at finding wheels by
// 3D position alone (radius from an estimated hub center) didn't work: the
// painted wheel-arch bodywork wraps right around the wheel in 3D space, so
// any 3D-radius net also scoops up painted panel and leaves holes where it
// shouldn't.
//
// UV space alone turned out not to be clean either, on its own: this exact
// UV box also catches ~240 triangles up at 35-67% of the car's height —
// some other part of the model (upper body/roof trim, going by the height)
// happens to share this same small rectangle of texture space, which is a
// real property of how this particular asset was unwrapped, not a bug in
// the test. That's what painted big chunks of the roof/hood black instead
// of the chosen color on the first render. WHEEL_Y_MAX_FRAC is the fix:
// require BOTH the UV match AND a low 3D position — verified against the
// confirmed-wheel triangles, all four wheels cleanly separate out as four
// nearly-identical, tightly clustered groups once low-Y is required
// alongside the UV test; neither test alone was sufficient on its own.
const WHEEL_UV_MIN_U = 0.85;
const WHEEL_UV_MAX_U = 1.0;
const WHEEL_UV_MIN_V = 0.77;
const WHEEL_UV_MAX_V = 0.95;
const WHEEL_Y_MAX_FRAC = 0.35;
// Within that one wheel photo, rim (alloy) and tire (rubber) aren't
// separate UV islands — they're just light vs. dark pixels in the same
// image. Verified against the actual grayscale texture: luminance in this
// region is sharply bimodal (~82% of pixels under 64/255, ~10% over
// 192/255, almost nothing between) — a threshold anywhere in that gap
// reliably separates them. 0.4 (~102/255) sits safely in the middle of it.
const RIM_LUMINANCE_THRESHOLD = 0.4;

// Headlight and taillight UV regions — found the same verified way as the
// wheel: scanned the actual color texture (citroen-c4-diffuse.jpg, not the
// grayscale one, since hue is exactly the signal here) for pixels that are
// genuinely red (taillight) or genuinely near-white (headlight LEDs),
// cropped those regions out and looked at them to confirm, then
// cross-checked the matching triangles' 3D position to make sure each
// region isn't leaking into something else that happens to share it — the
// same check that caught the wheel UV box also matching upper-body panel.
// Two things that same red/white search also found and had to be excluded:
// a dense white patch that's the license plate, not a headlight (told
// apart by being centered — |x| tiny — while headlights sit at the two
// sides), and a second small red patch in the side-profile view that's the
// same physical taillights seen from a different camera angle, not a
// separate part (both land at the same 3D position, so both are included
// as one part below). Position guards mirror the wheel fix: UV match alone
// wasn't proven safe, UV + a plausible 3D box is.
const TAILLIGHT_UV_BOXES: [number, number, number, number][] = [
  [0.43, 0.84, 0.785, 0.902], // the rear light bar, seen in the rear-view photo
  [0.059, 0.098, 0.18, 0.219], // the same taillights, seen in the side-profile photo
];
const TAILLIGHT_Z_MAX = -1.3; // rear of car only
const TAILLIGHT_Y_MIN_FRAC = 0.5; // upper body — excludes the rear bumper below it

const HEADLIGHT_UV_BOXES: [number, number, number, number][] = [
  [0.0, 0.107, 0.79, 0.844], // left headlight cluster
  [0.293, 0.4, 0.79, 0.844], // right headlight cluster
];
const HEADLIGHT_Z_MIN = 1.3; // front of car only
const HEADLIGHT_Y_MIN_FRAC = 0.4; // headlight height band — excludes the lower bumper/fog lights
const HEADLIGHT_Y_MAX_FRAC = 0.75;

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// GLASS_Y_BAND: the source OBJ has no separate glass material or group — it's
// one merged mesh, one texture, windows included as just "dark pixels" like
// the tires and trim. There's no clean way to split by material because
// there is no material split to find. What the geometry DOES give us for
// free is shape: on a hatchback/crossover silhouette, the greenhouse
// (windshield/side glass/rear glass) occupies a predictable height band —
// above the beltline, below the roof panel — while wheels sit at the
// bottom and the grille/bumper/lights sit low at the front. So instead of
// reading pixels, this classifies each of the mesh's 6,112 triangles by
// its average height fraction (0 = ground, 1 = roofline) and routes
// "cabin-band" triangles to their own geometry for a real glass material,
// independent from the painted-body geometry. Tuned by eye against this
// specific model's proportions — a different car shape would need
// different bounds.
const GLASS_Y_MIN = 0.52;
const GLASS_Y_MAX = 0.95;

function splitBodyAndGlass(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const normal = geo.attributes.normal;
  const maxY = geo.boundingBox!.max.y;
  const body: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };
  const glass: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };
  const triCount = pos.count / 3;

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const avgY = (pos.getY(i0) + pos.getY(i0 + 1) + pos.getY(i0 + 2)) / 3;
    const frac = maxY > 0 ? avgY / maxY : 0;
    const bucket = frac > GLASS_Y_MIN && frac < GLASS_Y_MAX ? glass : body;
    for (let k = 0; k < 3; k++) {
      const i = i0 + k;
      bucket.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      bucket.uv.push(uv.getX(i), uv.getY(i));
      bucket.normal.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
  }

  const build = (b: typeof body) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normal, 3));
    return g;
  };
  return { bodyGeo: build(body), glassGeo: build(glass) };
}

// Draws the already-loaded texture image to an offscreen canvas once, so
// individual pixels can be read back — three.js Textures don't expose pixel
// data directly, only the GPU-bound version. Only needs to run once per
// texture load (memoized on `texture`), not per triangle.
function useLuminanceSampler(texture: THREE.Texture) {
  return useMemo(() => {
    const img = texture.image as HTMLImageElement | undefined;
    if (!img || !img.width) return () => 1; // not loaded yet — treat as "rim" so nothing silently vanishes as invisible tire
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return (u: number, v: number) => {
      const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)));
      const i = (y * width + x) * 4;
      return (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
    };
  }, [texture]);
}

// Carves wheel triangles (rim + tire) out of the body geometry using the
// verified UV region above, then further splits those into rim vs. tire by
// sampling actual pixel brightness at each triangle's UV — see the
// RIM_LUMINANCE_THRESHOLD comment. Everything outside the wheel UV box
// stays in bodyGeo untouched, so a bug here can only misclassify wheel
// pixels, never carve a hole in painted bodywork the way the earlier
// 3D-position attempt risked.
function splitWheels(geo: THREE.BufferGeometry, sampleLuminance: (u: number, v: number) => number) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const normal = geo.attributes.normal;
  const triCount = pos.count / 3;
  const body: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };
  const rim: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };
  const tire: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };

  geo.computeBoundingBox();
  const maxY = geo.boundingBox!.max.y;

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    let avgU = 0;
    let avgV = 0;
    let avgY = 0;
    for (let k = 0; k < 3; k++) {
      avgU += uv.getX(i0 + k);
      avgV += uv.getY(i0 + k);
      avgY += pos.getY(i0 + k);
    }
    avgU /= 3;
    avgV /= 3;
    avgY /= 3;

    const uvMatch = avgU >= WHEEL_UV_MIN_U && avgU <= WHEEL_UV_MAX_U && avgV >= WHEEL_UV_MIN_V && avgV <= WHEEL_UV_MAX_V;
    const lowEnough = maxY > 0 ? avgY / maxY < WHEEL_Y_MAX_FRAC : true;
    const isWheel = uvMatch && lowEnough;
    if (!isWheel) {
      for (let k = 0; k < 3; k++) {
        const i = i0 + k;
        body.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        body.uv.push(uv.getX(i), uv.getY(i));
        body.normal.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      }
      continue;
    }
    const bucket = sampleLuminance(avgU, avgV) >= RIM_LUMINANCE_THRESHOLD ? rim : tire;
    for (let k = 0; k < 3; k++) {
      const i = i0 + k;
      bucket.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      bucket.uv.push(uv.getX(i), uv.getY(i));
      bucket.normal.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
  }

  const build = (b: typeof body) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normal, 3));
    return g;
  };
  // rim/tire keep their UVs too — dropping them (an earlier version of this
  // did) threw away the actual photographed wheel detail (spokes, tread)
  // in favor of a flat solid color, which looked worse, not better. The
  // texture stays; only metalness/roughness differ per material below.
  return { bodyGeo: build(body), rimGeo: build(rim), tireGeo: build(tire) };
}

function inAnyBox(u: number, v: number, boxes: [number, number, number, number][]) {
  return boxes.some(([u0, u1, v0, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1);
}

// Carves headlight and taillight triangles out of the body geometry —
// same UV-region-plus-position-guard technique as splitWheels, applied to
// the boxes found and verified above. Runs after wheels are already
// removed, on what's left.
function splitLights(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const normal = geo.attributes.normal;
  const triCount = pos.count / 3;
  const body: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };
  const tail: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };
  const head: { pos: number[]; uv: number[]; normal: number[] } = { pos: [], uv: [], normal: [] };

  geo.computeBoundingBox();
  const maxY = geo.boundingBox!.max.y;

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    let avgU = 0;
    let avgV = 0;
    let avgY = 0;
    let avgZ = 0;
    for (let k = 0; k < 3; k++) {
      avgU += uv.getX(i0 + k);
      avgV += uv.getY(i0 + k);
      avgY += pos.getY(i0 + k);
      avgZ += pos.getZ(i0 + k);
    }
    avgU /= 3;
    avgV /= 3;
    avgY /= 3;
    avgZ /= 3;
    const yFrac = maxY > 0 ? avgY / maxY : 0;

    const isTail =
      inAnyBox(avgU, avgV, TAILLIGHT_UV_BOXES) && avgZ <= TAILLIGHT_Z_MAX && yFrac >= TAILLIGHT_Y_MIN_FRAC;
    const isHead =
      inAnyBox(avgU, avgV, HEADLIGHT_UV_BOXES) &&
      avgZ >= HEADLIGHT_Z_MIN &&
      yFrac >= HEADLIGHT_Y_MIN_FRAC &&
      yFrac <= HEADLIGHT_Y_MAX_FRAC;

    const bucket = isTail ? tail : isHead ? head : body;
    for (let k = 0; k < 3; k++) {
      const i = i0 + k;
      bucket.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      bucket.uv.push(uv.getX(i), uv.getY(i));
      bucket.normal.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
  }

  const build = (b: typeof body) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normal, 3));
    return g;
  };
  return { bodyGeo: build(body), tailGeo: build(tail), headGeo: build(head) };
}

// Loads the OBJ once, then rotates/scales/re-centers it into the scene's
// convention: bottom resting on y=0, horizontally centered, longest
// horizontal dimension normalized to TARGET_LENGTH. Orientation-agnostic
// about which raw axis is "length" vs. "width" — always takes whichever
// horizontal axis ends up longer after ROTATION_FIX, so a differently
// oriented model swap only needs that one constant changed. Then splits the
// result into body and glass geometries (see splitBodyAndGlass above).
function useCarGeometry() {
  const group = useLoader(OBJLoader, MODEL_URL);
  return useMemo(() => {
    const mesh = group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    if (!mesh) throw new Error(`${MODEL_URL}: no mesh found in loaded OBJ`);
    const geo = mesh.geometry.clone();
    geo.rotateX(ROTATION_FIX[0]);
    geo.rotateY(ROTATION_FIX[1]);
    geo.rotateZ(ROTATION_FIX[2]);
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const length = Math.max(size.x, size.z);
    const scale = length > 0 ? TARGET_LENGTH / length : 1;
    geo.scale(scale, scale, scale);
    geo.computeBoundingBox();
    const center = new THREE.Vector3();
    geo.boundingBox!.getCenter(center);
    geo.translate(-center.x, -geo.boundingBox!.min.y, -center.z);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const split = splitBodyAndGlass(geo);
    geo.dispose();
    return split;
  }, [group]);
}

// Approximate hotspot positions for the discovery-pulse animation, derived
// from the loaded model's own bounding box — 8 points spread across the
// body footprint and roofline so pulses still read as "coming from the car."
function useHotspots(geo: THREE.BufferGeometry) {
  return useMemo(() => {
    const box = geo.boundingBox ?? new THREE.Box3().setFromBufferAttribute(geo.attributes.position as THREE.BufferAttribute);
    const { min, max } = box;
    const midY = (min.y + max.y) / 2;
    const topY = max.y * 0.85;
    return [
      new THREE.Vector3(min.x, midY, min.z),
      new THREE.Vector3(min.x, midY, max.z),
      new THREE.Vector3(max.x, midY, min.z),
      new THREE.Vector3(max.x, midY, max.z),
      new THREE.Vector3(min.x * 0.3, topY, min.z),
      new THREE.Vector3(min.x * 0.3, topY, max.z),
      new THREE.Vector3(0, midY, 0),
      new THREE.Vector3(max.x * 0.5, midY, 0),
    ];
  }, [geo]);
}

const PULSE_POOL = 8;

// A small, fully procedural "studio softbox" rig — no HDRI file, no network
// fetch (this is a local diagnostic tool; an external asset dependency here
// would be a step backwards). Used as scene.environment so the clearcoat
// paint gets real reflections instead of flat direct-light highlights: a
// bright overhead panel, a cool-tinted panel and a warm-tinted panel on
// either side (the color split reads as reflected sky vs. reflected room
// light — a standard product-render trick), and a dark floor panel so the
// underside of the car doesn't pick up sky-bright reflections it wouldn't
// get in real life.
//
// Panel colors go above [1,1,1] on purpose — a plain white ([1,1,1]) plane
// reads as "a medium gray card" once baked into a PBR material's
// reflections, not "a light source" (real HDRIs' bright regions are many
// times over 1.0 for the same reason).
//
// Baked to a PMREM by hand (THREE.PMREMGenerator.fromScene) in a useEffect
// rather than drei's <Environment> wrapper — that swap was made while
// chasing a rendering bug specific to the GLB pipeline (GlbCarModel,
// currently dormant below) that never got fully root-caused or reliably
// reproduced/fixed; StlCarModel (the active model) never showed it, so this
// stays wired in as-is here. See the comment above GLB_URL for the
// abandoned GLB investigation, if that pipeline gets revisited.
function buildStudioEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
  // Everything outside the four panels used to be pure black, which made
  // true mirror materials (the chrome brand emblem, metalness 1) render
  // near-black from most angles — a mirror shows the environment, and the
  // environment was void. A medium-gray backdrop gives every reflection
  // ray something plausible to hit; the panels still dominate as the
  // bright/tinted light sources.
  scene.background = new THREE.Color(...STUDIO_LIGHTING.backdrop);
  const addPanel = (
    position: [number, number, number],
    rotation: [number, number, number],
    scale: [number, number, number],
    color: THREE.Color,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }),
    );
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    scene.add(mesh);
  };
  addPanel([0, 5, -2], [0, 0, 0], [8, 4, 1], new THREE.Color(...STUDIO_LIGHTING.overheadPanel));
  addPanel([5, 2, 3], [0, -Math.PI / 2.5, 0], [4, 3, 1], new THREE.Color(...STUDIO_LIGHTING.coolPanel));
  addPanel([-5, 1.5, 3], [0, Math.PI / 2.5, 0], [4, 3, 1], new THREE.Color(...STUDIO_LIGHTING.warmPanel));
  addPanel([0, -3, 0], [-Math.PI / 2, 0, 0], [10, 10, 1], new THREE.Color(STUDIO_LIGHTING.floorPanel));
  return scene;
}

function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    const envScene = buildStudioEnvScene();
    const renderTarget = pmremGenerator.fromScene(envScene, 0, 0.1, 100);
    scene.environment = renderTarget.texture;
    pmremGenerator.dispose();

    return () => {
      renderTarget.dispose();
      envScene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).geometry.dispose();
          ((o as THREE.Mesh).material as THREE.Material).dispose();
        }
      });
      scene.environment = null;
    };
  }, [gl, scene]);
  return null;
}

// --- A dense, print-oriented STL. Dormant, not dead — kept in place now
// that GlbCarModel (below) is active again, in case a properly UV-mapped
// high-poly source shows up later and this becomes worth revisiting. ---
// This mesh has 87x the triangle count of the GLB (535,858 vs. 6,112) and
// shows no visible faceting up close, at the cost of everything a real
// UV-mapped texture makes possible: no wheel-spoke detail, no head/
// tail-light glow, no photographic surface detail. STL as a format can't
// carry any of that — there's no UV data to key off of, full stop. Its own
// headlight/taillight decals (LightDecal, below) were built to compensate
// for exactly that gap; they're moot while GlbCarModel is active, since the
// GLB carries its lights baked into its own real texture already.
//
// Colors below are sampled directly from reference images the user
// provided (a wheel closeup, tire closeup, mirror closeup, windshield
// closeup, and front/side/rear car renders) — not eyeballed. Body paint
// and glass are real pixel averages from clean, representative patches in
// those images (glass specifically sampled from the window as it actually
// looks installed on the car, not from the isolated glass product shot,
// which reads much lighter due to backlight through the panel that an
// opaque render can't reproduce). Wheels/tires/lights are left as part of
// the body — isolating them needs the same UV-region technique that worked
// on the OBJ, and this STL has no UV to do that with; the pure-3D-position
// version of that attempt is the one that produced leaks/holes earlier in
// this same file, twice, not worth a third attempt without real UV data.
//
// One piece of material differentiation still applies here regardless:
// glass. GLASS_Y_MIN/MAX-style height-banding is pure 3D position, no UV
// required, so it transfers directly — windows shouldn't be the same color
// as the body even without a texture to read them from.
const STL_URL = "/models-preview/print-quality.stl";
const STL_ROTATION_FIX: [number, number, number] = [-Math.PI / 2, 0, 0]; // this export is Z-up, like the first STL we tried
// Tuned by measuring actual triangle-count proportions on this specific
// mesh, not carried over from the OBJ's GLASS_Y_MIN/MAX — this STL has
// different overall proportions (likely from being remeshed/"repaired" for
// printing), and the OBJ's band swept up 34% of all triangles here, clearly
// too much for a hatchback's actual window area (real greenhouse glass is
// roughly 10-15% of surface). This band measures ~12.5%.
const STL_GLASS_Y_MIN = 0.72;
const STL_GLASS_Y_MAX = 0.88;

function useStlBodyAndGlass() {
  const raw = useLoader(STLLoader, STL_URL);
  return useMemo(() => {
    const geo = raw.clone();
    geo.rotateX(STL_ROTATION_FIX[0]);
    geo.rotateY(STL_ROTATION_FIX[1]);
    geo.rotateZ(STL_ROTATION_FIX[2]);
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const length = Math.max(size.x, size.z);
    const scale = length > 0 ? TARGET_LENGTH / length : 1;
    geo.scale(scale, scale, scale);
    geo.computeBoundingBox();
    const center = new THREE.Vector3();
    geo.boundingBox!.getCenter(center);
    geo.translate(-center.x, -geo.boundingBox!.min.y, -center.z);
    geo.computeVertexNormals();
    geo.computeBoundingBox();

    const pos = geo.attributes.position;
    const normal = geo.attributes.normal;
    const maxY = geo.boundingBox!.max.y;
    const body: { pos: number[]; normal: number[] } = { pos: [], normal: [] };
    const glass: { pos: number[]; normal: number[] } = { pos: [], normal: [] };
    const triCount = pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = t * 3;
      const avgY = (pos.getY(i0) + pos.getY(i0 + 1) + pos.getY(i0 + 2)) / 3;
      const frac = maxY > 0 ? avgY / maxY : 0;
      const bucket = frac > STL_GLASS_Y_MIN && frac < STL_GLASS_Y_MAX ? glass : body;
      for (let k = 0; k < 3; k++) {
        const i = i0 + k;
        bucket.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        bucket.normal.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      }
    }
    geo.dispose();

    const build = (b: typeof body) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normal, 3));
      return g;
    };
    return { bodyGeo: build(body), glassGeo: build(glass) };
  }, [raw]);
}

// Headlight/taillight decals — flat, pre-cut PNG pairs (transparent
// background) placed as planes at the car's front/rear, not projected onto
// the curved body. Projection was considered and deliberately not
// attempted: it needs precise per-triangle position data on this mesh (the
// same rigorous analysis that worked for the OBJ, which has none of that
// data here) plus interactive camera alignment this environment can't do,
// and a misaligned projection reads as more broken than no attempt at all.
// A flat decal sidesteps both problems — it only needs a position and a
// size, not curvature-matching. Position was still found the same
// evidence-based way as everything else this session: the actual
// front/rear-corner triangles in the plausible headlight/taillight height
// band (28-55% of car height) were measured directly on this specific STL,
// not guessed — see the console-verified numbers this was built from
// (front corner ~y0.53/|x|0.57/z1.63, rear corner ~y0.53/|x|0.59/z-1.66).
//
// The source PNGs are studio product shots of BOTH the left and right
// assembly side by side with a wide transparent gap between them (a
// dramatic 3/4 angle, not a flat-on shot) — using either file whole as one
// decal stretched it across the full car width and read as a giant wing
// floating off the body. Fixed by pre-cropping each file (see
// public/models-preview/decals/*_L.png / *_R.png) down to just its own
// assembly's bounding box, then placing the L/R halves separately at each
// corner instead of one oversized decal spanning the car's centerline.
const LIGHT_DECALS: {
  url: string;
  x: number;
  z: number;
  y: number;
  width: number;
  aspect: number; // native px width / px height of that crop
  facing: "front" | "rear";
  emissiveIntensity: number;
}[] = [
  // z values are the mesh's own real surface depth at that x/y (measured
  // directly off the STL, not guessed) plus a small ~0.03 margin so the
  // plane sits just proud of the body instead of embedded inside it —
  // embedding it was the previous bug: at x=0.46 the actual surface is at
  // z=1.731, and a decal z lower than that renders fully hidden behind the
  // opaque body mesh.
  {
    url: "/models-preview/decals/headlight_L.png",
    x: -0.46,
    z: 1.76,
    y: 0.53,
    width: 0.34,
    aspect: 674 / 1008,
    facing: "front",
    emissiveIntensity: 0.55,
  },
  {
    url: "/models-preview/decals/headlight_R.png",
    x: 0.46,
    z: 1.76,
    y: 0.53,
    width: 0.34,
    aspect: 668 / 974,
    facing: "front",
    emissiveIntensity: 0.55,
  },
  {
    url: "/models-preview/decals/taillight_L.png",
    x: -0.48,
    z: -1.78,
    y: 0.53,
    width: 0.36,
    aspect: 724 / 977,
    facing: "rear",
    emissiveIntensity: 0.9,
  },
  {
    url: "/models-preview/decals/taillight_R.png",
    x: 0.48,
    z: -1.78,
    y: 0.53,
    width: 0.36,
    aspect: 715 / 974,
    facing: "rear",
    emissiveIntensity: 0.9,
  },
];

function LightDecal({
  url,
  x,
  y,
  z,
  width,
  aspect,
  facing,
  emissiveIntensity,
}: {
  url: string;
  x: number;
  y: number;
  z: number;
  width: number;
  aspect: number;
  facing: "front" | "rear";
  emissiveIntensity: number;
}) {
  const texture = useLoader(THREE.TextureLoader, url);
  const mat = useMemo(() => {
    const tex = texture.clone();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      emissiveMap: tex,
      emissive: VEHICLE_MATERIALS.carModelNeutral, // white multiply base — the decal's own texture supplies the real lamp color/glow
      emissiveIntensity,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
  }, [texture, emissiveIntensity]);
  useEffect(() => () => mat.dispose(), [mat]);

  const height = width / aspect;

  return (
    <mesh position={[x, y, z]} rotation={[0, facing === "rear" ? Math.PI : 0, 0]}>
      <planeGeometry args={[width, height]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

export function StlCarModel({ status, reduced }: { status: SceneStatus; reduced: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const { bodyGeo, glassGeo } = useStlBodyAndGlass();
  const bodyMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        // Averaged from the hood-panel closeup and side-view door panel —
        // both landed within a few RGB values of each other (~#8f939c and
        // ~#a0a0a2), a real silver-gray metallic, not a guess.
        color: VEHICLE_MATERIALS.stlBodyPaint,
        metalness: 0.35,
        roughness: 0.4,
        clearcoat: 0.55,
        clearcoatRoughness: 0.2,
        envMapIntensity: 0.85,
      }),
    [],
  );
  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        // Sampled from the side-view's actual window (as installed, tinted,
        // in shadow) — the isolated windshield closeup reads much lighter
        // (~#8d969c) because it's backlit through the panel in that shot,
        // which doesn't represent how the glass looks opaque on the car.
        color: VEHICLE_MATERIALS.stlGlass,
        metalness: 0.05,
        roughness: 0.08,
        clearcoat: 0.6,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.3,
      }),
    [],
  );
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);
  useEffect(() => () => glassMat.dispose(), [glassMat]);
  useEffect(
    () => () => {
      bodyGeo.dispose();
      glassGeo.dispose();
    },
    [bodyGeo, glassGeo],
  );

  useFrame((_, delta) => {
    if (!group.current || reduced) return;
    const speed = status === "connecting" ? 0.85 : status === "connected" ? 0.16 : 0;
    group.current.rotation.y += speed * delta;
  });

  return (
    <group ref={group}>
      <mesh geometry={bodyGeo} material={bodyMat} castShadow receiveShadow />
      <mesh geometry={glassGeo} material={glassMat} />
      <Suspense fallback={null}>
        {LIGHT_DECALS.map((d) => (
          <LightDecal key={d.url} {...d} />
        ))}
      </Suspense>
    </group>
  );
}

// --- The active model: Citroen_C4_2022_interior_doors_windows_v4_1.glb,
// picked from a data audit of all seven generated GLB variants (see the
// per-primitive dump this choice was made from: identical 6,112-triangle
// exterior across every file, so the differentiators are what each adds on
// top). v4_1 wins because every one of its 37 meshes has a material (the
// v5 files contain stray material-less meshes that render default-white —
// the "breaking parts"), it adds a dark interior (seats, dash, satin
// accents) that translucent glass can reveal, and its glass is already
// neutral alpha-blend with NO KHR_materials_transmission (the extension
// that produced black voids earlier this session).
//
// public/models/citroen-c4.glb is NOT that file verbatim — it's the output
// of scripts/repair-c4-glb.mjs, which fixes the AI segmentation's
// triangle-level misassignments (279 of 480 "lamp" triangles were actually
// body panels scattered across the car — the "triangle cuts" bug; see the
// script header for the full diagnosis and the atlas-as-ground-truth
// method). Re-run that script if the base model is ever swapped.
//
// THE FACETING FIX — and a correction of an earlier misdiagnosis: the
// "scrambled camo mosaic" this pipeline showed before was never shader
// corruption. Every exterior primitive in these files is fully unwelded
// (index count == vertex count — verified: each vertex belongs to exactly
// one triangle), so every triangle carries its own flat normal. Under
// clearcoat + the high-contrast studio environment, each flat facet
// mirrors a different environment panel → per-triangle light/dark
// patchwork. That's also why removing scene.environment "fixed" it
// (nothing left to reflect) and why the untouched photo-textured file
// looked fine (texture detail masked the facets). The actual fix is
// toCreasedNormals below: it groups vertices by position (no pre-welding
// needed), smooths normals across edges shallower than the crease angle,
// and keeps genuinely hard edges sharp.
const GLB_URL = "/models/citroen-c4.glb";
// 45°: curvature steps on this low-poly body (roof, fenders, tire
// circumference — all well under 45° between neighbors) get smoothed;
// real hard edges (wheel-arch lips, hood cut) stay creased.
const CREASE_ANGLE = Math.PI / 4;
// Alloy wheels are high-metalness, which means they have almost no diffuse
// response — they read however the environment reflects off them, nothing
// more. Wheels sit low, near StudioEnvironment's deliberately dim floor
// panel, so without a boost they read as nearly black regardless of the
// metalness/roughness values themselves.
const WHEEL_METAL_ENV_INTENSITY = 1.8;

// Per-material tuning applied at runtime. Deliberate hybrid: the BODY is
// clean neutral PBR with no photo texture (explicit user direction: "the
// texture was never good" — the baked-photo body look is dead), but lamps,
// alloys, and tires DO get the original photo atlas back — those are
// exactly the parts where photographic detail reads as realism (LED strips
// in the lenses, alloy spokes, tire tread) and where flat colors read as
// toy-like. Safe to do now, and only now, because repair-c4-glb.mjs
// stripped all the misassigned body triangles out of those meshes — every
// remaining triangle samples genuine lamp/wheel imagery, so no orange
// paint bleeds through. Only the six exterior materials are touched;
// v4_1's interior materials (Interior Charcoal, Seat Fabric, Satin Accent,
// Instrument Screens, B-Pillar, Door Panel Gap) ship with sensible
// untextured values and are left as authored.
function tuneGlbMaterial(mat: THREE.MeshPhysicalMaterial, atlas: THREE.Texture) {
  switch (mat.name) {
    case "Neutral Silver Automotive Paint":
      mat.map = null;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbPaint); // neutral silver, from the generator's own untextured "neutral clean" variant
      mat.metalness = 0.15;
      mat.roughness = 0.3;
      mat.clearcoat = 0.8;
      mat.clearcoatRoughness = 0.08;
      break;
    case "Clean Neutral Automotive Glass":
      // Real translucency (alpha blend, not transmission) — viable here,
      // unlike every earlier attempt, because v4_1 actually has an interior
      // behind the glass to see: dark seats/dash showing through tinted
      // glass is what makes it read as glass instead of painted panel.
      mat.map = null;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbGlass);
      mat.transparent = true;
      mat.opacity = 0.58; // tinted enough that the placeholder interior reads as dark shapes, not gray blobs
      mat.depthWrite = false; // standard for alpha glass — avoids self-occlusion artifacts among the window panes
      mat.side = THREE.DoubleSide;
      mat.roughness = 0.09;
      mat.clearcoat = 0.8;
      mat.clearcoatRoughness = 0.06;
      mat.envMapIntensity = 1.2;
      break;
    case "Black Exterior Plastic":
      mat.map = null;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbPlastic);
      mat.roughness = 0.6;
      mat.side = THREE.DoubleSide; // same inside-out-cluster guard as the lamps (grille inserts)
      break;
    case "Tire Rubber":
      // Real tread photo from the atlas; the multiply color keeps it near-black.
      mat.map = atlas;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbTire);
      mat.metalness = 0;
      mat.roughness = 0.9;
      break;
    case "High-Fidelity Alloy and Chrome":
      // Real alloy-spoke photo from the atlas.
      mat.map = atlas;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbAlloyChrome);
      mat.metalness = 0.5;
      mat.roughness = 0.35;
      mat.envMapIntensity = WHEEL_METAL_ENV_INTENSITY;
      break;
    case "High-Fidelity Lamp Lenses":
      // The atlas's own lamp imagery (LED strips, red taillight bar) under
      // a glossy lens, with the same emissive-via-shared-texture technique
      // proven on the OBJ pipeline: emissiveMap = the same photo, so only
      // pixels that are genuinely bright in the source (the LEDs
      // themselves) glow — the dark housing around them stays dark.
      mat.map = atlas;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbLampLens);
      mat.emissiveMap = atlas;
      mat.emissive.setRGB(...VEHICLE_MATERIALS.glbLampLens);
      mat.emissiveIntensity = 0.5;
      mat.roughness = 0.15;
      mat.clearcoat = 1;
      mat.clearcoatRoughness = 0.05;
      mat.envMapIntensity = 1.2;
      mat.transparent = false;
      mat.opacity = 1;
      // Some lamp clusters in this mesh are wound inside-out (per-part
      // winding is internally consistent, but a whole cluster can face
      // inward) — single-sided rendering culls those from head-on, leaving
      // a see-through hole into the interior. DoubleSide renders them
      // regardless, and three.js flips the normal for back-facing
      // fragments so the lighting stays correct.
      mat.side = THREE.DoubleSide;
      break;
  }
}

// The original photo atlas from the source asset — used ONLY on lamps,
// alloys, and tires (see tuneGlbMaterial). Same file the repair script uses
// as segmentation ground truth.
const ATLAS_URL = "/models/citroen-c4-diffuse.jpg";

export function GlbCarModel({ status, reduced }: { status: SceneStatus; reduced: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const gltf = useLoader(GLTFLoader, GLB_URL);
  const atlasRaw = useLoader(THREE.TextureLoader, ATLAS_URL);

  // Clone per-instance (Overview and DiscoveryFlow can both have a scene
  // mounted at once) — Object3D.clone() shares geometry/material references
  // by default, which would let one instance's material tweaks affect the
  // other's; materials are cloned explicitly below so each instance is
  // independent.
  const scene = useMemo(() => {
    // Plain TextureLoader defaults to flipY=true; glTF UVs (this mesh's)
    // expect flipY=false — corrected once here, on a per-instance clone.
    const atlas = atlasRaw.clone();
    atlas.flipY = false;
    atlas.wrapS = THREE.RepeatWrapping;
    atlas.wrapT = THREE.RepeatWrapping;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 8;
    atlas.needsUpdate = true;

    const cloned = gltf.scene.clone(true);
    cloned.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // The faceting fix (see the header comment above GLB_URL). Cloning
        // first keeps the useLoader-cached original pristine; the creased
        // copy is what the disposal effect below owns and frees.
        mesh.geometry = toCreasedNormals(mesh.geometry.clone(), CREASE_ANGLE);
        const mat = (mesh.material as THREE.MeshPhysicalMaterial).clone();
        tuneGlbMaterial(mat, atlas);
        mesh.material = mat;
      }
    });

    // Normalize scale/position at runtime rather than trusting the file's
    // own transform — this specific file's exporter baked an unexpected
    // node scale on export. Rather than chase exactly why, this measures
    // the actual rendered bounding box and corrects for whatever it turns
    // out to be — the same approach already used for the OBJ and STL
    // sources above, and more robust than trusting any given exporter's
    // unit math to come out as expected.
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const k = Math.max(size.x, size.z) > 0 ? TARGET_LENGTH / Math.max(size.x, size.z) : 1;
    cloned.scale.setScalar(k);
    cloned.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    cloned.updateMatrixWorld(true);

    return cloned;
  }, [gltf, atlasRaw]);

  useEffect(
    () => () => {
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).geometry.dispose();
          ((o as THREE.Mesh).material as THREE.Material).dispose();
        }
      });
    },
    [scene],
  );

  useFrame((_, delta) => {
    if (!group.current || reduced) return;
    const speed = status === "connecting" ? 0.85 : status === "connected" ? 0.16 : 0;
    group.current.rotation.y += speed * delta;
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

// Exported (though currently unused) rather than left as a plain local
// function — it's dormant, not dead, per the comment above StlCarModel;
// `export` keeps the type-checker's noUnusedLocals from flagging it.
export function CarModel({ status, color, reduced }: { status: SceneStatus; color: string | null; reduced: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const { bodyGeo: rawBodyGeo, glassGeo } = useCarGeometry();
  const hotspots = useHotspots(rawBodyGeo);
  const texture = useLoader(THREE.TextureLoader, TEXTURE_URL);
  const sampleLuminance = useLuminanceSampler(texture);
  const { bodyGeo: withWheelsGeo, rimGeo, tireGeo } = useMemo(
    () => splitWheels(rawBodyGeo, sampleLuminance),
    [rawBodyGeo, sampleLuminance],
  );
  const { bodyGeo, tailGeo, headGeo } = useMemo(() => splitLights(withWheelsGeo), [withWheelsGeo]);

  // Shared, color-space-corrected clone of the loaded texture — body, rim,
  // and tire all read the real photographed detail (paint highlights, spoke
  // pattern, tread) off this same source; only body's `color` multiply
  // varies per-material below (rim/tire show their true photographed look
  // always, never tinted by the chosen paint color).
  const baseTex = useMemo(() => {
    const t = texture.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [texture]);

  const bodyMat = useMemo(() => {
    // Physical, not Standard: clearcoat is what actually reads as "car
    // paint" — a low-metalness base coat (metalness stays low; real
    // automotive paint isn't a metal, even "metallic" finishes are only
    // lightly metallic) under a thin glossy lacquer layer
    // (clearcoat/clearcoatRoughness) that catches sharp reflections
    // independent of the base color. metalness: 0.55 here initially made
    // every color read dull/muddy — non-metals get their color from diffuse
    // reflection, and high metalness suppresses that in favor of a
    // specular-only, chrome-like response, which is wrong for paint and
    // fights the whole point of letting you pick a real color.
    // clearcoat/envMapIntensity dialed back from their first pass — full
    // clearcoat + a bright studio rig read as mirror-polished rather than
    // factory paint; the reference photos show real but soft highlights,
    // not a hard specular streak across the whole panel.
    return new THREE.MeshPhysicalMaterial({
      map: baseTex,
      color: color ?? DEFAULT_TINT,
      metalness: 0.15,
      roughness: 0.45,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.7,
    });
  }, [baseTex, color]);

  // Real glass, not a dark texture patch — but deliberately opaque, not
  // `transmission`-based. Tried transmission first: it requires an internal
  // render-to-texture pass, and with no modeled interior behind the glass
  // it produced a black jagged void where the glass geometry sat instead of
  // anything glass-like — not worth the fragility for a window with nothing
  // to see through anyway. A window's "glass-ness" reads mostly from how
  // sharply it reflects the world, not from true see-through transparency —
  // dark tint + near-zero roughness + a strong envMap does that reliably.
  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: VEHICLE_MATERIALS.carModelGlass,
        metalness: 0.05,
        roughness: 0.08,
        clearcoat: 0.6,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.3,
      }),
    [],
  );

  // Rim and tire: same real texture as the body (spokes, tread pattern —
  // the actual photographed detail, not a flat color; an earlier version of
  // this dropped the texture in favor of a solid fill and lost that detail,
  // which looked worse, not better), color left at white so the paint pick
  // never tints them, differing only in how each responds to light — rim
  // bright and metallic, tire dark and matte.
  const rimMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        map: baseTex,
        color: VEHICLE_MATERIALS.carModelNeutral,
        metalness: 0.7,
        roughness: 0.35,
        envMapIntensity: 0.9,
      }),
    [baseTex],
  );
  const tireMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: baseTex,
        color: VEHICLE_MATERIALS.carModelNeutral,
        metalness: 0,
        roughness: 0.95,
      }),
    [baseTex],
  );

  // Head/tail lights: same texture (keeps the real LED-segment/lens detail
  // instead of a flat glow patch), but with an emissiveMap reading off that
  // same texture — only the pixels that are actually bright in the source
  // photo (the LED elements themselves) produce light; the black housing
  // plastic around them, which lives in the same UV region, stays dark
  // because it's dark in the texture too. Never tinted by the chosen paint
  // color, same as glass/wheels — a red car doesn't get red headlights.
  const tailMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: baseTex,
        color: VEHICLE_MATERIALS.carModelNeutral,
        emissiveMap: baseTex,
        emissive: VEHICLE_MATERIALS.tailEmissive,
        emissiveIntensity: 1.1,
        roughness: 0.3,
        metalness: 0,
      }),
    [baseTex],
  );
  const headMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: baseTex,
        color: VEHICLE_MATERIALS.carModelNeutral,
        emissiveMap: baseTex,
        emissive: VEHICLE_MATERIALS.headEmissive,
        emissiveIntensity: 0.7,
        roughness: 0.25,
        metalness: 0.1,
      }),
    [baseTex],
  );

  useEffect(() => () => bodyMat.dispose(), [bodyMat]);
  useEffect(() => () => glassMat.dispose(), [glassMat]);
  useEffect(() => () => rimMat.dispose(), [rimMat]);
  useEffect(() => () => tireMat.dispose(), [tireMat]);
  useEffect(() => () => tailMat.dispose(), [tailMat]);
  useEffect(() => () => headMat.dispose(), [headMat]);
  useEffect(
    () => () => {
      rawBodyGeo.dispose();
      withWheelsGeo.dispose();
      bodyGeo.dispose();
      glassGeo.dispose();
      rimGeo.dispose();
      tireGeo.dispose();
      tailGeo.dispose();
      headGeo.dispose();
    },
    [rawBodyGeo, withWheelsGeo, bodyGeo, glassGeo, rimGeo, tireGeo, tailGeo, headGeo],
  );

  const pulses = useRef(
    Array.from({ length: PULSE_POOL }, () => ({ active: false, t: 0, pos: new THREE.Vector3() })),
  );
  const pulseMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const spawnTimer = useRef(0);

  useFrame((_, delta) => {
    if (!group.current) return;

    if (!reduced) {
      const speed = status === "connecting" ? 0.85 : status === "connected" ? 0.16 : 0;
      group.current.rotation.y += speed * delta;
    }

    if (!reduced && status === "connecting") {
      spawnTimer.current -= delta;
      if (spawnTimer.current <= 0) {
        spawnTimer.current = 0.16 + Math.random() * 0.14;
        const slot = pulses.current.find((p) => !p.active);
        if (slot) {
          slot.active = true;
          slot.t = 0;
          slot.pos.copy(hotspots[Math.floor(Math.random() * hotspots.length)]);
        }
      }
    }

    pulses.current.forEach((p, i) => {
      const mesh = pulseMeshes.current[i];
      if (!mesh) return;
      if (!p.active) {
        mesh.visible = false;
        return;
      }
      p.t += delta;
      const dur = 0.75;
      if (p.t >= dur) {
        p.active = false;
        mesh.visible = false;
        return;
      }
      const k = p.t / dur;
      const scale = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
      mesh.visible = true;
      mesh.position.copy(p.pos);
      mesh.scale.setScalar(0.05 + scale * 0.09);
      (mesh.material as THREE.MeshBasicMaterial).opacity = scale * 0.95;
    });
  });

  return (
    <group ref={group}>
      <mesh geometry={bodyGeo} material={bodyMat} castShadow receiveShadow />
      <mesh geometry={glassGeo} material={glassMat} />
      <mesh geometry={rimGeo} material={rimMat} castShadow />
      <mesh geometry={tireGeo} material={tireMat} castShadow />
      <mesh geometry={tailGeo} material={tailMat} />
      <mesh geometry={headGeo} material={headMat} />

      {pulses.current.map((_, i) => (
        <mesh key={i} ref={(m) => (pulseMeshes.current[i] = m)} visible={false}>
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={PULSE_COLOR} transparent opacity={0} />
        </mesh>
      ))}
    </group>
  );
}


// --- Brand emblem model — the scalable answer to "thousands of cars". ---
// A per-car 3D body model can't be sourced/verified at fleet scale (see the
// GLB saga above), but a brand identity can: the VIN's first three chars
// (WMI) name the manufacturer for every car that ever connects, and this
// renders a spinning chrome emblem from it. Brands with modeled geometry
// (see the EMBLEMS registry in ./emblems) get the real mark; every other
// brand automatically gets a chrome nameplate badge with its name — zero
// per-car work, uniform quality. The C4 GlbCarModel above stays dormant as
// the bespoke-model option.
function BrandEmblemModel({
  vin,
  status,
  reduced,
  brandKeyOverride,
}: {
  vin: string | null | undefined;
  status: SceneStatus;
  reduced: boolean;
  brandKeyOverride?: string | null;
}) {
  const group = useRef<THREE.Group>(null!);
  const brand = useMemo(() => brandFromVin(vin), [vin]);
  // brandKeyOverride bypasses the VIN lookup entirely (dev only, see
  // VehicleScene below) — the only way to preview a brand that has no WMI
  // entry at all, like saic and vauxhall (see brand.ts and
  // docs/workflows/3d-logos/decisions-build.md for why those two are
  // deliberately unmapped). ?vin= alone can't reach either, since there is
  // no VIN prefix that resolves to them.
  const Emblem = brandKeyOverride ? (EMBLEMS[brandKeyOverride] ?? null) : ((brand && EMBLEMS[brand.key]) ?? null);

  useFrame((_, delta) => {
    if (!group.current || reduced) return;
    const speed = status === "connecting" ? 0.85 : status === "connected" ? 0.16 : 0;
    group.current.rotation.y += speed * delta;
  });

  return (
    <group ref={group}>
      {Emblem ? <Emblem /> : <NameplateEmblem name={brand?.name ?? "AUTO"} />}
    </group>
  );
}

export function VehicleScene({
  status,
  vin,
  brandKey,
  caption,
  className,
  background = "dark",
}: {
  status: SceneStatus;
  vin?: string | null;
  /** Show a brand by its emblem-registry key instead of deriving it from
   *  the VIN (the login screen cycles through recognised marques). */
  brandKey?: string | null;
  /** Caption text bottom-left. Omit for the status default; null hides it. */
  caption?: string | null;
  /** Sizing/shape of the frame; defaults to the full-width card. */
  className?: string;
  /** The card behind the chrome:
   *  - "dark" (default) — the warm dust field with its own filled ground,
   *    the identity-moment look used on the connect gate and first-connect
   *    discovery, where the frame IS the surface (nothing else behind it).
   *  - "light" — the same dust field recolored into the accent ramp, for
   *    the emblem's appearances on recurring dashboard surfaces (Overview,
   *    Vehicle) sitting in an otherwise paper-white layout, where the dark
   *    ground reads as a jarring hole rather than a moment (2026-08-30).
   *  - "dust" — dust dots only, transparent canvas, no ground fill. For a
   *    frame that sits directly on a surface that already has its own
   *    background (the login panel's purple + glow) — filling here too
   *    painted a visibly different rectangle on top of it instead of one
   *    continuous panel (2026-08-30).
   *  - "none" — no particle layer at all; the emblem floats over whatever
   *    sits behind the frame with nothing added.
   *  Only the flat 2D backdrop changes — the chrome material's own
   *  reflection environment (StudioEnvironment's offscreen PMREM bake) is
   *  independent of this and looks the same in every case. */
  background?: "dark" | "light" | "dust" | "none";
}) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  // Dev-only override so any brand's emblem can be previewed by URL without
  // a real connected VIN, e.g. ?vin=VF1AAAAA000000000 for Renault. Inert
  // (and tree-shaken away) in production builds since import.meta.env.DEV
  // is false there.
  const vinOverride = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("vin") : null;
  // Dev-only, separate from vinOverride above: previews a brand directly by
  // its EMBLEMS registry key, e.g. ?brand=vauxhall. The only way to preview
  // a brand with no WMI entry (saic, vauxhall) — there is no VIN prefix
  // that could reach either through vinOverride alone.
  const brandKeyOverride = brandKey ?? (import.meta.env.DEV ? new URLSearchParams(window.location.search).get("brand") : null);
  const captionText = caption === undefined
    ? status === "disconnected" ? "Idle" : status === "connecting" ? "Discovering modules…" : "Live"
    : caption;

  return (
    <div className={cn("relative h-64 w-full overflow-hidden rounded-md", className)}>
      {/* Ambient-dust ground — same starfield technique as the
          knowledge-base note (3-Resources/starfield-header/technique.md),
          tuned far slower (ambient dust, not a hyperspace field). Two
          tones, not just an on/off: "dark" is the warm-toned original
          (the identity-moment screens), "light" recolors the same dust
          into the accent ramp for a paper-white dashboard context
          (2026-08-30) — see PARTICLE_PALETTE_LIGHT for why it's a second
          named palette rather than one dust color swapped in place. Sits
          behind the WebGL canvas; the canvas has no opaque background of
          its own (gl alpha:true, no <color attach>) so this shows through.
          Does not touch the chrome material's reflection environment at
          all — that comes from StudioEnvironment's own offscreen PMREM
          bake, entirely separate from this visible layer. */}
      {background !== "none" && (
        <EmblemStarfield tone={background === "light" ? "light" : "dark"} fill={background !== "dust"} />
      )}
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [4.4, 2.6, 4.4], fov: 30 }}
        gl={{
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
        }}
      >
        {/* Direct lights now just define shape (key + soft fill) — the
            StudioEnvironment below carries the actual reflections and most
            of the ambient fill, so these are deliberately lower-intensity
            than before to avoid double-counting light and blowing out. */}
        <directionalLight position={[3, 4, 2]} intensity={0.6} />
        <directionalLight position={[-3, 2, -2]} intensity={0.2} />
        {/* Rim light: positioned behind/low, catches the silhouette edge
            (roofline, shoulder line) as a bright thin highlight — the
            product-photography trick that makes an object look "lit," not
            just "visible." This is most of what reads as premium in the
            Faraday case photos: a crisp edge highlight against a dark body,
            not the flat/broad fill lighting a plain 3-light rig gives you. */}
        <directionalLight position={[-2, 1.5, -4]} intensity={0.9} color={STUDIO_LIGHTING.rimLight} />
        <StudioEnvironment />
        {/* Brand emblem is the active model (scalable to any connected
            car); GlbCarModel above is the bespoke C4 — swap back here if
            per-car models return. */}
        {/* EmblemFallback, not CarModelFallback: a car-body brick sitting
            where a badge is about to appear read as a loading bug, not a
            loading state (2026-08-30). preloadEmblem (called wherever a
            brand becomes known — Login's carousel, ConnectGate,
            DiscoveryFlow) keeps this from showing at all in the common
            case; this is only the cold-paint fallback. */}
        <Suspense fallback={<EmblemFallback />}>
          <BrandEmblemModel vin={vinOverride ?? vin} status={status} reduced={reduced} brandKeyOverride={brandKeyOverride} />
        </Suspense>
        <ContactShadows position={[0, 0.01, 0]} opacity={0.32} scale={7} blur={2.2} far={2} />
      </Canvas>
      {captionText && (
        <p
          className={cn(
            "pointer-events-none absolute bottom-2 left-3 z-10 text-[10px] uppercase tracking-wide",
            background === "light" ? "text-neutral-500" : "text-white/45",
          )}
        >
          {captionText}
        </p>
      )}
    </div>
  );
}
