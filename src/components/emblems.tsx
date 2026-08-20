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

// Renault 2021 "Renaulution" mark: the diamond redrawn as two thin doubled
// outlines rather than one solid band (source: Wikimedia Commons
// File:Renault 2021.svg — a single compound path, evenodd fill, whose two
// nested diamond loops are what create the doubled-line look and the gap
// between them).
const RENAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 954 1255"><path style="fill-rule:evenodd;" d="M953.5,626.91 l-334.98,-626.91 h-94.51 L190.07,626.91 l215.27,403.24 l47.25,-89.26 L285.63,626.91 l285.63,-536.6 l286.68,536.6 l-333.93,627.96 h94.51 L953.5,626.91 zM762.38,626.91 L548.16,224.72 l-48.3,89.26 l168.02,312.93 l-286.68,537.65 L94.51,626.91 l334.98,-626.91 h-95.56 L0,626.91 l333.93,627.96 h94.51 L762.38,626.91 z"/></svg>`;

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

// One chevron of the Citroën mark: a "^" band of constant vertical
// thickness. Outline walks the top edge up to the apex and back down, then
// the bottom edge in reverse.
export function chevronShape(halfWidth: number, rise: number, thickness: number, yOffset: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-halfWidth, yOffset);
  s.lineTo(0, yOffset + rise);
  s.lineTo(halfWidth, yOffset);
  s.lineTo(halfWidth, yOffset - thickness);
  s.lineTo(0, yOffset + rise - thickness);
  s.lineTo(-halfWidth, yOffset - thickness);
  s.closePath();
  return s;
}

export function CitroenEmblem() {
  const geo = useMemo(() => {
    const half = 0.66, rise = 0.4, t = 0.22, gap = 0.11;
    const g = new THREE.ExtrudeGeometry(
      [chevronShape(half, rise, t, 0), chevronShape(half, rise, t, -(t + gap))],
      EXTRUDE_SETTINGS,
    );
    g.center();
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial(EMBLEM_CHROME), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} position={[0, EMBLEM_Y, 0]} castShadow />;
}

// Renault: traced from the real mark, see RENAULT_SVG above.
function RenaultEmblem() {
  const geo = useMemo(() => svgEmblemGeometry(RENAULT_SVG, 0.95), []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial(EMBLEM_CHROME), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} position={[0, EMBLEM_Y, 0]} castShadow />;
}

// Mercedes-Benz: three-pointed star inside a ring. Ring is an annulus
// (outer absarc + inner-circle hole); star is three elongated rhombus
// spokes from near the center to the ring's inner edge, at 90/210/330
// degrees (pointing up, and down-left/down-right).
function MercedesEmblem() {
  const geo = useMemo(() => {
    const outerR = 0.55, band = 0.07;
    const innerR = outerR - band;

    const ring = new THREE.Shape();
    ring.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const ringHole = new THREE.Path();
    ringHole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    ring.holes.push(ringHole);

    // Each spoke: a thin quadrilateral from near dead center out to the
    // ring's inner edge, at the given angle. A small offset from center
    // keeps the three spokes from all meeting at one exact point (which
    // can produce degenerate triangles).
    const spokeWidth = 0.13;
    const spokeLen = innerR + 0.02; // slight overlap into the ring so there is no visible seam
    function spokeShape(angleDeg: number): THREE.Shape {
      const a = (angleDeg * Math.PI) / 180;
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const perp = new THREE.Vector2(-dir.y, dir.x);
      const halfW = spokeWidth / 2;
      const base = dir.clone().multiplyScalar(0.02);
      const tip = dir.clone().multiplyScalar(spokeLen);
      const p1 = base.clone().add(perp.clone().multiplyScalar(halfW));
      const p2 = base.clone().add(perp.clone().multiplyScalar(-halfW));
      const s = new THREE.Shape();
      s.moveTo(p1.x, p1.y);
      s.lineTo(tip.x, tip.y);
      s.lineTo(p2.x, p2.y);
      s.closePath();
      return s;
    }

    const shapes = [ring, spokeShape(90), spokeShape(210), spokeShape(330)];
    const g = new THREE.ExtrudeGeometry(shapes, EXTRUDE_SETTINGS_CURVED);
    g.center();
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial(EMBLEM_CHROME), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} position={[0, EMBLEM_Y, 0]} castShadow />;
}

// Volvo: traced from the real mark, see VOLVO_SVG above (ring with a gap
// for the arrow, plus the arrow — wordmark dropped).
function VolvoEmblem() {
  const ringGeo = useMemo(() => svgEmblemGeometry(VOLVO_SVG, 0.96), []);
  const arrowGeo = useMemo(() => {
    // Mars/iron-symbol arrow: a shaft crossing well past the ring's own
    // center, plus a triangular head extending past its edge, at the
    // classic 45 degrees. Origin (0,0) is the ring's center, so this shape
    // is built directly against that, not centered on itself.
    const shaftLen = 0.62, shaftThick = 0.08;
    const headLen = 0.22, headWidth = 0.24;
    const halfShaft = shaftThick / 2;
    const halfHead = headWidth / 2;
    const startX = -0.08; // starts inside the ring, past its center, so the shaft visibly crosses the band

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

// One arm of the Opel "Blitz": a bar of constant height `halfT * 2` from
// the flat end (xBase, at the ring's inner edge) to xKink, then tapering on
// both edges to a single point at (xTip, yTip). yTip is pulled in toward 0
// relative to yBase so the point angles toward the ring's center rather
// than staying level, matching the real mark's diagonal read (source:
// Wikimedia Commons "Logo Opel-1987.svg" — two overlapping pointed bars
// with a visible gap between their tips, not one continuous band).
function blitzArmShape(xBase: number, xKink: number, xTip: number, yBase: number, yTip: number, halfT: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(xBase, yBase + halfT);
  s.lineTo(xKink, yBase + halfT);
  s.lineTo(xTip, yTip);
  s.lineTo(xKink, yBase - halfT);
  s.lineTo(xBase, yBase - halfT);
  s.closePath();
  return s;
}

// Opel: circle crossed by a horizontal lightning bolt (the "Blitz"). Two
// separate pointed arms — not one continuous band, see blitzArmShape —
// offset above and below center so their tips cross with a gap between
// them, the way the real mark's zigzag notch reads.
function OpelEmblem() {
  const geo = useMemo(() => {
    const outerR = 0.52, band = 0.08;
    const innerR = outerR - band;

    const ring = new THREE.Shape();
    ring.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const ringHole = new THREE.Path();
    ringHole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    ring.holes.push(ringHole);

    const halfT = 0.065;
    const yTop = 0.14, yBot = -0.14;
    // Top arm: flat from the left inner edge, tapers to a point past
    // center on the right. Bottom arm mirrors it, flat from the right
    // inner edge, tapering past center on the left.
    const topArm = blitzArmShape(-innerR, -0.02, 0.3, yTop, 0.02, halfT);
    const bottomArm = blitzArmShape(innerR, 0.02, -0.3, yBot, -0.02, halfT);

    const shapes = [ring, topArm, bottomArm];
    const g = new THREE.ExtrudeGeometry(shapes, EXTRUDE_SETTINGS_CURVED);
    g.center();
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial(EMBLEM_CHROME), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} position={[0, EMBLEM_Y, 0]} castShadow />;
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

// Registry: brand.key -> modeled emblem component. Anything not listed here
// falls back to NameplateEmblem in VehicleScene. Adding a new brand is just
// a new component plus a new entry, no changes needed elsewhere.
export const EMBLEMS: Record<string, React.ComponentType> = {
  citroen: CitroenEmblem,
  renault: RenaultEmblem,
  mercedes: MercedesEmblem,
  volvo: VolvoEmblem,
  opel: OpelEmblem,
};
