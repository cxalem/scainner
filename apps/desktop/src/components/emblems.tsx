// Brand emblem geometry — moved out of VehicleScene.tsx to keep that file
// from growing further as more brands get modeled marks. Everything here
// follows the same recipe as the original Citroën chevrons: a THREE.Shape
// outline (or array of shapes/holes), extruded with a small bevel, rendered
// in the shared EMBLEM_CHROME material, centered on the origin, and
// disposed on unmount. See docs/workflows/patterns/3d.md rules 7-9 for the
// constraints this module is built against (camera framing, chrome
// material behavior, per-emblem triangle budget).
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useLoader } from "@react-three/fiber";
import { CHROME_MATERIAL, NAMEPLATE_TEXTURE } from "@/theme";

// Re-exported under its original name — sourced from ../theme/rendering.ts
// (CHROME_MATERIAL) now, see that file for the full material-physics
// reasoning. Kept as EMBLEM_CHROME here since docs (patterns/3d.md,
// 3d-logos/*.md) reference it by this name.
export const EMBLEM_CHROME = CHROME_MATERIAL;

// Vertical center of the emblem — floats where the car's body used to be so
// the existing camera framing and ContactShadows keep working unchanged.
// (0.95 initially, which cropped the mark at the card's top edge — the
// camera aims at the origin, so a compact object wants to sit lower than a
// car-height one.)
export const EMBLEM_Y = 0.32;

// Preloads a modeled brand's GLB before its emblem actually needs to
// render — see EMBLEMS below for the file path convention. Call this the
// moment a brand becomes known (a VIN resolves, a carousel is about to
// land on it) and BrandEmblemModel's later Suspense for that same brand
// resolves instantly instead of showing EmblemFallback: useLoader caches
// by URL, and useLoader.preload runs the exact same fetch+parse ahead of
// time, off the render path. No-op for a key with no modeled emblem (the
// nameplate path never suspends, nothing to preload).
export function preloadEmblem(key: string | null | undefined): void {
  if (!key || !(key in EMBLEMS)) return;
  useLoader.preload(GLTFLoader, `/emblems/glb/${key}.glb`);
}

// The Suspense fallback while a modeled emblem's GLB is loading — nothing.
// No mesh at all, not even a plain placeholder plaque: the first attempt
// here (a flat chrome plaque, a step up from the old car-body-shaped
// CarModelFallback it replaced) was STILL reported as "a brick" on a true
// cold start (2026-08-30) — a large GLB (several are multi-MB; a genuinely
// fresh app launch has nothing preloaded yet to race against) takes real,
// visible time to parse no matter what shape stands in for it, and ANY
// placeholder geometry risks reading as "the wrong logo" or "a loading
// bug" the way the very first version did. Nothing can't look wrong: the
// dust field (still rendered behind this) plus the caption text
// ("Discovering modules…"/"Reading identity") already carry the loading
// signal on their own, the same restrained pattern ConnectGate's own
// pre-VIN idle state already uses (rings + text, no 3D object). In the
// common case this doesn't matter anyway — preloadEmblem (called wherever
// a brand becomes known) keeps the GLB warm ahead of need, and
// MODELED_EMBLEM_KEYS leads with the smallest file so even the true
// first-paint window is as short as it can be.
export function EmblemFallback() {
  return null;
}

// Shared extrude settings for every hand-authored emblem (per patterns/3d.md
// rule 8 / the plan's shared-constraints block).
export const EXTRUDE_SETTINGS = {
  depth: 0.15,
  bevelEnabled: true,
  bevelThickness: 0.025,
  bevelSize: 0.025,
  bevelSegments: 3,
} as const;

// Brands whose real mark is a curve or a self-overlapping outline (Renault's
// doubled diamond lines, Volvo's ring-with-gap) are traced from the real
// vector logo instead of hand-walked point by point — a hand-authored
// approximation of a curve is a guess, tracing the actual path is not. The
// source markup is the brand's real published mark (Wikimedia Commons,
// vetted as below the copyright threshold for simple geometric marks — see
// docs/workflows/3d-logos/research.md section 4), trimmed to just the shape
// the badge needs (wordmarks/lettering dropped, illegible at card size) and
// embedded here so parsing needs no network access at runtime.
//
// The style attribute is set inline on each <path> rather than left in a
// <style> block: SVGLoader parses a detached DOM, which does not resolve
// CSS class rules, so a class-based fill-rule would silently fall back to
// the wrong winding and fill in the doubled-line gap.
export function shapesFromSvg(svgMarkup: string): THREE.Shape[] {
  const svgData = new SVGLoader().parse(svgMarkup);
  return svgData.paths.flatMap((path) => SVGLoader.createShapes(path));
}

// Builds extruded geometry from real SVG markup, normalized to this
// module's shared depth/bevel proportions regardless of the source SVG's
// own coordinate scale. The source is in SVG space (y grows downward);
// `.scale(scale, -scale, scale)` both normalizes size and flips to three's
// y-up convention in one step.
//
// Currently unreferenced in EMBLEMS below: this traced Renault and Volvo
// (see decisions-build.md addenda 1-2) back when neither had a real STL or
// GLB yet. Both have since arrived as real files and were swapped over —
// kept, not deleted, dormant infrastructure for the next brand that shows
// up as a 2D reference with no 3D file, exported so noUnusedLocals doesn't
// force a choice between deleting working code and a silenced warning.
export function svgEmblemGeometry(svgMarkup: string, targetWidth: number): THREE.ExtrudeGeometry {
  const shapes = shapesFromSvg(svgMarkup);
  const box = new THREE.Box2();
  for (const shape of shapes) {
    for (const p of shape.getPoints(12)) box.expandByPoint(p);
  }
  const rawWidth = box.max.x - box.min.x;
  const scale = targetWidth / rawWidth;
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: EXTRUDE_SETTINGS.depth / scale,
    bevelEnabled: true,
    bevelThickness: EXTRUDE_SETTINGS.bevelThickness / scale,
    bevelSize: EXTRUDE_SETTINGS.bevelSize / scale,
    bevelSegments: EXTRUDE_SETTINGS.bevelSegments,
    curveSegments: 24,
  });
  g.scale(scale, -scale, scale);
  g.center();
  return g;
}

// Fallback for any brand without modeled emblem geometry: a chrome
// nameplate slab with the brand name on its face (drawn to a canvas — no
// font asset needed). The back stays blank chrome, like a real badge.
export function NameplateEmblem({ name }: { name: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = NAMEPLATE_TEXTURE.baseFill; // multiplies to the chrome base color untouched
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = NAMEPLATE_TEXTURE.textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 150;
    do {
      ctx.font = `700 ${size}px system-ui, Arial, sans-serif`;
      size -= 6;
    } while (ctx.measureText(name).width > 920 && size > 40);
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 8);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, [name]);
  const mats = useMemo(() => {
    const chrome = new THREE.MeshPhysicalMaterial(EMBLEM_CHROME);
    const face = new THREE.MeshPhysicalMaterial({ ...EMBLEM_CHROME, map: texture });
    // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z (back)
    return [chrome, chrome, chrome, chrome, face, chrome];
  }, [texture]);
  useEffect(
    () => () => {
      texture.dispose();
      mats.forEach((m) => m.dispose());
    },
    [texture, mats],
  );
  return (
    <mesh position={[0, EMBLEM_Y, 0]} material={mats} castShadow>
      <boxGeometry args={[2.6, 0.6, 0.16]} />
    </mesh>
  );
}

// Real 3D badges, sourced from STL files (see public/emblems/stl and
// docs/workflows/3d-logos/decisions-build.md for provenance). Each is an
// actual sculpted medallion, not a flat extruded outline — a step up in
// fidelity from the hand-authored/SVG-traced shapes above, and the reason
// those are being retired brand by brand as real files arrive.
//
// Currently unreferenced in EMBLEMS below: every brand that had an STL got
// upgraded to a real GLB (see the GlbEmblem section further down) once one
// arrived, and every brand since has arrived as GLB directly. Kept, not
// deleted — dormant infrastructure for the next brand that shows up as
// STL-only, exported so the compiler's noUnusedLocals doesn't force a
// choice between deleting working code and carrying a silenced warning.
//
// These files come from at least two different export pipelines (the
// source batch mixes ASCII and binary STL headers), so this does not
// assume one fixed up-axis convention. Every emblem here is a flat medallion
// (60mm mark, ~2.4mm extrusion per the source README), so whichever axis
// has the smallest bounding-box extent is the depth axis, regardless of
// which way the source tool exported it — auto-detected per file instead of
// a per-brand rotation constant.
//
// STL is a facet soup by construction: three unshared vertices per
// triangle, so naive shading is flat "camo" faceting on any curved surface
// (patterns/3d.md rule 1, the same failure mode the C4 GLB hit). Every STL
// load here runs toCreasedNormals unconditionally, not just the ones that
// looked wrong when tested, since a future re-export could reintroduce it
// silently.
const STL_CREASE_ANGLE = Math.PI / 4;

export function normalizeStlGeometry(raw: THREE.BufferGeometry, targetWidth: number): THREE.BufferGeometry {
  let geo = raw.clone(); // useLoader caches the parsed geometry across instances (patterns/3d.md rule 9) — never mutate it directly
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);

  const extents: Array<[number, "x" | "y" | "z"]> = [
    [size.x, "x"],
    [size.y, "y"],
    [size.z, "z"],
  ];
  extents.sort((a, b) => a[0] - b[0]);
  const depthAxis = extents[0][1];
  // A 90-degree axis swap is a proper rotation (determinant +1), so this
  // never mirrors the design — only which of the two faces ends up
  // pointing which way, not a left-right flip of the artwork on either face.
  if (depthAxis === "x") geo.rotateY(Math.PI / 2);
  else if (depthAxis === "y") geo.rotateX(Math.PI / 2);

  geo.computeBoundingBox();
  const size2 = new THREE.Vector3();
  geo.boundingBox!.getSize(size2);
  const width = Math.max(size2.x, size2.y);
  const scale = width > 0 ? targetWidth / width : 1;
  geo.scale(scale, scale, scale);
  geo.center();

  geo = toCreasedNormals(geo, STL_CREASE_ANGLE);
  return geo;
}

// extraRotationY handles the one thing bounding-box math can't decide: which
// of the medallion's two faces ends up facing the camera's side of the spin.
// Wrong-facing does not corrupt the model, it just shows an asymmetric mark
// (a letterform, a lion) mirrored for half of every rotation — caught by
// looking at each brand in the running app, not guessed up front.
export function StlEmblem({ url, targetWidth = 2.3, extraRotationY = 0 }: { url: string; targetWidth?: number; extraRotationY?: number }) {
  const raw = useLoader(STLLoader, url);
  const geo = useMemo(() => normalizeStlGeometry(raw, targetWidth), [raw, targetWidth]);
  const mat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ ...EMBLEM_CHROME, side: THREE.DoubleSide }),
    [],
  );
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return (
    <mesh geometry={geo} material={mat} position={[0, EMBLEM_Y, 0]} rotation={[0, extraRotationY, 0]} castShadow />
  );
}

export function stlEmblem(file: string, opts?: { targetWidth?: number; extraRotationY?: number }): React.ComponentType {
  return function BoundStlEmblem() {
    return <StlEmblem url={`/emblems/stl/${file}`} {...opts} />;
  };
}

// GLB emblem: a full scene (multiple mesh nodes, e.g. Audi's four separate
// ring meshes) rather than one BufferGeometry, so normalization happens at
// the Object3D level — rotate/scale/center the whole group — instead of
// the STL path's per-geometry buffer transforms. GLB ships real vertex
// normals from its own export pipeline (unlike STL's per-facet soup), so
// this does not run toCreasedNormals; if a future GLB turns out faceted,
// that's the first thing to add back; see patterns/3d.md rule 1.
//
// The source file's own material is discarded in favor of the shared
// EMBLEM_CHROME, same call already made for every STL brand: one
// consistent chrome look across all 20+ badges beats each one carrying
// whatever its own export happened to bake in.
function GlbEmblem({ url, targetWidth = 2.3 }: { url: string; targetWidth?: number }) {
  const gltf = useLoader(GLTFLoader, url);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ ...EMBLEM_CHROME, side: THREE.DoubleSide }), []);
  const root = useMemo(() => {
    // useLoader caches the parsed gltf across instances (patterns/3d.md
    // rule 9) — clone the scene graph before mutating any of it.
    const scene = gltf.scene.clone(true);
    scene.updateMatrixWorld(true);

    const box0 = new THREE.Box3().setFromObject(scene);
    const size0 = new THREE.Vector3();
    box0.getSize(size0);
    const extents: Array<[number, "x" | "y" | "z"]> = [
      [size0.x, "x"],
      [size0.y, "y"],
      [size0.z, "z"],
    ];
    extents.sort((a, b) => a[0] - b[0]);
    const depthAxis = extents[0][1];
    if (depthAxis === "x") scene.rotateY(Math.PI / 2);
    else if (depthAxis === "y") scene.rotateX(Math.PI / 2);
    scene.updateMatrixWorld(true);

    const box1 = new THREE.Box3().setFromObject(scene);
    const size1 = new THREE.Vector3();
    box1.getSize(size1);
    const width = Math.max(size1.x, size1.y);
    const scale = width > 0 ? targetWidth / width : 1;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    scene.position.sub(center);

    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).material = mat;
        (child as THREE.Mesh).castShadow = true;
      }
    });
    return scene;
  }, [gltf, mat, targetWidth]);

  useEffect(
    () => () => {
      mat.dispose();
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).geometry.dispose();
      });
    },
    [root, mat],
  );

  // Centering is already baked into `root`'s own position (set above,
  // relative to its own bounding box) — the EMBLEM_Y offset goes on a
  // wrapping group instead of `root` itself, so a JSX position prop here
  // can't clobber that.
  return (
    <group position={[0, EMBLEM_Y, 0]}>
      <primitive object={root} />
    </group>
  );
}

function glbEmblem(file: string, opts?: { targetWidth?: number }): React.ComponentType {
  return function BoundGlbEmblem() {
    return <GlbEmblem url={`/emblems/glb/${file}`} {...opts} />;
  };
}

// Registry: brand.key -> modeled emblem component. Anything not listed here
// falls back to NameplateEmblem in VehicleScene. Adding a new brand is just
// a new component plus a new entry, no changes needed elsewhere.
export const PREVIEW_ONLY_EMBLEMS = ["saic", "vauxhall", "cupra"] as const;

export const EMBLEMS: Record<string, React.ComponentType> = {
  volvo: glbEmblem("volvo.glb"),
  citroen: glbEmblem("citroen.glb"),
  audi: glbEmblem("audi.glb"),
  bmw: glbEmblem("bmw.glb"),
  mercedes: glbEmblem("mercedes.glb"),
  peugeot: glbEmblem("peugeot.glb"),
  renault: glbEmblem("renault.glb"),
  skoda: glbEmblem("skoda.glb"),
  toyota: glbEmblem("toyota.glb"),
  volkswagen: glbEmblem("volkswagen.glb"),
  dacia: glbEmblem("dacia.glb"),
  hyundai: glbEmblem("hyundai.glb"),
  kia: glbEmblem("kia.glb"),
  opel: glbEmblem("opel.glb"),
  fiat: glbEmblem("fiat.glb"),
  ford: glbEmblem("ford.glb"),
  geely: glbEmblem("geely.glb"),
  byd: glbEmblem("byd.glb"),
  chery: glbEmblem("chery.glb"),
  tesla: glbEmblem("tesla.glb"),
  seat: glbEmblem("seat.glb"),
  // saic, vauxhall, and cupra have no brand.ts WMI entry on purpose — see
  // brand.ts and decisions-build.md. SAIC Motor doesn't retail cars under
  // its own name (badges as MG/Roewe/Maxus instead). Vauxhall and Cupra
  // are softer calls, corrected 2026-08-21 after a full-table audit
  // (docs/workflows/3d-logos/wmi-audit.md): the "Vauxhall shares Opel's
  // W0L" and "Cupra shares Seat's VSS" claims are plausible and likely
  // true, not authoritatively confirmed — real sources disagree on
  // whether Vauxhall has its own distinct codes instead, and no primary
  // source settles the Seat/Cupra claim either. Either way there's no
  // confident WMI for either brand today, so the practical result is the
  // same: all three stay reachable via the dev ?brand= override so the
  // geometry is ready the moment any of them gets one. The list is
  // exported so brand.test.ts can assert every other EMBLEMS key is a
  // wmi.json key (a modeled mark nothing can reach is a bug).
  saic: glbEmblem("saic.glb"),
  vauxhall: glbEmblem("vauxhall.glb"),
  cupra: glbEmblem("cupra.glb"),
};
