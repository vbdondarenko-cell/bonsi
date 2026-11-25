"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { CoreState } from "./crystal-blast";

const projected = new THREE.Vector3();

export type SceneInput = {
  /** Екранний стан кристала: сюди пишемо позицію (для кліку), звідси читаємо масштаб/оберт анімації «вибуху». */
  core: MutableRefObject<CoreState>;
  /** Курсор, -0.5…0.5. */
  pointer: MutableRefObject<{ x: number; y: number }>;
  /** Прогрес прокрутки всієї сторінки, 0…1. */
  progress: MutableRefObject<number>;
};

/** Довжина польоту камери вздовж осі z за всю сторінку. */
const PATH = 30;
const BG = "#07080c";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Кусково-лінійна інтерполяція ключових кадрів за прогресом. */
function sample(keys: number[], t: number) {
  const scaled = Math.min(Math.max(t, 0), 1) * (keys.length - 1);
  const i = Math.min(Math.floor(scaled), keys.length - 2);
  const f = scaled - i;
  const eased = f * f * (3 - 2 * f);
  return keys[i] + (keys[i + 1] - keys[i]) * eased;
}

// Куди «відступає» кристал, щоб не перекривати текст: праворуч / ліворуч / по центру внизу.
// Текст на сайті вирівняний ліворуч, тому кристал тримається правого боку й лише «дихає» по висоті.
const CORE_X = [0.27, 0.31, 0.27, 0.31, 0.27, 0.31, 0.2];
const CORE_Y = [0, 0.12, -0.08, 0.14, -0.04, 0.1, -0.14];

function Field({ count, animate }: { count: number; animate: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const rand = mulberry32(11);
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      data[i * 3] = (rand() + rand() + rand() - 1.5) * 18;
      data[i * 3 + 1] = (rand() + rand() + rand() - 1.5) * 12;
      data[i * 3 + 2] = 12 - rand() * (PATH + 26);
    }
    return data;
  }, [count]);

  useFrame((_, delta) => {
    if (animate && ref.current) ref.current.rotation.z += delta * 0.01;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#b3a3ff"
        size={0.03}
        sizeAttenuation
        transparent
        opacity={0.8}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Кільця-«ворота» вздовж шляху: камера пролітає крізь них під час скролу. */
function Gates({ animate }: { animate: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const gates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ z: -1 - i * 4.4, radius: 3.4 + (i % 3) * 0.7, tilt: i * 0.5 })),
    [],
  );

  useFrame((_, delta) => {
    if (!animate) return;
    refs.current.forEach((mesh, index) => {
      if (mesh) mesh.rotation.z += delta * (0.05 + index * 0.012) * (index % 2 ? 1 : -1);
    });
  });

  return (
    <>
      {gates.map((gate, index) => (
        <mesh
          key={gate.z}
          ref={(node) => {
            refs.current[index] = node;
          }}
          position={[0, 0, gate.z]}
          rotation={[0, 0, gate.tilt]}
        >
          <torusGeometry args={[gate.radius, 0.014, 8, 140]} />
          <meshBasicMaterial color={index % 2 ? "#c9bdff" : "#7b5cff"} transparent opacity={0.34} />
        </mesh>
      ))}
    </>
  );
}

/** Головний кристал: летить попереду камери й переходить між боками за секціями. */
function Core({ input, animate }: { input: SceneInput; animate: boolean }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    const node = group.current;
    if (!node) return;
    const { camera, clock } = state;
    const progress = input.progress.current;
    const z = camera.position.z - 7;
    const view = state.viewport.getCurrentViewport(camera, [0, 0, z]);
    const wide = view.width / view.height > 1.2;

    const targetX = wide ? sample(CORE_X, progress) * view.width : 0;
    const targetY = wide ? sample(CORE_Y, progress) * view.height : -view.height * 0.24;
    node.position.x = THREE.MathUtils.lerp(node.position.x, targetX, 0.06);
    node.position.y = THREE.MathUtils.lerp(node.position.y, targetY + (animate ? Math.sin(clock.elapsedTime * 0.7) * 0.12 : 0), 0.06);
    node.position.z = z;

    const core = input.core.current;
    const base = wide ? 0.82 : 0.6;
    const pulse = 1 + Math.sin(progress * Math.PI * 4) * 0.12;
    node.scale.setScalar(THREE.MathUtils.lerp(node.scale.x, base * pulse * core.scale, 0.08));

    // Де кристал на екрані зараз: за цим працює клік по ньому.
    const ndc = projected.copy(node.position).project(camera);
    core.x = ((ndc.x + 1) / 2) * state.size.width;
    core.y = ((1 - ndc.y) / 2) * state.size.height;
    core.r = 1.68 * base * pulse * (state.size.height / view.height);

    if (animate) {
      node.rotation.y += delta * 0.2 * (1 + core.spin);
      node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, progress * Math.PI * 1.6 + input.pointer.current.y * 0.5, 0.05);
      node.rotation.z = THREE.MathUtils.lerp(node.rotation.z, -input.pointer.current.x * 0.4, 0.05);
    }
  });

  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[1.2, 1]} />
        <meshStandardMaterial color="#6c4cf5" metalness={0.6} roughness={0.25} flatShading />
      </mesh>
      <mesh scale={1.4}>
        <icosahedronGeometry args={[1.2, 1]} />
        <meshBasicMaterial color="#a591ff" wireframe transparent opacity={0.28} />
      </mesh>
      <mesh rotation={[Math.PI / 2.3, 0, 0]}>
        <torusGeometry args={[2.1, 0.012, 8, 160]} />
        <meshBasicMaterial color="#d7cfff" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

/** Дрібні фігури, розкидані вздовж усього шляху: дають відчуття швидкості й глибини. */
function Floaters({ count, animate }: { count: number; animate: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const items = useMemo(() => {
    const rand = mulberry32(5);
    return Array.from({ length: count }, (_, i) => {
      const side = i % 2 ? 1 : -1;
      return {
        x: side * (2.6 + rand() * 3.6),
        y: (rand() - 0.5) * 5,
        z: 2 - (i / count) * (PATH + 4) - rand() * 2,
        speed: 0.25 + rand() * 0.5,
        kind: i % 3,
        scale: 0.28 + rand() * 0.3,
      };
    });
  }, [count]);

  useFrame((state, delta) => {
    if (!animate) return;
    const time = state.clock.elapsedTime;
    refs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const item = items[index];
      mesh.rotation.x += delta * item.speed;
      mesh.rotation.y += delta * item.speed * 0.7;
      mesh.position.y = item.y + Math.sin(time * item.speed + index) * 0.3;
    });
  });

  return (
    <>
      {items.map((item, index) => (
        <mesh
          key={`${item.z}-${index}`}
          ref={(node) => {
            refs.current[index] = node;
          }}
          position={[item.x, item.y, item.z]}
          scale={item.scale}
        >
          {item.kind === 0 ? <octahedronGeometry args={[1, 0]} /> : null}
          {item.kind === 1 ? <torusGeometry args={[0.8, 0.22, 12, 36]} /> : null}
          {item.kind === 2 ? <icosahedronGeometry args={[0.9, 0]} /> : null}
          <meshStandardMaterial color="#8a6bff" metalness={0.7} roughness={0.22} />
        </mesh>
      ))}
    </>
  );
}

/** Камера летить уперед за скролом і трохи гойдається за курсором; світло їде разом із нею. */
function Rig({ input, animate }: { input: SceneInput; animate: boolean }) {
  const lights = useRef<THREE.Group>(null);

  useFrame(({ camera }) => {
    const { x, y } = animate ? input.pointer.current : { x: 0, y: 0 };
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, x * 1.2, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, -y * 0.8, 0.05);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, 6.2 - input.progress.current * PATH, 0.07);
    camera.lookAt(camera.position.x * 0.4, camera.position.y * 0.4, camera.position.z - 10);
    if (lights.current) lights.current.position.z = camera.position.z;
  });

  return (
    <group ref={lights}>
      <ambientLight intensity={0.6} />
      <pointLight position={[4, 3, -2]} intensity={70} color="#b7a6ff" />
      <pointLight position={[-4, -2, -4]} intensity={40} color="#ffffff" />
    </group>
  );
}

export function SiteCanvas({
  input,
  animate,
  compact,
}: {
  input: SceneInput;
  animate: boolean;
  compact: boolean;
}) {
  return (
    <Canvas
      dpr={[1, compact ? 1.5 : 1.75]}
      camera={{ position: [0, 0, 6.2], fov: 52, near: 0.1, far: 80 }}
      gl={{ antialias: !compact, alpha: true, powerPreference: "high-performance" }}
      frameloop={animate ? "always" : "demand"}
      style={{ pointerEvents: "none" }}
    >
      <fog attach="fog" args={[BG, 9, 42]} />
      <Field count={compact ? 700 : 2200} animate={animate} />
      <Gates animate={animate} />
      <Core input={input} animate={animate} />
      <Floaters count={compact ? 7 : 12} animate={animate} />
      <Rig input={input} animate={animate} />
    </Canvas>
  );
}
