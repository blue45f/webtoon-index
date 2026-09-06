/* eslint-disable react-refresh/only-export-components -- 카탈로그·본 오프셋과 그 카탈로그 전용 R3F 렌더러가 하나의 정적 소유 경계다. */
import { createPortal } from "@react-three/fiber";
import { useEffect, useState, type FC } from "react";
import * as THREE from "three";

import { d, type Vec3 } from "./studio-vrm-poser-utils";

import type { ScenePropAttachmentConfig as PropAttachmentConfig } from "./studio-vrm-scene-props";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

export type ScenePropDef = {
  id: string;
  label: string;
  emoji: string;
  category: "animal" | "item" | "effect";
  position: Vec3;
  scale: number;
};

export const SCENE_PROPS: ScenePropDef[] = [
  { id: "cat", label: "고양이", emoji: "🐱", category: "animal", position: [0.5, 0, 0.3], scale: 0.12 },
  { id: "dog", label: "강아지", emoji: "🐕", category: "animal", position: [-0.5, 0, 0.3], scale: 0.13 },
  { id: "bunny", label: "토끼", emoji: "🐰", category: "animal", position: [0.6, 0, -0.2], scale: 0.1 },
  { id: "bird", label: "새", emoji: "🐦", category: "animal", position: [0.35, 1.7, 0.1], scale: 0.08 },
  { id: "fox", label: "여우", emoji: "🦊", category: "animal", position: [-0.55, 0, -0.15], scale: 0.12 },
  { id: "bear", label: "곰", emoji: "🐻", category: "animal", position: [-0.6, 0, 0.4], scale: 0.15 },
  { id: "chick", label: "병아리", emoji: "🐥", category: "animal", position: [0.3, 0, 0.5], scale: 0.07 },
  { id: "fish", label: "물고기", emoji: "🐟", category: "animal", position: [0.5, 1.2, -0.3], scale: 0.08 },
  { id: "sword", label: "검", emoji: "⚔️", category: "item", position: [0.65, 0, 0], scale: 0.14 },
  { id: "shield", label: "방패", emoji: "🛡️", category: "item", position: [-0.65, 0.5, 0], scale: 0.16 },
  { id: "book", label: "책", emoji: "📖", category: "item", position: [0.4, 0.85, 0.3], scale: 0.1 },
  { id: "flower", label: "꽃", emoji: "🌸", category: "item", position: [0.35, 0, 0.45], scale: 0.09 },
  { id: "gem", label: "보석", emoji: "💎", category: "item", position: [0.3, 1.5, 0.2], scale: 0.06 },
  { id: "crystal", label: "수정구", emoji: "🔮", category: "item", position: [-0.35, 0.8, 0.35], scale: 0.1 },
  { id: "cloud", label: "구름", emoji: "☁️", category: "effect", position: [0.5, 2.0, -0.5], scale: 0.2 },
  { id: "star", label: "별", emoji: "🌟", category: "effect", position: [-0.4, 1.8, 0.2], scale: 0.07 },
  /* ── Animals (new) ── */
  { id: "penguin", label: "펭귄", emoji: "🐧", category: "animal", position: [0.55, 0, 0.25], scale: 0.11 },
  { id: "dragon", label: "드래곤", emoji: "🐉", category: "animal", position: [-0.7, 0, -0.3], scale: 0.12 },
  { id: "unicorn", label: "유니콘", emoji: "🦄", category: "animal", position: [0.7, 0, -0.2], scale: 0.13 },
  { id: "owl", label: "부엉이", emoji: "🦉", category: "animal", position: [0.4, 1.6, 0.15], scale: 0.09 },
  { id: "butterfly", label: "나비", emoji: "🦋", category: "animal", position: [0.35, 1.5, 0.4], scale: 0.08 },
  { id: "deer", label: "사슴", emoji: "🦌", category: "animal", position: [-0.65, 0, 0.35], scale: 0.12 },
  { id: "wolf", label: "늑대", emoji: "🐺", category: "animal", position: [0.65, 0, -0.35], scale: 0.12 },
  { id: "turtle", label: "거북이", emoji: "🐢", category: "animal", position: [-0.45, 0, 0.5], scale: 0.1 },
  /* ── Items (new) ── */
  { id: "staff", label: "지팡이", emoji: "🪄", category: "item", position: [0.6, 0, 0.1], scale: 0.13 },
  { id: "bowWeapon", label: "활", emoji: "🏹", category: "item", position: [-0.6, 0.5, 0.1], scale: 0.14 },
  { id: "lantern", label: "랜턴", emoji: "🏮", category: "item", position: [0.4, 0.8, 0.3], scale: 0.1 },
  { id: "crown", label: "왕관", emoji: "👑", category: "item", position: [0.3, 1.7, 0.15], scale: 0.08 },
  { id: "ring", label: "반지", emoji: "💍", category: "item", position: [0.25, 1.2, 0.3], scale: 0.05 },
  { id: "potion", label: "물약", emoji: "🧪", category: "item", position: [0.35, 0.4, 0.4], scale: 0.09 },
  { id: "scroll", label: "두루마리", emoji: "📜", category: "item", position: [-0.4, 0.6, 0.35], scale: 0.1 },
  { id: "guitar", label: "기타", emoji: "🎸", category: "item", position: [-0.55, 0.3, 0.25], scale: 0.12 },
  { id: "umbrella", label: "우산", emoji: "☂️", category: "item", position: [0.45, 0.5, 0.2], scale: 0.14 },
  { id: "hammer", label: "망치", emoji: "🔨", category: "item", position: [0.6, 0.3, -0.1], scale: 0.13 },
  { id: "wand", label: "마법봉", emoji: "✨", category: "item", position: [0.5, 0.9, 0.2], scale: 0.1 },
  { id: "heartProp", label: "하트", emoji: "❤️", category: "item", position: [0.3, 1.4, 0.3], scale: 0.08 },
  { id: "moon", label: "초승달", emoji: "🌙", category: "item", position: [-0.5, 1.9, -0.3], scale: 0.12 },
  { id: "sun", label: "태양", emoji: "☀️", category: "item", position: [0.5, 2.1, -0.4], scale: 0.14 },
  { id: "treasureChest", label: "보물상자", emoji: "🧳", category: "item", position: [-0.5, 0, 0.4], scale: 0.11 },
  { id: "balloon", label: "풍선", emoji: "🎈", category: "item", position: [0.4, 1.8, 0.2], scale: 0.1 },
  { id: "candle", label: "초", emoji: "🕯️", category: "item", position: [0.3, 0.3, 0.45], scale: 0.08 },
  { id: "mask", label: "가면", emoji: "🎭", category: "item", position: [-0.3, 1.3, 0.3], scale: 0.09 },
  /* ── Effects (new) ── */
  { id: "sparkle", label: "반짝이", emoji: "💫", category: "effect", position: [0.3, 1.6, 0.3], scale: 0.1 },
  { id: "fire", label: "불꽃", emoji: "🔥", category: "effect", position: [0.5, 0, 0.3], scale: 0.12 },
  { id: "lightning", label: "번개", emoji: "⚡", category: "effect", position: [-0.3, 1.5, -0.2], scale: 0.12 },
  { id: "snowflake", label: "눈결정", emoji: "❄️", category: "effect", position: [0.4, 1.8, 0.1], scale: 0.08 },
  { id: "rainbow", label: "무지개", emoji: "🌈", category: "effect", position: [0, 2.2, -0.6], scale: 0.15 },
  { id: "bubbles", label: "비눗방울", emoji: "🫧", category: "effect", position: [-0.35, 1.3, 0.35], scale: 0.1 },
  { id: "leaves", label: "나뭇잎", emoji: "🍃", category: "effect", position: [0.4, 1.5, -0.2], scale: 0.1 },
  { id: "feather", label: "깃털", emoji: "🪶", category: "effect", position: [-0.3, 1.6, 0.25], scale: 0.09 },
  // 추가 20종 이상 (장르·웹툰 컷용)
  /* animals extra */
  { id: "hamster", label: "햄스터", emoji: "🐹", category: "animal", position: [0.4, 0.1, 0.4], scale: 0.07 },
  { id: "snake", label: "뱀", emoji: "🐍", category: "animal", position: [-0.5, 0.2, -0.1], scale: 0.09 },
  { id: "frog", label: "개구리", emoji: "🐸", category: "animal", position: [0.55, 0.05, 0.5], scale: 0.08 },
  { id: "panda", label: "판다", emoji: "🐼", category: "animal", position: [-0.6, 0.3, 0.2], scale: 0.14 },
  { id: "lion", label: "사자", emoji: "🦁", category: "animal", position: [0.65, 0.1, -0.3], scale: 0.13 },
  /* items extra */
  { id: "basket", label: "바구니", emoji: "🧺", category: "item", position: [0.5, 0.2, 0.3], scale: 0.12 },
  { id: "letter", label: "편지", emoji: "✉️", category: "item", position: [-0.35, 0.9, 0.4], scale: 0.07 },
  { id: "rose", label: "장미", emoji: "🌹", category: "item", position: [0.25, 0.7, 0.2], scale: 0.1 },
  { id: "dagger", label: "단검", emoji: "🗡️", category: "item", position: [0.6, 0.4, -0.1], scale: 0.1 },
  { id: "mirror", label: "거울", emoji: "🪞", category: "item", position: [-0.5, 1.0, 0.25], scale: 0.11 },
  { id: "clock", label: "시계", emoji: "🕰️", category: "item", position: [0.4, 1.3, 0.1], scale: 0.09 },
  { id: "teacup", label: "찻잔", emoji: "🍵", category: "item", position: [-0.3, 0.5, 0.5], scale: 0.08 },
  { id: "backpack2", label: "큰배낭", emoji: "🎒", category: "item", position: [0.55, 0.6, -0.15], scale: 0.12 },
  { id: "torch", label: "횃불", emoji: "🔥", category: "item", position: [-0.6, 0.7, 0.05], scale: 0.1 },
  { id: "coin", label: "금화", emoji: "🪙", category: "item", position: [0.3, 0.4, 0.6], scale: 0.05 },
  /* effects extra */
  { id: "heartFX", label: "하트 이펙트", emoji: "💕", category: "effect", position: [0.1, 2.0, 0.3], scale: 0.12 },
  { id: "note", label: "음표", emoji: "🎵", category: "effect", position: [-0.2, 1.9, -0.4], scale: 0.1 },
  { id: "magic", label: "마법진", emoji: "✨", category: "effect", position: [0, 0.1, 0.2], scale: 0.15 },
  { id: "smoke", label: "연기", emoji: "💨", category: "effect", position: [0.5, 1.0, -0.5], scale: 0.13 },
  { id: "cherry", label: "벚꽃잎", emoji: "🌸", category: "effect", position: [-0.4, 1.7, 0.2], scale: 0.09 },
];

export const SCENE_PROP_IDS = new Set(SCENE_PROPS.map((prop) => prop.id));

/* ── 3D Scene Prop Meshes ─────────────────────────────── */

function AnimalCat({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 1.8, 0]}><sphereGeometry args={[1, 16, 16]} /><meshStandardMaterial color="#444" /></mesh>
      <mesh position={[-0.55, 2.7, 0]} rotation={[0, 0, 0.3]}><coneGeometry args={[0.35, 0.7, 4]} /><meshStandardMaterial color="#444" /></mesh>
      <mesh position={[0.55, 2.7, 0]} rotation={[0, 0, -0.3]}><coneGeometry args={[0.35, 0.7, 4]} /><meshStandardMaterial color="#444" /></mesh>
      <mesh position={[0, 0.8, 0]}><capsuleGeometry args={[0.7, 1.4, 8, 16]} /><meshStandardMaterial color="#555" /></mesh>
      <mesh position={[-1.2, 1.3, 0]} rotation={[0, 0, 1.2]}><capsuleGeometry args={[0.15, 1.4, 4, 8]} /><meshStandardMaterial color="#555" /></mesh>
      <mesh position={[0, 1.6, 0.8]}><sphereGeometry args={[0.2, 8, 8]} /><meshStandardMaterial color="#ffaacc" /></mesh>
      <mesh position={[-0.3, 2, 0.85]}><sphereGeometry args={[0.18, 8, 8]} /><meshStandardMaterial color="#aaff88" emissive="#224400" /></mesh>
      <mesh position={[0.3, 2, 0.85]}><sphereGeometry args={[0.18, 8, 8]} /><meshStandardMaterial color="#aaff88" emissive="#224400" /></mesh>
    </group>
  );
}

function AnimalDog({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 1.7, 0]}><sphereGeometry args={[0.9, 16, 16]} /><meshStandardMaterial color="#c49060" /></mesh>
      <mesh position={[-0.6, 2.1, 0.2]} rotation={[0.3, 0, 0.6]}><capsuleGeometry args={[0.25, 0.8, 4, 8]} /><meshStandardMaterial color="#a07040" /></mesh>
      <mesh position={[0.6, 2.1, 0.2]} rotation={[0.3, 0, -0.6]}><capsuleGeometry args={[0.25, 0.8, 4, 8]} /><meshStandardMaterial color="#a07040" /></mesh>
      <mesh position={[0, 0.7, 0]}><capsuleGeometry args={[0.8, 1, 8, 16]} /><meshStandardMaterial color="#d4a060" /></mesh>
      <mesh position={[0, 1.5, 0.75]}><sphereGeometry args={[0.22, 8, 8]} /><meshStandardMaterial color="#222" /></mesh>
      <mesh position={[-0.25, 1.85, 0.75]}><sphereGeometry args={[0.14, 8, 8]} /><meshStandardMaterial color="#222" /></mesh>
      <mesh position={[0.25, 1.85, 0.75]}><sphereGeometry args={[0.14, 8, 8]} /><meshStandardMaterial color="#222" /></mesh>
      <mesh position={[-1.1, 1.8, -0.2]} rotation={[0, 0, 1.5]}><capsuleGeometry args={[0.1, 0.9, 4, 8]} /><meshStandardMaterial color="#c49060" /></mesh>
    </group>
  );
}

function AnimalBunny({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 1.5, 0]}><sphereGeometry args={[0.8, 16, 16]} /><meshStandardMaterial color="#fff" /></mesh>
      <mesh position={[-0.25, 2.8, 0]}><capsuleGeometry args={[0.18, 1.2, 4, 8]} /><meshStandardMaterial color="#fff" /></mesh>
      <mesh position={[0.25, 2.8, 0]}><capsuleGeometry args={[0.18, 1.2, 4, 8]} /><meshStandardMaterial color="#fff" /></mesh>
      <mesh position={[-0.25, 2.8, 0.05]}><capsuleGeometry args={[0.1, 0.9, 4, 8]} /><meshStandardMaterial color="#ffbbcc" /></mesh>
      <mesh position={[0.25, 2.8, 0.05]}><capsuleGeometry args={[0.1, 0.9, 4, 8]} /><meshStandardMaterial color="#ffbbcc" /></mesh>
      <mesh position={[0, 0.7, 0]}><sphereGeometry args={[0.9, 16, 16]} /><meshStandardMaterial color="#f8f8f8" /></mesh>
      <mesh position={[0, 1.35, 0.65]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#ffaabb" /></mesh>
      <mesh position={[-0.22, 1.65, 0.65]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#ff3366" /></mesh>
      <mesh position={[0.22, 1.65, 0.65]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#ff3366" /></mesh>
      <mesh position={[0, 0.5, -0.8]}><sphereGeometry args={[0.35, 12, 12]} /><meshStandardMaterial color="#fff" /></mesh>
    </group>
  );
}

function AnimalBird({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.8, 16, 16]} /><meshStandardMaterial color="#60a5fa" /></mesh>
      <mesh position={[0, 1.2, 0]}><sphereGeometry args={[0.55, 16, 16]} /><meshStandardMaterial color="#93c5fd" /></mesh>
      <mesh position={[0, 1.1, 0.55]}><coneGeometry args={[0.15, 0.5, 6]} /><meshStandardMaterial color="#fb923c" /></mesh>
      <mesh position={[-0.22, 1.35, 0.4]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.22, 1.35, 0.4]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[-0.7, 0.6, 0]} rotation={[0, 0, 0.6]}><capsuleGeometry args={[0.1, 0.8, 4, 8]} /><meshStandardMaterial color="#2563eb" /></mesh>
      <mesh position={[0.7, 0.6, 0]} rotation={[0, 0, -0.6]}><capsuleGeometry args={[0.1, 0.8, 4, 8]} /><meshStandardMaterial color="#2563eb" /></mesh>
    </group>
  );
}

function AnimalFox({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 1.6, 0]}><sphereGeometry args={[0.85, 16, 16]} /><meshStandardMaterial color="#ea580c" /></mesh>
      <mesh position={[-0.45, 2.5, 0]} rotation={[0, 0, 0.25]}><coneGeometry args={[0.3, 0.7, 4]} /><meshStandardMaterial color="#ea580c" /></mesh>
      <mesh position={[0.45, 2.5, 0]} rotation={[0, 0, -0.25]}><coneGeometry args={[0.3, 0.7, 4]} /><meshStandardMaterial color="#ea580c" /></mesh>
      <mesh position={[0, 0.7, 0]}><capsuleGeometry args={[0.7, 1.2, 8, 16]} /><meshStandardMaterial color="#f97316" /></mesh>
      <mesh position={[0, 1.3, 0.7]}><sphereGeometry args={[0.3, 8, 8]} /><meshStandardMaterial color="#fff" /></mesh>
      <mesh position={[0, 1.35, 0.85]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[-0.2, 1.7, 0.7]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.2, 1.7, 0.7]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[-1.0, 0.5, -0.2]} rotation={[0.3, 0, 1.0]}><capsuleGeometry args={[0.25, 1.0, 4, 8]} /><meshStandardMaterial color="#fff" /></mesh>
    </group>
  );
}

function AnimalBear({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 1.8, 0]}><sphereGeometry args={[1, 16, 16]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[-0.65, 2.6, 0]}><sphereGeometry args={[0.35, 12, 12]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[0.65, 2.6, 0]}><sphereGeometry args={[0.35, 12, 12]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[-0.65, 2.6, 0.1]}><sphereGeometry args={[0.2, 8, 8]} /><meshStandardMaterial color="#fef08a" /></mesh>
      <mesh position={[0.65, 2.6, 0.1]}><sphereGeometry args={[0.2, 8, 8]} /><meshStandardMaterial color="#fef08a" /></mesh>
      <mesh position={[0, 0.8, 0]}><capsuleGeometry args={[0.9, 1.2, 8, 16]} /><meshStandardMaterial color="#92400e" /></mesh>
      <mesh position={[0, 1.6, 0.85]}><sphereGeometry args={[0.2, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[-0.28, 2, 0.8]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.28, 2, 0.8]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0, 0.5, 0.7]}><sphereGeometry args={[0.45, 12, 12]} /><meshStandardMaterial color="#fef08a" /></mesh>
    </group>
  );
}

function AnimalChick({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0.8, 0]}><sphereGeometry args={[0.9, 16, 16]} /><meshStandardMaterial color="#fef08a" /></mesh>
      <mesh position={[0, 1.6, 0]}><sphereGeometry args={[0.6, 16, 16]} /><meshStandardMaterial color="#fde047" /></mesh>
      <mesh position={[0, 1.4, 0.55]}><coneGeometry args={[0.15, 0.35, 6]} /><meshStandardMaterial color="#fb923c" /></mesh>
      <mesh position={[-0.18, 1.7, 0.45]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.18, 1.7, 0.45]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[-0.6, 0.9, 0]} rotation={[0, 0, 0.5]}><capsuleGeometry args={[0.08, 0.5, 4, 8]} /><meshStandardMaterial color="#fde047" /></mesh>
      <mesh position={[0.6, 0.9, 0]} rotation={[0, 0, -0.5]}><capsuleGeometry args={[0.08, 0.5, 4, 8]} /><meshStandardMaterial color="#fde047" /></mesh>
    </group>
  );
}

function AnimalFish({ scale: s }: { scale: number }) {
  return (
    <group scale={s} rotation={[0, 0.4, 0]}>
      <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.7, 16, 12]} /><meshStandardMaterial color="#f97316" transparent opacity={0.9} /></mesh>
      <mesh position={[-0.6, 0.7, 0]} rotation={[0, 0, 0.5]}><coneGeometry args={[0.45, 0.6, 6]} /><meshStandardMaterial color="#ea580c" /></mesh>
      <mesh position={[0.2, 0.55, 0.55]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.5, 0.5, 0]}><coneGeometry args={[0.35, 0.55, 3]} /><meshStandardMaterial color="#fdba74" /></mesh>
    </group>
  );
}

function PropSword({ scale: s }: { scale: number }) {
  return (
    <group scale={s} rotation={[0, 0, 0.15]}>
      <mesh position={[0, 3, 0]}><boxGeometry args={[0.15, 4, 0.06]} /><meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} /></mesh>
      <mesh position={[0, 0.85, 0]}><boxGeometry args={[0.8, 0.15, 0.15]} /><meshStandardMaterial color="#d4af37" metalness={0.6} roughness={0.3} /></mesh>
      <mesh position={[0, 0.35, 0]}><cylinderGeometry args={[0.08, 0.1, 0.8, 8]} /><meshStandardMaterial color="#5c4033" /></mesh>
    </group>
  );
}

function PropShield({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 1.5, 0]}><cylinderGeometry args={[1.2, 1, 0.15, 6]} /><meshStandardMaterial color="#1e3a5f" metalness={0.5} roughness={0.4} /></mesh>
      <mesh position={[0, 1.5, 0.08]}><cylinderGeometry args={[0.4, 0.35, 0.08, 16]} /><meshStandardMaterial color="#d4af37" metalness={0.7} roughness={0.3} /></mesh>
    </group>
  );
}

function PropBook({ scale: s }: { scale: number }) {
  return (
    <group scale={s} rotation={[0.2, 0.3, 0]}>
      <mesh position={[0, 0, 0]}><boxGeometry args={[1.6, 2.0, 0.3]} /><meshStandardMaterial color="#7c2d12" /></mesh>
      <mesh position={[0, 0, 0.16]}><boxGeometry args={[1.4, 1.8, 0.02]} /><meshStandardMaterial color="#fef3c7" /></mesh>
      <mesh position={[-0.8, 0, 0]}><boxGeometry args={[0.06, 2.0, 0.34]} /><meshStandardMaterial color="#5c2d12" /></mesh>
    </group>
  );
}

function PropFlower({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[0.06, 0.06, 2.4, 6]} /><meshStandardMaterial color="#22c55e" /></mesh>
      {[0, 72, 144, 216, 288].map((angle) => (
        <mesh key={angle} position={[Math.sin(d(angle)) * 0.35, 2.5 + Math.cos(d(angle)) * 0.1, Math.cos(d(angle)) * 0.35]}>
          <sphereGeometry args={[0.25, 8, 8]} /><meshStandardMaterial color="#f472b6" />
        </mesh>
      ))}
      <mesh position={[0, 2.5, 0]}><sphereGeometry args={[0.2, 8, 8]} /><meshStandardMaterial color="#facc15" /></mesh>
    </group>
  );
}

function PropGem({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0.6, 0]} rotation={[0, 0.3, 0]}>
        <octahedronGeometry args={[0.7, 0]} /><meshStandardMaterial color="#8b5cf6" metalness={0.3} roughness={0.1} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function PropCrystal({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0.8, 0]}><sphereGeometry args={[0.9, 24, 24]} /><meshStandardMaterial color="#a78bfa" metalness={0.2} roughness={0.05} transparent opacity={0.6} /></mesh>
      <mesh position={[0, 0.8, 0]}><sphereGeometry args={[0.92, 24, 24]} /><meshStandardMaterial color="#c4b5fd" wireframe /></mesh>
    </group>
  );
}

function PropCloud({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0, 0]}><sphereGeometry args={[0.8, 12, 12]} /><meshStandardMaterial color="#fff" transparent opacity={0.85} /></mesh>
      <mesh position={[0.65, 0.1, 0]}><sphereGeometry args={[0.6, 12, 12]} /><meshStandardMaterial color="#fff" transparent opacity={0.85} /></mesh>
      <mesh position={[-0.65, 0.05, 0]}><sphereGeometry args={[0.65, 12, 12]} /><meshStandardMaterial color="#fff" transparent opacity={0.85} /></mesh>
      <mesh position={[0.3, 0.4, 0]}><sphereGeometry args={[0.55, 12, 12]} /><meshStandardMaterial color="#f8fafc" transparent opacity={0.85} /></mesh>
      <mesh position={[-0.3, 0.35, 0]}><sphereGeometry args={[0.5, 12, 12]} /><meshStandardMaterial color="#f8fafc" transparent opacity={0.85} /></mesh>
    </group>
  );
}

function PropStar({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.8, 0.8, 0.15, 5, 1]} /><meshStandardMaterial color="#facc15" emissive="#a16207" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

/* ── NEW Animals ─────────────────────────────── */

function AnimalPenguin({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 0.9, 0]}><capsuleGeometry args={[0.7, 1.0, 8, 16]} /><meshStandardMaterial color="#1e293b" /></mesh>
      {/* belly */}
      <mesh position={[0, 0.85, 0.35]}><capsuleGeometry args={[0.5, 0.7, 8, 16]} /><meshStandardMaterial color="#f1f5f9" /></mesh>
      {/* head */}
      <mesh position={[0, 1.9, 0]}><sphereGeometry args={[0.55, 16, 16]} /><meshStandardMaterial color="#0f172a" /></mesh>
      {/* eyes */}
      <mesh position={[-0.18, 2.0, 0.45]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#fff" /></mesh>
      <mesh position={[0.18, 2.0, 0.45]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#fff" /></mesh>
      {/* beak */}
      <mesh position={[0, 1.8, 0.55]} rotation={[0.3, 0, 0]}><coneGeometry args={[0.12, 0.3, 6]} /><meshStandardMaterial color="#f97316" /></mesh>
      {/* feet */}
      <mesh position={[-0.25, 0.05, 0.15]}><boxGeometry args={[0.25, 0.08, 0.35]} /><meshStandardMaterial color="#f97316" /></mesh>
      <mesh position={[0.25, 0.05, 0.15]}><boxGeometry args={[0.25, 0.08, 0.35]} /><meshStandardMaterial color="#f97316" /></mesh>
      {/* wings */}
      <mesh position={[-0.7, 0.9, 0]} rotation={[0, 0, 0.4]}><capsuleGeometry args={[0.12, 0.7, 4, 8]} /><meshStandardMaterial color="#1e293b" /></mesh>
      <mesh position={[0.7, 0.9, 0]} rotation={[0, 0, -0.4]}><capsuleGeometry args={[0.12, 0.7, 4, 8]} /><meshStandardMaterial color="#1e293b" /></mesh>
    </group>
  );
}

function AnimalDragon({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 1.0, 0]}><capsuleGeometry args={[0.8, 1.2, 8, 16]} /><meshStandardMaterial color="#15803d" /></mesh>
      {/* head */}
      <mesh position={[0, 2.2, 0.2]}><sphereGeometry args={[0.65, 16, 16]} /><meshStandardMaterial color="#166534" /></mesh>
      {/* snout */}
      <mesh position={[0, 2.0, 0.75]} rotation={[0.4, 0, 0]}><coneGeometry args={[0.2, 0.5, 8]} /><meshStandardMaterial color="#14532d" /></mesh>
      {/* horns */}
      <mesh position={[-0.3, 2.8, -0.1]} rotation={[0.3, 0, 0.2]}><coneGeometry args={[0.08, 0.5, 6]} /><meshStandardMaterial color="#7e22ce" /></mesh>
      <mesh position={[0.3, 2.8, -0.1]} rotation={[0.3, 0, -0.2]}><coneGeometry args={[0.08, 0.5, 6]} /><meshStandardMaterial color="#7e22ce" /></mesh>
      {/* eyes */}
      <mesh position={[-0.22, 2.35, 0.55]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#fbbf24" emissive="#92400e" /></mesh>
      <mesh position={[0.22, 2.35, 0.55]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#fbbf24" emissive="#92400e" /></mesh>
      {/* wings */}
      <mesh position={[-0.9, 1.6, -0.3]} rotation={[0, 0, 0.5]}><boxGeometry args={[1.0, 0.6, 0.04]} /><meshStandardMaterial color="#7e22ce" transparent opacity={0.7} /></mesh>
      <mesh position={[0.9, 1.6, -0.3]} rotation={[0, 0, -0.5]}><boxGeometry args={[1.0, 0.6, 0.04]} /><meshStandardMaterial color="#7e22ce" transparent opacity={0.7} /></mesh>
      {/* tail */}
      <mesh position={[0, 0.5, -0.8]} rotation={[0.8, 0, 0]}><capsuleGeometry args={[0.15, 1.2, 4, 8]} /><meshStandardMaterial color="#15803d" /></mesh>
      <mesh position={[0, 0.15, -1.3]} rotation={[1.0, 0, 0]}><coneGeometry args={[0.2, 0.4, 6]} /><meshStandardMaterial color="#7e22ce" /></mesh>
    </group>
  );
}

function AnimalUnicorn({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 1.0, 0]}><capsuleGeometry args={[0.8, 1.4, 8, 16]} /><meshStandardMaterial color="#f8fafc" /></mesh>
      {/* head */}
      <mesh position={[0, 2.2, 0.3]}><sphereGeometry args={[0.6, 16, 16]} /><meshStandardMaterial color="#fff" /></mesh>
      {/* snout */}
      <mesh position={[0, 2.0, 0.85]}><capsuleGeometry args={[0.2, 0.3, 8, 8]} /><meshStandardMaterial color="#fce7f3" /></mesh>
      {/* horn */}
      <mesh position={[0, 2.95, 0.2]} rotation={[0.15, 0, 0]}><coneGeometry args={[0.08, 0.7, 8]} /><meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.2} /></mesh>
      {/* ears */}
      <mesh position={[-0.3, 2.7, 0.1]} rotation={[0, 0, 0.3]}><coneGeometry args={[0.1, 0.35, 4]} /><meshStandardMaterial color="#fff" /></mesh>
      <mesh position={[0.3, 2.7, 0.1]} rotation={[0, 0, -0.3]}><coneGeometry args={[0.1, 0.35, 4]} /><meshStandardMaterial color="#fff" /></mesh>
      {/* eyes */}
      <mesh position={[-0.2, 2.3, 0.7]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#6366f1" /></mesh>
      <mesh position={[0.2, 2.3, 0.7]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#6366f1" /></mesh>
      {/* mane */}
      <mesh position={[0, 2.5, -0.2]} rotation={[0.5, 0, 0]}><capsuleGeometry args={[0.15, 0.8, 4, 8]} /><meshStandardMaterial color="#c084fc" /></mesh>
      {/* legs */}
      <mesh position={[-0.35, 0, 0.3]}><cylinderGeometry args={[0.1, 0.1, 0.8, 8]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
      <mesh position={[0.35, 0, 0.3]}><cylinderGeometry args={[0.1, 0.1, 0.8, 8]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
      <mesh position={[-0.35, 0, -0.3]}><cylinderGeometry args={[0.1, 0.1, 0.8, 8]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
      <mesh position={[0.35, 0, -0.3]}><cylinderGeometry args={[0.1, 0.1, 0.8, 8]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
      {/* tail */}
      <mesh position={[0, 1.0, -0.9]} rotation={[0.6, 0, 0]}><capsuleGeometry args={[0.1, 0.9, 4, 8]} /><meshStandardMaterial color="#f0abfc" /></mesh>
    </group>
  );
}

function AnimalOwl({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 0.7, 0]}><capsuleGeometry args={[0.65, 0.9, 8, 16]} /><meshStandardMaterial color="#78350f" /></mesh>
      {/* head */}
      <mesh position={[0, 1.7, 0]}><sphereGeometry args={[0.65, 16, 16]} /><meshStandardMaterial color="#92400e" /></mesh>
      {/* face disk */}
      <mesh position={[0, 1.65, 0.45]}><sphereGeometry args={[0.5, 16, 16]} /><meshStandardMaterial color="#fef3c7" /></mesh>
      {/* big eyes */}
      <mesh position={[-0.2, 1.8, 0.6]}><sphereGeometry args={[0.18, 12, 12]} /><meshStandardMaterial color="#fbbf24" /></mesh>
      <mesh position={[0.2, 1.8, 0.6]}><sphereGeometry args={[0.18, 12, 12]} /><meshStandardMaterial color="#fbbf24" /></mesh>
      <mesh position={[-0.2, 1.8, 0.72]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.2, 1.8, 0.72]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      {/* beak */}
      <mesh position={[0, 1.55, 0.75]} rotation={[0.3, 0, 0]}><coneGeometry args={[0.08, 0.2, 4]} /><meshStandardMaterial color="#f59e0b" /></mesh>
      {/* ear tufts */}
      <mesh position={[-0.35, 2.3, 0]} rotation={[0, 0, 0.2]}><coneGeometry args={[0.12, 0.4, 4]} /><meshStandardMaterial color="#92400e" /></mesh>
      <mesh position={[0.35, 2.3, 0]} rotation={[0, 0, -0.2]}><coneGeometry args={[0.12, 0.4, 4]} /><meshStandardMaterial color="#92400e" /></mesh>
      {/* chest pattern */}
      <mesh position={[0, 0.6, 0.4]}><sphereGeometry args={[0.4, 12, 12]} /><meshStandardMaterial color="#fef3c7" /></mesh>
    </group>
  );
}

function AnimalButterfly({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 0.5, 0]}><capsuleGeometry args={[0.06, 0.6, 4, 8]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
      {/* head */}
      <mesh position={[0, 1.0, 0]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#312e81" /></mesh>
      {/* antennae */}
      <mesh position={[-0.1, 1.25, 0]} rotation={[0, 0, 0.3]}><cylinderGeometry args={[0.01, 0.01, 0.3, 4]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
      <mesh position={[0.1, 1.25, 0]} rotation={[0, 0, -0.3]}><cylinderGeometry args={[0.01, 0.01, 0.3, 4]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
      {/* upper wings */}
      <mesh position={[-0.55, 0.75, 0]} rotation={[0, 0.1, 0.3]}><sphereGeometry args={[0.45, 12, 12]} /><meshStandardMaterial color="#c084fc" transparent opacity={0.8} /></mesh>
      <mesh position={[0.55, 0.75, 0]} rotation={[0, -0.1, -0.3]}><sphereGeometry args={[0.45, 12, 12]} /><meshStandardMaterial color="#c084fc" transparent opacity={0.8} /></mesh>
      {/* lower wings */}
      <mesh position={[-0.4, 0.35, 0]} rotation={[0, 0.1, 0.4]}><sphereGeometry args={[0.3, 12, 12]} /><meshStandardMaterial color="#fb7185" transparent opacity={0.75} /></mesh>
      <mesh position={[0.4, 0.35, 0]} rotation={[0, -0.1, -0.4]}><sphereGeometry args={[0.3, 12, 12]} /><meshStandardMaterial color="#fb7185" transparent opacity={0.75} /></mesh>
      {/* wing spots */}
      <mesh position={[-0.55, 0.8, 0.15]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#fbbf24" /></mesh>
      <mesh position={[0.55, 0.8, 0.15]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#fbbf24" /></mesh>
    </group>
  );
}

function AnimalDeer({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 1.0, 0]}><capsuleGeometry args={[0.7, 1.4, 8, 16]} /><meshStandardMaterial color="#92400e" /></mesh>
      {/* head */}
      <mesh position={[0, 2.2, 0.3]}><sphereGeometry args={[0.5, 16, 16]} /><meshStandardMaterial color="#a16207" /></mesh>
      {/* snout */}
      <mesh position={[0, 2.0, 0.7]}><capsuleGeometry args={[0.15, 0.2, 8, 8]} /><meshStandardMaterial color="#d4a06a" /></mesh>
      {/* nose */}
      <mesh position={[0, 1.95, 0.85]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      {/* eyes */}
      <mesh position={[-0.2, 2.3, 0.55]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.2, 2.3, 0.55]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      {/* ears */}
      <mesh position={[-0.4, 2.55, 0]} rotation={[0, 0, 0.5]}><capsuleGeometry args={[0.08, 0.3, 4, 8]} /><meshStandardMaterial color="#a16207" /></mesh>
      <mesh position={[0.4, 2.55, 0]} rotation={[0, 0, -0.5]}><capsuleGeometry args={[0.08, 0.3, 4, 8]} /><meshStandardMaterial color="#a16207" /></mesh>
      {/* antlers */}
      <mesh position={[-0.2, 2.8, -0.05]} rotation={[0.1, 0, 0.2]}><cylinderGeometry args={[0.04, 0.03, 0.6, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[0.2, 2.8, -0.05]} rotation={[0.1, 0, -0.2]}><cylinderGeometry args={[0.04, 0.03, 0.6, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[-0.35, 3.05, -0.1]} rotation={[0, 0, 0.8]}><cylinderGeometry args={[0.03, 0.02, 0.3, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[0.35, 3.05, -0.1]} rotation={[0, 0, -0.8]}><cylinderGeometry args={[0.03, 0.02, 0.3, 6]} /><meshStandardMaterial color="#78350f" /></mesh>
      {/* legs */}
      <mesh position={[-0.3, 0, 0.25]}><cylinderGeometry args={[0.08, 0.07, 0.7, 8]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[0.3, 0, 0.25]}><cylinderGeometry args={[0.08, 0.07, 0.7, 8]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[-0.3, 0, -0.25]}><cylinderGeometry args={[0.08, 0.07, 0.7, 8]} /><meshStandardMaterial color="#78350f" /></mesh>
      <mesh position={[0.3, 0, -0.25]}><cylinderGeometry args={[0.08, 0.07, 0.7, 8]} /><meshStandardMaterial color="#78350f" /></mesh>
      {/* tail */}
      <mesh position={[0, 1.2, -0.7]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#fff" /></mesh>
    </group>
  );
}

function AnimalWolf({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 1.0, 0]}><capsuleGeometry args={[0.75, 1.3, 8, 16]} /><meshStandardMaterial color="#6b7280" /></mesh>
      {/* head */}
      <mesh position={[0, 2.1, 0.2]}><sphereGeometry args={[0.6, 16, 16]} /><meshStandardMaterial color="#9ca3af" /></mesh>
      {/* snout */}
      <mesh position={[0, 1.9, 0.75]}><capsuleGeometry args={[0.18, 0.3, 8, 8]} /><meshStandardMaterial color="#d1d5db" /></mesh>
      <mesh position={[0, 1.85, 0.95]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      {/* eyes */}
      <mesh position={[-0.2, 2.2, 0.55]}><sphereGeometry args={[0.09, 8, 8]} /><meshStandardMaterial color="#fbbf24" emissive="#713f12" /></mesh>
      <mesh position={[0.2, 2.2, 0.55]}><sphereGeometry args={[0.09, 8, 8]} /><meshStandardMaterial color="#fbbf24" emissive="#713f12" /></mesh>
      {/* ears */}
      <mesh position={[-0.3, 2.65, 0]} rotation={[0, 0, 0.15]}><coneGeometry args={[0.15, 0.4, 4]} /><meshStandardMaterial color="#6b7280" /></mesh>
      <mesh position={[0.3, 2.65, 0]} rotation={[0, 0, -0.15]}><coneGeometry args={[0.15, 0.4, 4]} /><meshStandardMaterial color="#6b7280" /></mesh>
      {/* chest */}
      <mesh position={[0, 0.8, 0.4]}><sphereGeometry args={[0.45, 12, 12]} /><meshStandardMaterial color="#e5e7eb" /></mesh>
      {/* tail */}
      <mesh position={[0, 0.8, -0.8]} rotation={[0.8, 0, 0]}><capsuleGeometry args={[0.15, 1.0, 4, 8]} /><meshStandardMaterial color="#9ca3af" /></mesh>
    </group>
  );
}

function AnimalTurtle({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* shell */}
      <mesh position={[0, 0.6, 0]}><sphereGeometry args={[0.9, 16, 12]} /><meshStandardMaterial color="#166534" /></mesh>
      {/* shell pattern */}
      <mesh position={[0, 0.85, 0]}><sphereGeometry args={[0.7, 6, 4]} /><meshStandardMaterial color="#15803d" wireframe /></mesh>
      {/* belly */}
      <mesh position={[0, 0.3, 0]}><sphereGeometry args={[0.75, 16, 12]} /><meshStandardMaterial color="#fef08a" /></mesh>
      {/* head */}
      <mesh position={[0, 0.5, 0.8]}><sphereGeometry args={[0.3, 12, 12]} /><meshStandardMaterial color="#22c55e" /></mesh>
      {/* eyes */}
      <mesh position={[-0.1, 0.6, 1.0]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[0.1, 0.6, 1.0]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#111" /></mesh>
      {/* legs */}
      <mesh position={[-0.55, 0.15, 0.4]} rotation={[0, 0, 0.6]}><capsuleGeometry args={[0.12, 0.3, 4, 8]} /><meshStandardMaterial color="#22c55e" /></mesh>
      <mesh position={[0.55, 0.15, 0.4]} rotation={[0, 0, -0.6]}><capsuleGeometry args={[0.12, 0.3, 4, 8]} /><meshStandardMaterial color="#22c55e" /></mesh>
      <mesh position={[-0.5, 0.15, -0.35]} rotation={[0, 0, 0.6]}><capsuleGeometry args={[0.12, 0.3, 4, 8]} /><meshStandardMaterial color="#22c55e" /></mesh>
      <mesh position={[0.5, 0.15, -0.35]} rotation={[0, 0, -0.6]}><capsuleGeometry args={[0.12, 0.3, 4, 8]} /><meshStandardMaterial color="#22c55e" /></mesh>
      {/* tail */}
      <mesh position={[0, 0.3, -0.85]}><coneGeometry args={[0.08, 0.3, 6]} /><meshStandardMaterial color="#22c55e" /></mesh>
    </group>
  );
}

/* ── NEW Items ─────────────────────────────── */

function PropStaff({ scale: s }: { scale: number }) {
  return (
    <group scale={s} rotation={[0, 0, 0.1]}>
      {/* shaft */}
      <mesh position={[0, 2.0, 0]}><cylinderGeometry args={[0.06, 0.08, 4.0, 8]} /><meshStandardMaterial color="#5c4033" /></mesh>
      {/* orb */}
      <mesh position={[0, 4.2, 0]}><sphereGeometry args={[0.3, 16, 16]} /><meshStandardMaterial color="#7dd3fc" metalness={0.3} roughness={0.1} transparent opacity={0.8} /></mesh>
      {/* orb glow ring */}
      <mesh position={[0, 4.2, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.35, 0.03, 8, 24]} /><meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.5} /></mesh>
      {/* grip wrap */}
      <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[0.09, 0.09, 0.5, 8]} /><meshStandardMaterial color="#a16207" /></mesh>
    </group>
  );
}

function PropBowWeapon({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* bow body - curved */}
      <mesh position={[0, 2.0, 0]} rotation={[0, 0, 0]}><torusGeometry args={[1.2, 0.06, 8, 16, Math.PI]} /><meshStandardMaterial color="#92400e" /></mesh>
      {/* string */}
      <mesh position={[0, 2.0, 0]}><cylinderGeometry args={[0.01, 0.01, 2.4, 4]} /><meshStandardMaterial color="#e5e7eb" /></mesh>
      {/* grip */}
      <mesh position={[0, 2.0, -0.05]}><cylinderGeometry args={[0.08, 0.08, 0.4, 8]} /><meshStandardMaterial color="#78350f" /></mesh>
    </group>
  );
}

function PropLantern({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* top cap */}
      <mesh position={[0, 2.0, 0]}><coneGeometry args={[0.35, 0.3, 8]} /><meshStandardMaterial color="#b91c1c" /></mesh>
      {/* handle */}
      <mesh position={[0, 2.25, 0]} rotation={[0, 0, 0]}><torusGeometry args={[0.15, 0.02, 8, 16]} /><meshStandardMaterial color="#d4af37" metalness={0.6} /></mesh>
      {/* body */}
      <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.35, 0.3, 0.9, 8]} /><meshStandardMaterial color="#dc2626" transparent opacity={0.8} /></mesh>
      {/* glow */}
      <mesh position={[0, 1.4, 0]}><sphereGeometry args={[0.25, 12, 12]} /><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.8} transparent opacity={0.6} /></mesh>
      {/* bottom */}
      <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.3, 0.25, 0.1, 8]} /><meshStandardMaterial color="#d4af37" metalness={0.6} /></mesh>
      {/* tassel */}
      <mesh position={[0, 0.7, 0]}><cylinderGeometry args={[0.02, 0.08, 0.3, 6]} /><meshStandardMaterial color="#dc2626" /></mesh>
    </group>
  );
}

function PropCrown({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* base ring */}
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.6, 0.65, 0.3, 16]} /><meshStandardMaterial color="#d4af37" metalness={0.7} roughness={0.25} /></mesh>
      {/* spikes */}
      {[0, 72, 144, 216, 288].map((angle) => (
        <mesh key={angle} position={[Math.sin(d(angle)) * 0.5, 0.8, Math.cos(d(angle)) * 0.5]}>
          <coneGeometry args={[0.12, 0.6, 4]} /><meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.25} />
        </mesh>
      ))}
      {/* gems on spikes */}
      {[0, 144, 288].map((angle) => (
        <mesh key={`gem-${angle}`} position={[Math.sin(d(angle)) * 0.48, 0.55, Math.cos(d(angle)) * 0.48]}>
          <sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#dc2626" metalness={0.3} roughness={0.1} />
        </mesh>
      ))}
    </group>
  );
}

function PropRing({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.5, 0.1, 16, 32]} /><meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} /></mesh>
      <mesh position={[0, 0.5, 0.5]}><octahedronGeometry args={[0.2, 0]} /><meshStandardMaterial color="#8b5cf6" metalness={0.3} roughness={0.1} transparent opacity={0.9} /></mesh>
    </group>
  );
}

function PropPotion({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* bottle body */}
      <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.5, 16, 16]} /><meshStandardMaterial color="#a78bfa" transparent opacity={0.5} /></mesh>
      {/* liquid */}
      <mesh position={[0, 0.35, 0]}><sphereGeometry args={[0.42, 16, 12]} /><meshStandardMaterial color="#7c3aed" transparent opacity={0.7} /></mesh>
      {/* neck */}
      <mesh position={[0, 1.1, 0]}><cylinderGeometry args={[0.12, 0.18, 0.5, 8]} /><meshStandardMaterial color="#c4b5fd" transparent opacity={0.5} /></mesh>
      {/* cork */}
      <mesh position={[0, 1.45, 0]}><cylinderGeometry args={[0.14, 0.12, 0.2, 8]} /><meshStandardMaterial color="#a16207" /></mesh>
      {/* bubbles */}
      <mesh position={[-0.1, 0.55, 0.15]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#e9d5ff" transparent opacity={0.6} /></mesh>
      <mesh position={[0.15, 0.65, -0.1]}><sphereGeometry args={[0.04, 8, 8]} /><meshStandardMaterial color="#e9d5ff" transparent opacity={0.6} /></mesh>
    </group>
  );
}

function PropScroll({ scale: s }: { scale: number }) {
  return (
    <group scale={s} rotation={[0.2, 0.3, 0]}>
      {/* rolled paper body */}
      <mesh position={[0, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.25, 0.25, 2.0, 12]} /><meshStandardMaterial color="#fef3c7" /></mesh>
      {/* end caps */}
      <mesh position={[-1.05, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.3, 0.3, 0.1, 12]} /><meshStandardMaterial color="#92400e" /></mesh>
      <mesh position={[1.05, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.3, 0.3, 0.1, 12]} /><meshStandardMaterial color="#92400e" /></mesh>
      {/* ribbon */}
      <mesh position={[0, 0.5, 0.25]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.02, 0.02, 0.6, 4]} /><meshStandardMaterial color="#dc2626" /></mesh>
    </group>
  );
}

function PropGuitar({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* body */}
      <mesh position={[0, 0.6, 0]}><sphereGeometry args={[0.7, 16, 16]} /><meshStandardMaterial color="#a16207" /></mesh>
      <mesh position={[0, 1.2, 0]}><sphereGeometry args={[0.5, 16, 16]} /><meshStandardMaterial color="#92400e" /></mesh>
      {/* sound hole */}
      <mesh position={[0, 0.6, 0.55]} rotation={[0, 0, 0]}><torusGeometry args={[0.2, 0.03, 8, 16]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
      {/* neck */}
      <mesh position={[0, 2.2, 0]}><boxGeometry args={[0.15, 1.6, 0.08]} /><meshStandardMaterial color="#78350f" /></mesh>
      {/* headstock */}
      <mesh position={[0, 3.1, 0]}><boxGeometry args={[0.2, 0.3, 0.1]} /><meshStandardMaterial color="#5c4033" /></mesh>
      {/* strings */}
      <mesh position={[0, 1.8, 0.06]}><boxGeometry args={[0.08, 2.5, 0.01]} /><meshStandardMaterial color="#e5e7eb" /></mesh>
      {/* bridge */}
      <mesh position={[0, 0.2, 0.55]}><boxGeometry args={[0.3, 0.05, 0.04]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
    </group>
  );
}

function PropUmbrella({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* canopy */}
      <mesh position={[0, 3.0, 0]}><coneGeometry args={[1.5, 0.6, 8]} /><meshStandardMaterial color="#ec4899" side={2} /></mesh>
      {/* shaft */}
      <mesh position={[0, 1.5, 0]}><cylinderGeometry args={[0.04, 0.04, 3.0, 8]} /><meshStandardMaterial color="#374151" /></mesh>
      {/* handle */}
      <mesh position={[0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.15, 0.03, 8, 12, Math.PI]} /><meshStandardMaterial color="#374151" /></mesh>
      {/* tip */}
      <mesh position={[0, 3.35, 0]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#374151" /></mesh>
    </group>
  );
}

function PropHammer({ scale: s }: { scale: number }) {
  return (
    <group scale={s} rotation={[0, 0, 0.1]}>
      {/* handle */}
      <mesh position={[0, 1.5, 0]}><cylinderGeometry args={[0.06, 0.07, 3.0, 8]} /><meshStandardMaterial color="#78350f" /></mesh>
      {/* head */}
      <mesh position={[0, 3.1, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.35, 0.35, 1.2, 8]} /><meshStandardMaterial color="#6b7280" metalness={0.7} roughness={0.3} /></mesh>
      {/* grip */}
      <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.08, 0.08, 0.6, 8]} /><meshStandardMaterial color="#a16207" /></mesh>
    </group>
  );
}

function PropWand({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* shaft */}
      <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[0.04, 0.06, 2.2, 8]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
      {/* star tip */}
      <mesh position={[0, 2.5, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.25, 0.25, 0.08, 5, 1]} /><meshStandardMaterial color="#fbbf24" emissive="#a16207" emissiveIntensity={0.6} /></mesh>
      {/* sparkle dots */}
      <mesh position={[-0.15, 2.7, 0]}><sphereGeometry args={[0.04, 6, 6]} /><meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={0.8} /></mesh>
      <mesh position={[0.2, 2.6, 0.1]}><sphereGeometry args={[0.03, 6, 6]} /><meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={0.8} /></mesh>
      {/* grip */}
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.06, 0.05, 0.4, 8]} /><meshStandardMaterial color="#6d28d9" /></mesh>
    </group>
  );
}

function PropHeartShape({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* left lobe */}
      <mesh position={[-0.28, 0.9, 0]}><sphereGeometry args={[0.4, 16, 16]} /><meshStandardMaterial color="#f43f5e" /></mesh>
      {/* right lobe */}
      <mesh position={[0.28, 0.9, 0]}><sphereGeometry args={[0.4, 16, 16]} /><meshStandardMaterial color="#f43f5e" /></mesh>
      {/* bottom point */}
      <mesh position={[0, 0.35, 0]} rotation={[0, 0, Math.PI]}><coneGeometry args={[0.55, 0.7, 16]} /><meshStandardMaterial color="#e11d48" /></mesh>
    </group>
  );
}

function PropMoonShape({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* main moon */}
      <mesh position={[0, 1.0, 0]}><sphereGeometry args={[0.8, 24, 24]} /><meshStandardMaterial color="#fde68a" emissive="#a16207" emissiveIntensity={0.3} /></mesh>
      {/* cutout (darker sphere offset to make crescent) */}
      <mesh position={[0.35, 1.15, 0.15]}><sphereGeometry args={[0.65, 24, 24]} /><meshStandardMaterial color="#1e293b" /></mesh>
    </group>
  );
}

function PropSunShape({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* core */}
      <mesh position={[0, 1.0, 0]}><sphereGeometry args={[0.5, 24, 24]} /><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.6} /></mesh>
      {/* rays */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <mesh key={angle} position={[Math.sin(d(angle)) * 0.85, 1.0 + Math.cos(d(angle)) * 0.85, 0]} rotation={[0, 0, d(-angle)]}>
          <coneGeometry args={[0.08, 0.35, 4]} /><meshStandardMaterial color="#f59e0b" emissive="#d97706" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function PropTreasureChest({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* base */}
      <mesh position={[0, 0.3, 0]}><boxGeometry args={[1.4, 0.6, 0.9]} /><meshStandardMaterial color="#92400e" /></mesh>
      {/* lid (open) */}
      <mesh position={[0, 0.75, -0.3]} rotation={[-0.6, 0, 0]}><boxGeometry args={[1.4, 0.15, 0.9]} /><meshStandardMaterial color="#78350f" /></mesh>
      {/* gold coins inside */}
      <mesh position={[0, 0.55, 0]}><sphereGeometry args={[0.35, 12, 8]} /><meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.3} /></mesh>
      <mesh position={[-0.25, 0.5, 0.15]}><sphereGeometry args={[0.15, 8, 8]} /><meshStandardMaterial color="#d4af37" metalness={0.7} /></mesh>
      <mesh position={[0.2, 0.5, -0.1]}><sphereGeometry args={[0.12, 8, 8]} /><meshStandardMaterial color="#f59e0b" metalness={0.7} /></mesh>
      {/* lock */}
      <mesh position={[0, 0.45, 0.46]}><boxGeometry args={[0.15, 0.15, 0.05]} /><meshStandardMaterial color="#d4af37" metalness={0.6} /></mesh>
      {/* gem inside */}
      <mesh position={[0.15, 0.65, 0.1]}><octahedronGeometry args={[0.12, 0]} /><meshStandardMaterial color="#dc2626" metalness={0.3} roughness={0.1} /></mesh>
    </group>
  );
}

function PropBalloon({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* balloon body */}
      <mesh position={[0, 2.0, 0]}><sphereGeometry args={[0.6, 16, 16]} /><meshStandardMaterial color="#f43f5e" transparent opacity={0.85} /></mesh>
      {/* knot */}
      <mesh position={[0, 1.35, 0]}><coneGeometry args={[0.08, 0.15, 6]} /><meshStandardMaterial color="#e11d48" /></mesh>
      {/* string */}
      <mesh position={[0, 0.7, 0]}><cylinderGeometry args={[0.01, 0.01, 1.2, 4]} /><meshStandardMaterial color="#e5e7eb" /></mesh>
      {/* highlight */}
      <mesh position={[-0.15, 2.2, 0.35]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#fff" transparent opacity={0.5} /></mesh>
    </group>
  );
}

function PropCandle({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* base plate */}
      <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.4, 0.45, 0.1, 12]} /><meshStandardMaterial color="#d4af37" metalness={0.5} /></mesh>
      {/* wax body */}
      <mesh position={[0, 0.7, 0]}><cylinderGeometry args={[0.15, 0.18, 1.2, 12]} /><meshStandardMaterial color="#fef3c7" /></mesh>
      {/* wick */}
      <mesh position={[0, 1.38, 0]}><cylinderGeometry args={[0.01, 0.01, 0.12, 4]} /><meshStandardMaterial color="#374151" /></mesh>
      {/* flame */}
      <mesh position={[0, 1.55, 0]}><sphereGeometry args={[0.08, 8, 8]} /><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1.0} /></mesh>
      <mesh position={[0, 1.65, 0]}><coneGeometry args={[0.06, 0.2, 8]} /><meshStandardMaterial color="#fb923c" emissive="#ea580c" emissiveIntensity={0.8} transparent opacity={0.8} /></mesh>
      {/* drip */}
      <mesh position={[0.08, 0.9, 0.15]}><sphereGeometry args={[0.04, 6, 6]} /><meshStandardMaterial color="#fef9c3" /></mesh>
    </group>
  );
}

function PropMask({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* face shape */}
      <mesh position={[0, 1.0, 0]}><sphereGeometry args={[0.7, 16, 16]} /><meshStandardMaterial color="#fef3c7" /></mesh>
      {/* eye holes */}
      <mesh position={[-0.25, 1.1, 0.55]}><sphereGeometry args={[0.15, 8, 8]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
      <mesh position={[0.25, 1.1, 0.55]}><sphereGeometry args={[0.15, 8, 8]} /><meshStandardMaterial color="#1e1b4b" /></mesh>
      {/* decorative elements */}
      <mesh position={[0, 1.5, 0.35]}><coneGeometry args={[0.5, 0.4, 8]} /><meshStandardMaterial color="#dc2626" /></mesh>
      {/* nose bridge */}
      <mesh position={[0, 0.9, 0.6]}><boxGeometry args={[0.08, 0.3, 0.08]} /><meshStandardMaterial color="#fde68a" /></mesh>
      {/* side ribbons */}
      <mesh position={[-0.65, 1.0, -0.15]} rotation={[0, 0, 0.3]}><capsuleGeometry args={[0.04, 0.5, 4, 8]} /><meshStandardMaterial color="#7c3aed" /></mesh>
      <mesh position={[0.65, 1.0, -0.15]} rotation={[0, 0, -0.3]}><capsuleGeometry args={[0.04, 0.5, 4, 8]} /><meshStandardMaterial color="#7c3aed" /></mesh>
    </group>
  );
}

/* ── NEW Effects ─────────────────────────────── */

function PropSparkle({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {[
        { pos: [0, 0.5, 0] as const, sz: 0.12, c: "#fde047" },
        { pos: [-0.3, 0.8, 0.2] as const, sz: 0.08, c: "#fbbf24" },
        { pos: [0.25, 1.0, -0.15] as const, sz: 0.1, c: "#f59e0b" },
        { pos: [0.1, 0.3, 0.3] as const, sz: 0.06, c: "#fef08a" },
        { pos: [-0.2, 1.2, 0.1] as const, sz: 0.09, c: "#fde047" },
        { pos: [0.35, 0.6, -0.2] as const, sz: 0.07, c: "#fbbf24" },
        { pos: [-0.1, 0.9, -0.25] as const, sz: 0.05, c: "#fef08a" },
      ].map((p, i) => (
        <mesh key={i} position={[p.pos[0], p.pos[1], p.pos[2]]}>
          <sphereGeometry args={[p.sz, 8, 8]} /><meshStandardMaterial color={p.c} emissive={p.c} emissiveIntensity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function PropFire({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* base flames */}
      <mesh position={[0, 0.4, 0]}><coneGeometry args={[0.45, 1.2, 8]} /><meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={0.7} transparent opacity={0.85} /></mesh>
      <mesh position={[-0.15, 0.55, 0.1]}><coneGeometry args={[0.3, 0.9, 8]} /><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.8} transparent opacity={0.8} /></mesh>
      <mesh position={[0.12, 0.5, -0.08]}><coneGeometry args={[0.25, 0.8, 8]} /><meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={0.9} transparent opacity={0.75} /></mesh>
      {/* core */}
      <mesh position={[0, 0.3, 0]}><coneGeometry args={[0.15, 0.5, 8]} /><meshStandardMaterial color="#fff" emissive="#fef08a" emissiveIntensity={1.0} transparent opacity={0.6} /></mesh>
      {/* embers */}
      <mesh position={[-0.3, 0.9, 0.15]}><sphereGeometry args={[0.04, 6, 6]} /><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1.0} /></mesh>
      <mesh position={[0.2, 1.0, -0.1]}><sphereGeometry args={[0.03, 6, 6]} /><meshStandardMaterial color="#fb923c" emissive="#ea580c" emissiveIntensity={1.0} /></mesh>
    </group>
  );
}

function PropLightning({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* bolt segments */}
      <mesh position={[0, 2.0, 0]} rotation={[0, 0, 0.1]}><boxGeometry args={[0.2, 1.0, 0.06]} /><meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={0.9} /></mesh>
      <mesh position={[0.15, 1.2, 0]} rotation={[0, 0, -0.3]}><boxGeometry args={[0.18, 0.8, 0.06]} /><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.9} /></mesh>
      <mesh position={[0.05, 0.5, 0]} rotation={[0, 0, 0.15]}><boxGeometry args={[0.15, 0.7, 0.06]} /><meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={0.9} /></mesh>
      {/* glow */}
      <mesh position={[0.1, 1.2, 0]}><sphereGeometry args={[0.3, 8, 8]} /><meshStandardMaterial color="#fef08a" transparent opacity={0.2} /></mesh>
    </group>
  );
}

function PropSnowflake({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {/* 6 arms */}
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <group key={angle} rotation={[0, 0, d(angle)]}>
          <mesh position={[0, 0.5, 0]}><boxGeometry args={[0.06, 0.8, 0.03]} /><meshStandardMaterial color="#bfdbfe" metalness={0.3} roughness={0.2} /></mesh>
          <mesh position={[-0.15, 0.65, 0]} rotation={[0, 0, 0.6]}><boxGeometry args={[0.04, 0.3, 0.03]} /><meshStandardMaterial color="#93c5fd" metalness={0.3} roughness={0.2} /></mesh>
          <mesh position={[0.15, 0.65, 0]} rotation={[0, 0, -0.6]}><boxGeometry args={[0.04, 0.3, 0.03]} /><meshStandardMaterial color="#93c5fd" metalness={0.3} roughness={0.2} /></mesh>
        </group>
      ))}
      {/* center */}
      <mesh position={[0, 0, 0]}><sphereGeometry args={[0.12, 12, 12]} /><meshStandardMaterial color="#dbeafe" metalness={0.4} roughness={0.1} /></mesh>
    </group>
  );
}

function PropRainbow({ scale: s }: { scale: number }) {
  const colors = ["#ef4444", "#f97316", "#fbbf24", "#22c55e", "#3b82f6", "#6366f1", "#a855f7"];
  return (
    <group scale={s} rotation={[0, 0, 0]}>
      {colors.map((color, i) => (
        <mesh key={i} position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.5 - i * 0.12, 0.05, 8, 32, Math.PI]} /><meshStandardMaterial color={color} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function PropBubbles({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {[
        { pos: [0, 0.5, 0] as const, sz: 0.25 },
        { pos: [-0.35, 0.9, 0.15] as const, sz: 0.18 },
        { pos: [0.3, 1.2, -0.1] as const, sz: 0.22 },
        { pos: [0.1, 0.3, 0.3] as const, sz: 0.15 },
        { pos: [-0.2, 1.5, 0.05] as const, sz: 0.2 },
        { pos: [0.25, 0.7, 0.25] as const, sz: 0.12 },
      ].map((b, i) => (
        <mesh key={i} position={[b.pos[0], b.pos[1], b.pos[2]]}>
          <sphereGeometry args={[b.sz, 16, 16]} /><meshStandardMaterial color="#bfdbfe" transparent opacity={0.3} metalness={0.1} roughness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

function PropLeaves({ scale: s }: { scale: number }) {
  return (
    <group scale={s}>
      {[
        { pos: [0, 0.3, 0] as const, rot: [0.2, 0.3, 0.5] as const, c: "#22c55e" },
        { pos: [-0.3, 0.7, 0.2] as const, rot: [0.5, -0.2, 0.8] as const, c: "#16a34a" },
        { pos: [0.25, 1.0, -0.15] as const, rot: [-0.3, 0.4, -0.6] as const, c: "#15803d" },
        { pos: [0.1, 0.5, 0.3] as const, rot: [0.1, 0.6, 0.3] as const, c: "#4ade80" },
        { pos: [-0.2, 1.2, 0.1] as const, rot: [0.7, -0.1, 0.4] as const, c: "#86efac" },
      ].map((leaf, i) => (
        <mesh key={i} position={[leaf.pos[0], leaf.pos[1], leaf.pos[2]]} rotation={[leaf.rot[0], leaf.rot[1], leaf.rot[2]]}>
          <boxGeometry args={[0.3, 0.02, 0.15]} /><meshStandardMaterial color={leaf.c} />
        </mesh>
      ))}
    </group>
  );
}

function PropFeather({ scale: s }: { scale: number }) {
  return (
    <group scale={s} rotation={[0, 0, 0.2]}>
      {/* quill */}
      <mesh position={[0, 1.0, 0]}><cylinderGeometry args={[0.02, 0.01, 2.0, 6]} /><meshStandardMaterial color="#f5f5f4" /></mesh>
      {/* vane */}
      <mesh position={[-0.15, 1.3, 0]} rotation={[0, 0, 0.15]}><boxGeometry args={[0.35, 1.2, 0.02]} /><meshStandardMaterial color="#e0e7ff" transparent opacity={0.85} /></mesh>
      <mesh position={[0.12, 1.3, 0]} rotation={[0, 0, -0.15]}><boxGeometry args={[0.25, 1.0, 0.02]} /><meshStandardMaterial color="#c7d2fe" transparent opacity={0.85} /></mesh>
      {/* tip */}
      <mesh position={[0, 2.1, 0]}><coneGeometry args={[0.08, 0.15, 6]} /><meshStandardMaterial color="#e0e7ff" /></mesh>
    </group>
  );
}

const PROP_COMPONENTS: Record<string, FC<{ scale: number }>> = {
  cat: AnimalCat, dog: AnimalDog, bunny: AnimalBunny, bird: AnimalBird,
  fox: AnimalFox, bear: AnimalBear, chick: AnimalChick, fish: AnimalFish,
  sword: PropSword, shield: PropShield, book: PropBook, flower: PropFlower,
  gem: PropGem, crystal: PropCrystal, cloud: PropCloud, star: PropStar,
  /* new animals */
  penguin: AnimalPenguin, dragon: AnimalDragon, unicorn: AnimalUnicorn, owl: AnimalOwl,
  butterfly: AnimalButterfly, deer: AnimalDeer, wolf: AnimalWolf, turtle: AnimalTurtle,
  /* new items */
  staff: PropStaff, bowWeapon: PropBowWeapon, lantern: PropLantern, crown: PropCrown,
  ring: PropRing, potion: PropPotion, scroll: PropScroll, guitar: PropGuitar,
  umbrella: PropUmbrella, hammer: PropHammer, wand: PropWand, heartProp: PropHeartShape,
  moon: PropMoonShape, sun: PropSunShape, treasureChest: PropTreasureChest, balloon: PropBalloon,
  candle: PropCandle, mask: PropMask,
  /* new effects */
  sparkle: PropSparkle, fire: PropFire, lightning: PropLightning, snowflake: PropSnowflake,
  rainbow: PropRainbow, bubbles: PropBubbles, leaves: PropLeaves, feather: PropFeather,
};

export const DEFAULT_BONE_OFFSETS: Record<string, Partial<Record<VRMHumanBoneName, Partial<PropAttachmentConfig>>>> = {
  sword: {
    rightHand: { offsetX: 0.05, offsetY: 0.12, offsetZ: -0.05, rotX: 70, rotY: 0, rotZ: -20, scale: 0.75 },
    leftHand: { offsetX: -0.05, offsetY: 0.12, offsetZ: -0.05, rotX: 70, rotY: 0, rotZ: 20, scale: 0.75 },
    head: { offsetX: 0, offsetY: 0.28, offsetZ: -0.1, rotX: 90, rotY: 0, rotZ: 0, scale: 0.8 },
  },
  shield: {
    leftHand: { offsetX: -0.08, offsetY: 0.06, offsetZ: 0.04, rotX: 0, rotY: 85, rotZ: 0, scale: 0.75 },
    rightHand: { offsetX: 0.08, offsetY: 0.06, offsetZ: 0.04, rotX: 0, rotY: -85, rotZ: 0, scale: 0.75 },
    hips: { offsetX: 0, offsetY: -0.15, offsetZ: -0.15, rotX: 180, rotY: 0, rotZ: 0, scale: 0.9 },
  },
  flower: {
    head: { offsetX: 0.05, offsetY: 0.14, offsetZ: 0.04, rotX: 0, rotY: 0, rotZ: 15, scale: 1.0 },
    rightHand: { offsetX: 0.02, offsetY: 0.08, offsetZ: 0, rotX: 90, rotY: 0, rotZ: 0, scale: 0.8 },
    leftHand: { offsetX: -0.02, offsetY: 0.08, offsetZ: 0, rotX: 90, rotY: 0, rotZ: 0, scale: 0.8 },
  },
  star: {
    head: { offsetX: 0, offsetY: 0.26, offsetZ: 0.02, rotX: 0, rotY: 0, rotZ: 0, scale: 0.7 },
  },
  cloud: {
    head: { offsetX: 0, offsetY: 0.38, offsetZ: -0.08, rotX: 0, rotY: 0, rotZ: 0, scale: 1.0 },
  },
  /* ── new bone offsets ── */
  staff: {
    rightHand: { offsetX: 0.05, offsetY: 0.15, offsetZ: -0.04, rotX: 75, rotY: 0, rotZ: -15, scale: 0.6 },
    leftHand: { offsetX: -0.05, offsetY: 0.15, offsetZ: -0.04, rotX: 75, rotY: 0, rotZ: 15, scale: 0.6 },
  },
  bowWeapon: {
    leftHand: { offsetX: -0.06, offsetY: 0.1, offsetZ: 0.02, rotX: 0, rotY: 90, rotZ: 0, scale: 0.6 },
    rightHand: { offsetX: 0.06, offsetY: 0.1, offsetZ: 0.02, rotX: 0, rotY: -90, rotZ: 0, scale: 0.6 },
  },
  crown: {
    head: { offsetX: 0, offsetY: 0.18, offsetZ: 0.02, rotX: 0, rotY: 0, rotZ: 0, scale: 0.55 },
  },
  hammer: {
    rightHand: { offsetX: 0.05, offsetY: 0.12, offsetZ: -0.05, rotX: 70, rotY: 0, rotZ: -15, scale: 0.55 },
    leftHand: { offsetX: -0.05, offsetY: 0.12, offsetZ: -0.05, rotX: 70, rotY: 0, rotZ: 15, scale: 0.55 },
  },
  wand: {
    rightHand: { offsetX: 0.03, offsetY: 0.1, offsetZ: -0.03, rotX: 65, rotY: 0, rotZ: -10, scale: 0.7 },
    leftHand: { offsetX: -0.03, offsetY: 0.1, offsetZ: -0.03, rotX: 65, rotY: 0, rotZ: 10, scale: 0.7 },
  },
  umbrella: {
    rightHand: { offsetX: 0.04, offsetY: 0.12, offsetZ: -0.04, rotX: 80, rotY: 0, rotZ: -10, scale: 0.5 },
    leftHand: { offsetX: -0.04, offsetY: 0.12, offsetZ: -0.04, rotX: 80, rotY: 0, rotZ: 10, scale: 0.5 },
  },
  lantern: {
    rightHand: { offsetX: 0.04, offsetY: 0.08, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 0.65 },
    leftHand: { offsetX: -0.04, offsetY: 0.08, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 0.65 },
  },
  guitar: {
    hips: { offsetX: 0.1, offsetY: 0, offsetZ: 0.1, rotX: 15, rotY: -20, rotZ: -10, scale: 0.55 },
  },
  mask: {
    head: { offsetX: 0, offsetY: -0.02, offsetZ: 0.12, rotX: 0, rotY: 0, rotZ: 0, scale: 0.6 },
  },
  ring: {
    rightHand: { offsetX: 0.02, offsetY: 0.02, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 0.4 },
    leftHand: { offsetX: -0.02, offsetY: 0.02, offsetZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 0.4 },
  },
};

export function SceneProp3D({
  propId,
  vrm,
  config,
  defaultPosition,
  defaultScale,
}: {
  propId: string;
  vrm: VRM | null;
  config: PropAttachmentConfig | undefined;
  defaultPosition: Vec3;
  defaultScale: number;
}) {
  const Comp = PROP_COMPONENTS[propId];
  const attachmentBone = config?.bone ?? "none";
  const [boneNode, setBoneNode] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    if (vrm && attachmentBone !== "none") {
      const node = vrm.humanoid?.getNormalizedBoneNode(attachmentBone);
      setBoneNode(node || null);
    } else {
      setBoneNode(null);
    }
  }, [vrm, attachmentBone]);

  if (!Comp) return null;

  if (boneNode) {
    const px = config?.offsetX ?? 0;
    const py = config?.offsetY ?? 0;
    const pz = config?.offsetZ ?? 0;
    const rx = THREE.MathUtils.degToRad(config?.rotX ?? 0);
    const ry = THREE.MathUtils.degToRad(config?.rotY ?? 0);
    const rz = THREE.MathUtils.degToRad(config?.rotZ ?? 0);
    const scl = (config?.scale ?? 1.0) * defaultScale;

    return createPortal(
      <group position={[px, py, pz]} rotation={[rx, ry, rz]}>
        <Comp scale={scl} />
      </group>,
      boneNode
    );
  }

  const worldX = defaultPosition[0] + (config?.offsetX ?? 0);
  const worldY = defaultPosition[1] + (config?.offsetY ?? 0);
  const worldZ = defaultPosition[2] + (config?.offsetZ ?? 0);
  const worldRotation: [number, number, number] = [
    THREE.MathUtils.degToRad(config?.rotX ?? 0),
    THREE.MathUtils.degToRad(config?.rotY ?? 0),
    THREE.MathUtils.degToRad(config?.rotZ ?? 0),
  ];
  const worldScale = (config?.scale ?? 1) * defaultScale;
  return (
    <group position={[worldX, worldY, worldZ]} rotation={worldRotation}>
      <Comp scale={worldScale} />
    </group>
  );
}
