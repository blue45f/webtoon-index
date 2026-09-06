export type AvatarPreset = {
  id: string;
  name: string;
  tone: string;
  color: string;
  accent: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: "ember-index",
    name: "첫화의 불씨",
    tone: "리뷰와 발견을 선명하게 남기는 독자",
    color: "oklch(0.72 0.185 42)",
    accent: "oklch(0.82 0.15 80)",
  },
  {
    id: "midnight-archive",
    name: "심야 서고",
    tone: "새벽에 조용히 정주행작을 고르는 독자",
    color: "oklch(0.67 0.13 282)",
    accent: "oklch(0.78 0.1 232)",
  },
  {
    id: "deep-route",
    name: "딥루트",
    tone: "플랫폼을 넘나들며 원작과 각색을 추적하는 독자",
    color: "oklch(0.7 0.13 222)",
    accent: "oklch(0.8 0.11 232)",
  },
  {
    id: "mint-signal",
    name: "민트 시그널",
    tone: "무료 회차와 기다무 타이밍을 놓치지 않는 독자",
    color: "oklch(0.76 0.14 166)",
    accent: "oklch(0.8 0.15 150)",
  },
  {
    id: "rose-comment",
    name: "장면 수집가",
    tone: "인상적인 컷과 문장을 오래 기억하는 독자",
    color: "oklch(0.72 0.17 350)",
    accent: "oklch(0.82 0.12 25)",
  },
  {
    id: "golden-run",
    name: "정주행 노트",
    tone: "완결작과 긴 호흡의 시리즈를 차곡차곡 읽는 독자",
    color: "oklch(0.78 0.15 78)",
    accent: "oklch(0.72 0.185 42)",
  },
];

export const LEGACY_AVATAR_COLORS = ["#ff5a36", "#9b7bff", "#5a8cff", "#22b8a6", "#ff6b9d", "#f4a52a"];
export const MAX_AVATAR_IMAGE_BYTES = 180 * 1024;

const AVATAR_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

export function resolveSignupAvatar(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const preset = AVATAR_PRESETS.find((item) => item.id === raw);
  if (preset) return preset.color;
  if (LEGACY_AVATAR_COLORS.includes(raw)) return raw;
  return AVATAR_PRESETS[0].color;
}

export function resolveSignupAvatarImage(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  const match = AVATAR_IMAGE_RE.exec(raw);
  if (!match) return null;

  const mimeSubtype = match[1].toLowerCase();
  const base64 = match[2];
  if (!base64 || base64.length % 4 !== 0) return null;
  if (decodedBase64Bytes(base64) > MAX_AVATAR_IMAGE_BYTES) return null;
  if (!hasImageSignature(mimeSubtype, base64)) return null;

  return raw;
}

export function pickAvatarPreset(name: string, email: string): AvatarPreset {
  const seed = `${name.trim().toLowerCase()}|${email.trim().toLowerCase()}`;
  const index = hashSeed(seed) % AVATAR_PRESETS.length;
  return AVATAR_PRESETS[index] ?? AVATAR_PRESETS[0];
}

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function hasImageSignature(mimeSubtype: string, base64: string): boolean {
  const bytes = decodeBase64Prefix(base64);
  if (mimeSubtype === "png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeSubtype === "jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeSubtype === "webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

function decodeBase64Prefix(base64: string): number[] {
  try {
    const binary = atob(base64.slice(0, 32));
    return Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return [];
  }
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
