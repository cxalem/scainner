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
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useLoader } from "@react-three/fiber";

export const EMBLEM_CHROME = {
  color: "#f4f6f8",
  metalness: 0.9,
  roughness: 0.22, // enough blur that reflections read as brushed chrome, not a hard mirror of the 4-panel rig
  clearcoat: 0.6,
  clearcoatRoughness: 0.1,
  envMapIntensity: 1.5,
} as const;

// Vertical center of the emblem — floats where the car's body used to be so
// the existing camera framing and ContactShadows keep working unchanged.
// (0.95 initially, which cropped the mark at the card's top edge — the
// camera aims at the origin, so a compact object wants to sit lower than a
// car-height one.)
export const EMBLEM_Y = 0.32;

// Shared extrude settings for every hand-authored emblem (per patterns/3d.md
// rule 8 / the plan's shared-constraints block).
export const EXTRUDE_SETTINGS = {
  depth: 0.15,
  bevelEnabled: true,
  bevelThickness: 0.025,
  bevelSize: 0.025,
  bevelSegments: 3,
} as const;

// Same recipe, plus curveSegments for shapes with arcs (rings): the default
// (12) makes a circle look visibly faceted at card size, so brands built
// from THREE.Shape.absarc use this instead.
const EXTRUDE_SETTINGS_CURVED = {
  ...EXTRUDE_SETTINGS,
  curveSegments: 24,
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
function shapesFromSvg(svgMarkup: string): THREE.Shape[] {
  const svgData = new SVGLoader().parse(svgMarkup);
  return svgData.paths.flatMap((path) => SVGLoader.createShapes(path));
}

// Builds extruded geometry from real SVG markup, normalized to this
// module's shared depth/bevel proportions regardless of the source SVG's
// own coordinate scale. The source is in SVG space (y grows downward);
// `.scale(scale, -scale, scale)` both normalizes size and flips to three's
// y-up convention in one step.
function svgEmblemGeometry(svgMarkup: string, targetWidth: number): THREE.ExtrudeGeometry {
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

// Volvo "iron mark" ring, traced from Wikimedia Commons
// File:Volvo-Iron-Mark-Black.svg (the VOLVO wordmark paths from that file
// are dropped, too fine to read at badge size, the same call already made
// for BMW/VW in research.md section 2). That file's own "arrow" path is
// also dropped: rendered, it is a small boxy zigzag confined to one
// corner, not a diagonal shaft with a point — checked two independent
// Commons uploads of this mark and both trace the same odd shape there, so
// this looks like a real quality gap in the source rather than a one-off
// bad file. The arrow is hand-authored below instead, a plain diagonal
// shaft and triangular head is well inside what hand-Shape draws
// accurately, unlike the ring's gapped-annulus outline.
const VOLVO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250"><path d="M227.9,54l-12.7,12.7c10.9,16.8,17.2,36.8,17.2,58.3c0,59.3-48.1,107.4-107.4,107.4S17.6,184.3,17.6,125 S65.7,17.6,125,17.6c21.6,0,41.6,6.4,58.4,17.3l12.7-12.7C176,8.2,151.4,0,125,0C56,0,0,56,0,125s56,125,125,125s125-56,125-125 C250,98.6,241.8,74.1,227.9,54z"/></svg>`;

// Volvo: traced from the real mark, see VOLVO_SVG above (ring with a gap
// for the arrow, plus the arrow — wordmark dropped).
function VolvoEmblem() {
  const ringGeo = useMemo(() => svgEmblemGeometry(VOLVO_SVG, 1.55), []);
  const arrowGeo = useMemo(() => {
    // Mars/iron-symbol arrow: a shaft crossing well past the ring's own
    // center, plus a triangular head extending past its edge, at the
    // classic 45 degrees. Origin (0,0) is the ring's center, so this shape
    // is built directly against that, not centered on itself.
    const shaftLen = 1.0, shaftThick = 0.14;
    const headLen = 0.35, headWidth = 0.39;
    const halfShaft = shaftThick / 2;
    const halfHead = headWidth / 2;
    const startX = -0.14; // starts inside the ring, past its center, so the shaft visibly crosses the band

    const arrow = new THREE.Shape();
    arrow.moveTo(startX, halfShaft);
    arrow.lineTo(startX + shaftLen, halfShaft);
    arrow.lineTo(startX + shaftLen, halfHead);
    arrow.lineTo(startX + shaftLen + headLen, 0);
    arrow.lineTo(startX + shaftLen, -halfHead);
    arrow.lineTo(startX + shaftLen, -halfShaft);
    arrow.lineTo(startX, -halfShaft);
    arrow.closePath();

    const g = new THREE.ExtrudeGeometry(arrow, EXTRUDE_SETTINGS_CURVED);
    g.rotateZ(Math.PI / 4);
    // svgEmblemGeometry centers the ring on all three axes via .center();
    // this shape was extruded from z=0 (unaffected by the rotateZ above),
    // so it needs the matching z shift by hand to sit at the same depth.
    g.translate(0, 0, -EXTRUDE_SETTINGS_CURVED.depth / 2);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial(EMBLEM_CHROME), []);
  useEffect(
    () => () => {
      ringGeo.dispose();
      arrowGeo.dispose();
      mat.dispose();
    },
    [ringGeo, arrowGeo, mat],
  );
  return (
    <group position={[0, EMBLEM_Y, 0]}>
      <mesh geometry={ringGeo} material={mat} castShadow />
      <mesh geometry={arrowGeo} material={mat} castShadow />
    </group>
  );
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
    ctx.fillStyle = "#ffffff"; // multiplies to the chrome base color untouched
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#181a1e";
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

function normalizeStlGeometry(raw: THREE.BufferGeometry, targetWidth: number): THREE.BufferGeometry {
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
function StlEmblem({ url, targetWidth = 2.0, extraRotationY = 0 }: { url: string; targetWidth?: number; extraRotationY?: number }) {
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

function stlEmblem(file: string, opts?: { targetWidth?: number; extraRotationY?: number }): React.ComponentType {
  return function BoundStlEmblem() {
    return <StlEmblem url={`/emblems/stl/${file}`} {...opts} />;
  };
}

// Registry: brand.key -> modeled emblem component. Anything not listed here
// falls back to NameplateEmblem in VehicleScene. Adding a new brand is just
// a new component plus a new entry, no changes needed elsewhere.
export const EMBLEMS: Record<string, React.ComponentType> = {
  volvo: VolvoEmblem,
  citroen: stlEmblem("citroen.stl"),
  audi: stlEmblem("audi.stl"),
  bmw: stlEmblem("bmw.stl"),
  mercedes: stlEmblem("mercedes.stl"),
  peugeot: stlEmblem("peugeot.stl"),
  renault: stlEmblem("renault.stl"),
  skoda: stlEmblem("skoda.stl"),
  toyota: stlEmblem("toyota.stl"),
  volkswagen: stlEmblem("volkswagen.stl"),
  dacia: stlEmblem("dacia.stl"),
  hyundai: stlEmblem("hyundai.stl"),
  kia: stlEmblem("kia.stl"),
  opel: stlEmblem("opel.stl"),
  fiat: stlEmblem("fiat.stl"),
  ford: stlEmblem("ford.stl"),
  geely: stlEmblem("geely.stl"),
  byd: stlEmblem("byd.stl"),
  chery: stlEmblem("chery.stl"),
  tesla: stlEmblem("tesla.stl"),
  seat: stlEmblem("seat.stl"),
  // saic and vauxhall have no brand.ts WMI entry on purpose — see brand.ts
  // and decisions-build.md. SAIC Motor doesn't retail cars under its own
  // name (badges as MG/Roewe/Maxus instead), and Vauxhall shares Opel's W0L
  // prefix with no reliable way to tell them apart from the VIN alone. Both
  // stay reachable via the dev ?vin= override so the geometry is ready the
  // moment either gets a confident WMI.
  saic: stlEmblem("saic.stl"),
  vauxhall: stlEmblem("vauxhall.stl"),
};
