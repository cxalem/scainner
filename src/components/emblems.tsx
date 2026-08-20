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
};
