import type { StudioAsset } from "./studio-asset-library";

export const STUDIO_CC0_DELIVERY_ROOT = "/assets/studio/cc0-20260906/";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export type StudioCc0AssetKind = "model" | "effect-mask" | "surface-texture";
export interface StudioCc0Asset {
  readonly id: string;
  readonly name: string;
  readonly kind: StudioCc0AssetKind;
  readonly category: string;
  readonly path: string;
  readonly previewPath?: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  readonly browserRenderVerified: boolean;
  readonly provider: string;
  readonly sourceUrl: string;
}

export const STUDIO_CC0_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  furniture: "가구 · 실내 소품",
  food: "음식 · 식기",
  nature: "나무 · 꽃 · 바위",
  architecture: "건축 · 거리",
  "outdoor-prop": "야외 · 캠핑 소품",
  "pbr-detailed-prop": "디테일 가구 · 생활 소품",
  "effect-mask": "투명 효과 마스크",
  "surface-material": "표면 재질",
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function studioCc0AssetUrl(relativePath: string): string {
  if (!/^(?:assets|previews)\/[a-zA-Z0-9_./-]+\.(?:glb|webp|png|jpg)$/u.test(relativePath)
    || relativePath.split("/").some(part => !part || part === "." || part === "..")) {
    throw new TypeError("허용되지 않은 내장 에셋 경로입니다.");
  }
  return STUDIO_CC0_DELIVERY_ROOT + relativePath;
}

export function parseStudioCc0Catalog(value: unknown): readonly StudioCc0Asset[] {
  const manifest = record(value);
  if (manifest?.schema !== "toonspectrum.asset-delivery.v1" || !Array.isArray(manifest.assets)
    || manifest.assets.length > 2400) throw new TypeError("에셋 목록 형식이 올바르지 않습니다.");
  const ids = new Set<string>();
  return Object.freeze(manifest.assets.map((input: unknown): StudioCc0Asset => {
    const asset = record(input);
    const license = record(asset?.license);
    if (!asset || typeof asset.id !== "string" || !/^[a-z0-9-]{1,200}$/u.test(asset.id)
      || ids.has(asset.id) || typeof asset.name !== "string" || asset.name.length > 160
      || !["model", "effect-mask", "surface-texture"].includes(String(asset.kind))
      || typeof asset.category !== "string" || asset.category.length > 80
      || typeof asset.path !== "string" || typeof asset.sha256 !== "string" || !SHA256.test(asset.sha256)
      || !Number.isSafeInteger(asset.bytes) || Number(asset.bytes) <= 0 || Number(asset.bytes) > 64 * 1024 * 1024
      || license?.id !== "CC0-1.0" || license.commercialUse !== true || license.redistributionAllowed !== true
      || typeof license.provider !== "string" || typeof license.sourceUrl !== "string") {
      throw new TypeError("에셋 출처·해시·라이선스 검증에 실패했습니다.");
    }
    const source = new URL(license.sourceUrl);
    if (source.protocol !== "https:" || !["kenney.nl", "ambientcg.com", "polyhaven.com"].includes(source.hostname)
      || source.username || source.password || source.port) throw new TypeError("확인되지 않은 에셋 공급처입니다.");
    studioCc0AssetUrl(asset.path);
    const kind = asset.kind as StudioCc0AssetKind;
    if ((kind === "model") !== asset.path.endsWith(".glb")) throw new TypeError("에셋 형식이 맞지 않습니다.");
    if (kind === "model") {
      if (asset.browserRenderVerified !== true || typeof asset.previewPath !== "string") {
        throw new TypeError("렌더링 검증을 통과하지 않은 3D 에셋입니다.");
      }
      studioCc0AssetUrl(asset.previewPath);
    } else if (!asset.path.endsWith(".webp") || !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height)
      || Number(asset.width) < 1 || Number(asset.height) < 1 || Number(asset.width) * Number(asset.height) > 32 * 1024 * 1024
      || Number(asset.bytes) > MAX_IMAGE_BYTES) throw new TypeError("이미지 크기 또는 형식이 맞지 않습니다.");
    ids.add(asset.id);
    return Object.freeze({id: asset.id, name: asset.name, kind, category: asset.category,
      path: asset.path, ...(typeof asset.previewPath === "string" ? {previewPath: asset.previewPath} : {}),
      bytes: Number(asset.bytes), sha256: asset.sha256,
      ...(kind !== "model" ? {width: Number(asset.width), height: Number(asset.height)} : {}),
      browserRenderVerified: asset.browserRenderVerified === true,
      provider: license.provider, sourceUrl: license.sourceUrl});
  }));
}

export function filterStudioCc0Assets(assets: readonly StudioCc0Asset[], query: string, kind?: StudioCc0AssetKind): readonly StudioCc0Asset[] {
  const terms = query.normalize("NFKC").toLocaleLowerCase("ko-KR").split(/\s+/u).filter(Boolean);
  return assets.filter(asset => (!kind || asset.kind === kind) && terms.every(term =>
    [asset.name, asset.category, STUDIO_CC0_CATEGORY_LABELS[asset.category] ?? "", asset.provider]
      .join(" ").normalize("NFKC").toLocaleLowerCase("ko-KR").includes(term)));
}

async function boundedBytes(url: string, limit: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, {signal, credentials: "same-origin", redirect: "error"});
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > limit) throw new Error("에셋을 불러오지 못했습니다.");
  if (!response.body) throw new Error("에셋 응답 본문이 없습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("에셋 다운로드 크기 제한을 초과했습니다."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function loadStudioCc0Catalog(signal?: AbortSignal): Promise<readonly StudioCc0Asset[]> {
  const bytes = await boundedBytes(STUDIO_CC0_DELIVERY_ROOT + "manifest.json", MAX_MANIFEST_BYTES, signal);
  return parseStudioCc0Catalog(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
}

export async function createStudioCc0ImageRecord(asset: StudioCc0Asset, signal?: AbortSignal): Promise<StudioAsset> {
  if (asset.kind === "model") throw new TypeError("3D 에셋은 3D 모델 가져오기를 사용해 주세요.");
  const bytes = await boundedBytes(studioCc0AssetUrl(asset.path), MAX_IMAGE_BYTES, signal);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (bytes.byteLength !== asset.bytes || hash !== asset.sha256) throw new Error("에셋 무결성 검증에 실패했습니다.");
  const bitmap = await createImageBitmap(new Blob([bytes], {type: "image/webp"}));
  try {
    if (bitmap.width !== asset.width || bitmap.height !== asset.height) throw new Error("에셋 이미지 크기가 일치하지 않습니다.");
  } finally { bitmap.close(); }
  signal?.throwIfAborted();
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return {id: `cc0:${asset.id}`, name: asset.name, dataUrl: `data:image/webp;base64,${btoa(binary)}`,
    contentHash: `sha256:${hash}`, width: asset.width!, height: asset.height!, createdAt: Date.UTC(2026, 8, 6), kind: "imported",
    rights: {sourceKind: "imported", sourceId: asset.id, licenseId: "CC0-1.0", licenseLabel: "CC0 1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", attributionRequired: false,
      attributionText: `${asset.provider} — ${asset.sourceUrl}`, rightsConfirmed: true}};
}
