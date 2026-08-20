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

// Renault: diamond ring (the current "losange" mark, simplified to a flat
// two-shape outline). Outer rhombus 0.95 wide x 1.10 tall, inner rhombus
// hole is offset 0.14 along each axis below; because that offset is along
// the axes rather than perpendicular to the rhombus edge, the rendered
// band thickness is actually about 0.106, not 0.14. The band is still
// constant width and reads fine at card size (confirmed by review), so no
// geometry change — this comment exists so a future brand does not copy
// the 0.14 constant expecting a 0.14 band.
function RenaultEmblem() {
  const geo = useMemo(() => {
    const outerHalfW = 0.475, outerHalfH = 0.55;
    const band = 0.14;
    // Inner rhombus scaled down from the outer one by roughly `band` in
    // each direction, measured along each axis, so the band reads as a
    // constant visual thickness all the way around.
    const innerHalfW = outerHalfW - band;
    const innerHalfH = outerHalfH - band * (outerHalfH / outerHalfW);

    const outer = new THREE.Shape();
    outer.moveTo(0, outerHalfH);
    outer.lineTo(outerHalfW, 0);
    outer.lineTo(0, -outerHalfH);
    outer.lineTo(-outerHalfW, 0);
    outer.closePath();

    const hole = new THREE.Path();
    hole.moveTo(0, innerHalfH);
    hole.lineTo(innerHalfW, 0);
    hole.lineTo(0, -innerHalfH);
    hole.lineTo(-innerHalfW, 0);
    hole.closePath();
    outer.holes.push(hole);

    const g = new THREE.ExtrudeGeometry(outer, EXTRUDE_SETTINGS);
    g.center();
    return g;
  }, []);
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

// Volvo: circle with a diagonal arrow (the Mars/iron symbol) starting at
// the ring's outer edge, pointing to the upper right at 45 degrees.
function VolvoEmblem() {
  const geo = useMemo(() => {
    const outerR = 0.48, band = 0.09;
    const innerR = outerR - band;

    const ring = new THREE.Shape();
    ring.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const ringHole = new THREE.Path();
    ringHole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    ring.holes.push(ringHole);

    // Arrow built axis-aligned along +x (shaft then arrowhead), then the
    // whole geometry is rotated 45 degrees so the math stays simple.
    const shaftLen = 0.22, shaftThick = 0.09;
    const headLen = 0.18, headWidth = 0.22;
    const halfShaft = shaftThick / 2;
    const halfHead = headWidth / 2;
    // Shaft starts just inside the ring's outer edge so there is no gap,
    // and runs outward past the ring.
    const startX = outerR - 0.03;

    const arrow = new THREE.Shape();
    arrow.moveTo(startX, halfShaft);
    arrow.lineTo(startX + shaftLen, halfShaft);
    arrow.lineTo(startX + shaftLen, halfHead);
    arrow.lineTo(startX + shaftLen + headLen, 0);
    arrow.lineTo(startX + shaftLen, -halfHead);
    arrow.lineTo(startX + shaftLen, -halfShaft);
    arrow.lineTo(startX, -halfShaft);
    arrow.closePath();

    const shapes = [ring, arrow];
    const g = new THREE.ExtrudeGeometry(shapes, EXTRUDE_SETTINGS_CURVED);
    // Rotate ring + arrow together so the arrow points upper-right at 45
    // degrees. Rotating the ring has no visible effect since it is
    // circular, so this is simpler than rotating just the arrow's points.
    g.rotateZ(Math.PI / 4);
    g.center();
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial(EMBLEM_CHROME), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} position={[0, EMBLEM_Y, 0]} castShadow />;
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
