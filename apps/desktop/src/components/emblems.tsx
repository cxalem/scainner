import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useLoader } from "@react-three/fiber";
import { CHROME_MATERIAL, NAMEPLATE_TEXTURE } from "@/theme";

export const EMBLEM_CHROME = CHROME_MATERIAL;

export const EMBLEM_Y = 0.32;

export function preloadEmblem(key: string | null | undefined): void {
  if (!key || !(key in EMBLEMS)) return;
  useLoader.preload(GLTFLoader, `/emblems/glb/${key}.glb`);
}

export function EmblemFallback() {
  return null;
}

export const EXTRUDE_SETTINGS = {
  depth: 0.15,
  bevelEnabled: true,
  bevelThickness: 0.025,
  bevelSize: 0.025,
  bevelSegments: 3,
} as const;

export function shapesFromSvg(svgMarkup: string): THREE.Shape[] {
  const svgData = new SVGLoader().parse(svgMarkup);
  return svgData.paths.flatMap((path) => SVGLoader.createShapes(path));
}

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

export function NameplateEmblem({ name }: { name: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = NAMEPLATE_TEXTURE.baseFill;
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

const STL_CREASE_ANGLE = Math.PI / 4;

export function normalizeStlGeometry(raw: THREE.BufferGeometry, targetWidth: number): THREE.BufferGeometry {
  let geo = raw.clone();
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

function GlbEmblem({ url, targetWidth = 2.3 }: { url: string; targetWidth?: number }) {
  const gltf = useLoader(GLTFLoader, url);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ ...EMBLEM_CHROME, side: THREE.DoubleSide }), []);
  const root = useMemo(() => {
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

export const PREVIEW_ONLY_EMBLEMS = [
  "saic",
  "vauxhall",
  "cupra",
  "ferrari",
  "livan",
  "lucid",
  "maxus",
  "mg",
  "omoda",
  "rivian",
] as const;

export const EMBLEMS: Record<string, React.ComponentType> = {
  // Suzuki stays excluded because its source geometry is torn.
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
  // BYD's glyphs are mirrored in the source art; see public/emblems/README.md.
  byd: glbEmblem("byd.glb"),
  chery: glbEmblem("chery.glb"),
  tesla: glbEmblem("tesla.glb"),
  seat: glbEmblem("seat.glb"),
  "land-rover": glbEmblem("land-rover.glb"),
  porsche: glbEmblem("porsche.glb"),
  jaguar: glbEmblem("jaguar.glb"),
  saic: glbEmblem("saic.glb"),
  vauxhall: glbEmblem("vauxhall.glb"),
  cupra: glbEmblem("cupra.glb"),
  ferrari: glbEmblem("ferrari.glb"),
  livan: glbEmblem("livan.glb"),
  lucid: glbEmblem("lucid.glb"),
  maxus: glbEmblem("maxus.glb"),
  mg: glbEmblem("mg.glb"),
  omoda: glbEmblem("omoda.glb"),
  rivian: glbEmblem("rivian.glb"),
};
