"use client";

// The hero's brand-recognition moment: a rotating chrome 3D emblem over
// ambient dust, cycling through a handful of recognised brands. Raw
// Three.js (no react-three-fiber/drei) on purpose — this is the only 3D
// surface on this page, so a render-loop reconciler is unwarranted weight
// for a static marketing page. Material/lighting constants and the studio
// environment bake match apps/desktop/src/components/VehicleScene.tsx
// exactly (see lib/rendering.ts). The renderer/scene/lights are built once
// on mount (see emblem-scene.js's own _init3d/_loadEmblem split) — only the
// loaded model swaps when the active brand changes, not the whole context.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CHROME_MATERIAL, EMBLEM_ROTATE_SPEED, STUDIO_LIGHTING } from "@/lib/rendering";
import { cn } from "@/lib/utils";
import { EmblemDust } from "./EmblemDust";

export const BRANDS: { key: string; label: string }[] = [
  { key: "volkswagen", label: "Volkswagen" },
  { key: "bmw", label: "BMW" },
  { key: "toyota", label: "Toyota" },
  { key: "renault", label: "Renault" },
  { key: "tesla", label: "Tesla" },
];

const CYCLE_MS = 4200;

function buildStudioEnv(): THREE.Scene {
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

function buildContactShadow(): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2 - 4);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.16;
  return mesh;
}

export function EmblemScene({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const currentModelRef = useRef<THREE.Object3D | null>(null);
  const genRef = useRef(0);
  const [activeIdx, setActiveIdx] = useState(0);

  // Cycle which brand is shown.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActiveIdx((i) => (i + 1) % BRANDS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  // One-time setup: renderer, scene, camera, studio environment, render
  // loop. Runs once on mount; brand swaps (below) never touch any of this.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(5.0, 3.0, 5.0);
    camera.lookAt(0, -0.34, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = buildStudioEnv();
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    scene.environment = rt.texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(3, 5, 3);
    const fill = new THREE.DirectionalLight(0xffffff, 0.2);
    fill.position.set(-4, 2, 1);
    const rim = new THREE.DirectionalLight(STUDIO_LIGHTING.rimLight as unknown as THREE.ColorRepresentation, 0.9);
    rim.position.set(0, -2, -5);
    scene.add(key, fill, rim);
    scene.add(buildContactShadow());

    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;
    loaderRef.current = new GLTFLoader();

    function resize() {
      const w = mount!.clientWidth || 420;
      const h = mount!.clientHeight || 420;
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let disposed = false;
    let raf = 0;
    let last = performance.now();
    function tick(t: number) {
      if (disposed) return;
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      if (!reduced) group.rotation.y += EMBLEM_ROTATE_SPEED * dt;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      rt.texture.dispose();
      envScene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      });
      groupRef.current = null;
      loaderRef.current = null;
      currentModelRef.current = null;
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // Brand swap: load the newly-active brand's GLB and replace the current
  // model in-place, disposing the old one. The renderer/scene above is
  // untouched.
  useEffect(() => {
    const loader = loaderRef.current;
    const group = groupRef.current;
    if (!loader || !group) return;
    const brand = BRANDS[activeIdx]!;
    const myGen = ++genRef.current;

    loader.load(
      `/emblems/${brand.key}.glb`,
      (gltf) => {
        if (myGen !== genRef.current) return; // a newer brand started loading first
        const material = new THREE.MeshPhysicalMaterial({ ...CHROME_MATERIAL });
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.material = material;
        });

        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const k = size.x > 0 ? 2.6 / size.x : 1;
        obj.scale.setScalar(k);
        obj.position.set(-center.x * k, -center.y * k, -center.z * k);

        const previous = currentModelRef.current;
        group.add(obj);
        currentModelRef.current = obj;
        if (previous) {
          group.remove(previous);
          previous.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.geometry.dispose();
              (mesh.material as THREE.Material).dispose();
            }
          });
        }
      },
      undefined,
      (err) => console.warn(`EmblemScene: failed to load ${brand.key}`, err),
    );
  }, [activeIdx]);

  return (
    <div className={cn("relative", className)}>
      <EmblemDust className="absolute inset-0 h-full w-full" pace={EMBLEM_ROTATE_SPEED} />
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-x-0 bottom-0.5 flex justify-center gap-[7px]">
        {BRANDS.map((b, i) => (
          <span
            key={b.key}
            className={cn(
              "h-[5px] w-[5px] rounded-full transition-colors duration-400",
              i === activeIdx ? "bg-section-accent-strong" : "bg-section-faintest",
            )}
          />
        ))}
      </div>
    </div>
  );
}
