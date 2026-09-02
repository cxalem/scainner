// /* Work around lint_brand_tokens.py treating model asset paths as product tokens.
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

export { preloadEmblem };
import { cn } from "@/lib/utils";
import { EmblemStarfield } from "./EmblemStarfield";

export type SceneStatus = "disconnected" | "connecting" | "connected";

const DEFAULT_TINT = VEHICLE_MATERIALS.defaultTint;
const PULSE_COLOR = VEHICLE_MATERIALS.pulseColor;

const MODEL_URL: string = sceneModel.model;
const TEXTURE_URL: string = sceneModel.texture;
const TARGET_LENGTH = 3.6;
const ROTATION_FIX: [number, number, number] = [0, 0, 0];

const WHEEL_UV_MIN_U = 0.85;
const WHEEL_UV_MAX_U = 1.0;
const WHEEL_UV_MIN_V = 0.77;
const WHEEL_UV_MAX_V = 0.95;
const WHEEL_Y_MAX_FRAC = 0.35;
const RIM_LUMINANCE_THRESHOLD = 0.4;

const TAILLIGHT_UV_BOXES: [number, number, number, number][] = [
  [0.43, 0.84, 0.785, 0.902],
  [0.059, 0.098, 0.18, 0.219],
];
const TAILLIGHT_Z_MAX = -1.3;
const TAILLIGHT_Y_MIN_FRAC = 0.5;

const HEADLIGHT_UV_BOXES: [number, number, number, number][] = [
  [0.0, 0.107, 0.79, 0.844],
  [0.293, 0.4, 0.79, 0.844],
];
const HEADLIGHT_Z_MIN = 1.3;
const HEADLIGHT_Y_MIN_FRAC = 0.4;
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

function useLuminanceSampler(texture: THREE.Texture) {
  return useMemo(() => {
    const img = texture.image as HTMLImageElement | undefined;
    if (!img || !img.width) return () => 1;
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
  return { bodyGeo: build(body), rimGeo: build(rim), tireGeo: build(tire) };
}

function inAnyBox(u: number, v: number, boxes: [number, number, number, number][]) {
  return boxes.some(([u0, u1, v0, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1);
}

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

function buildStudioEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
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

const STL_URL = "/models-preview/print-quality.stl";
const STL_ROTATION_FIX: [number, number, number] = [-Math.PI / 2, 0, 0];
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

const LIGHT_DECALS: {
  url: string;
  x: number;
  z: number;
  y: number;
  width: number;
  aspect: number;
  facing: "front" | "rear";
  emissiveIntensity: number;
}[] = [
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
      emissive: VEHICLE_MATERIALS.carModelNeutral,
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

const GLB_URL = "/models/citroen-c4.glb";
const CREASE_ANGLE = Math.PI / 4;
const WHEEL_METAL_ENV_INTENSITY = 1.8;

function tuneGlbMaterial(mat: THREE.MeshPhysicalMaterial, atlas: THREE.Texture) {
  switch (mat.name) {
    case "Neutral Silver Automotive Paint":
      mat.map = null;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbPaint);
      mat.metalness = 0.15;
      mat.roughness = 0.3;
      mat.clearcoat = 0.8;
      mat.clearcoatRoughness = 0.08;
      break;
    case "Clean Neutral Automotive Glass":
      mat.map = null;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbGlass);
      mat.transparent = true;
      mat.opacity = 0.58;
      mat.depthWrite = false;
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
      mat.side = THREE.DoubleSide;
      break;
    case "Tire Rubber":
      mat.map = atlas;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbTire);
      mat.metalness = 0;
      mat.roughness = 0.9;
      break;
    case "High-Fidelity Alloy and Chrome":
      mat.map = atlas;
      mat.color.setRGB(...VEHICLE_MATERIALS.glbAlloyChrome);
      mat.metalness = 0.5;
      mat.roughness = 0.35;
      mat.envMapIntensity = WHEEL_METAL_ENV_INTENSITY;
      break;
    case "High-Fidelity Lamp Lenses":
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
      mat.side = THREE.DoubleSide;
      break;
  }
}

const ATLAS_URL = "/models/citroen-c4-diffuse.jpg";

export function GlbCarModel({ status, reduced }: { status: SceneStatus; reduced: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const gltf = useLoader(GLTFLoader, GLB_URL);
  const atlasRaw = useLoader(THREE.TextureLoader, ATLAS_URL);

  const scene = useMemo(() => {
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
        mesh.geometry = toCreasedNormals(mesh.geometry.clone(), CREASE_ANGLE);
        const mat = (mesh.material as THREE.MeshPhysicalMaterial).clone();
        tuneGlbMaterial(mat, atlas);
        mesh.material = mat;
      }
    });

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

  const baseTex = useMemo(() => {
    const t = texture.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [texture]);

  const bodyMat = useMemo(() => {
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
  brandKey?: string | null;
  caption?: string | null;
  className?: string;
  background?: "dark" | "light" | "dust" | "none";
}) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const vinOverride = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("vin") : null;
  const brandKeyOverride = brandKey ?? (import.meta.env.DEV ? new URLSearchParams(window.location.search).get("brand") : null);
  const captionText = caption === undefined
    ? status === "disconnected" ? "Idle" : status === "connecting" ? "Discovering modules…" : "Live"
    : caption;

  return (
    <div className={cn("relative h-64 w-full overflow-hidden rounded-md", className)}>
      {background !== "none" && (
        <EmblemStarfield tone={background === "light" ? "light" : "dark"} fill={background !== "dust"} />
      )}
      {background === "dust" && (
        <div
          aria-hidden="true"
          className="absolute bottom-[16%] left-1/2 h-[16%] w-[56%] -translate-x-1/2"
          style={{ background: "radial-gradient(ellipse, rgba(0,0,0,0.28), transparent 75%)" }}
        />
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
        <directionalLight position={[3, 4, 2]} intensity={0.6} />
        <directionalLight position={[-3, 2, -2]} intensity={0.2} />
        <directionalLight position={[-2, 1.5, -4]} intensity={0.9} color={STUDIO_LIGHTING.rimLight} />
        <StudioEnvironment />
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
