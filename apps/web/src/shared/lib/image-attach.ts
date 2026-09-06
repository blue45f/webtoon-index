// 커뮤니티 게시글 이미지 첨부 — 공용 한도/검증(서버·클라이언트)과 클라이언트 다운스케일.
// 저장 형식은 creator_asset.dataUrl과 동일한 "축소된 webp/jpeg 데이터 URL"(별도 스토리지 없음).
// 클라이언트가 긴 변 1600px 이하로 줄이고, 서버는 데이터 URL의 실제 바이트(≤2MB)와 형식만 다시 검증한다.

export const ATTACHMENT_MAX_COUNT = 3; // 게시글당 최대 첨부 수
export const ATTACHMENT_MAX_DIMENSION = 1600; // px — 긴 변 기준
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024; // 2MB — 디코딩된 이미지 바이트 캡

const DATA_URL_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;

// 데이터 URL의 base64 본문이 디코딩되면 몇 바이트인지 계산(업로드 없이 용량 캡 검증).
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length / 4) * 3 - padding));
}

export function isAllowedImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && DATA_URL_RE.test(value);
}

// 첨부 목록 검증 — 형식·개수·개별 용량을 확인하고 정규화된 배열 또는 오류 메시지를 돌려준다.
export function validateAttachmentImages(value: unknown): { images?: string[]; error?: string } {
  if (value === undefined || value === null) return { images: [] };
  if (!Array.isArray(value)) return { error: "첨부 형식이 올바르지 않아요." };
  if (value.length > ATTACHMENT_MAX_COUNT) {
    return { error: `이미지는 최대 ${ATTACHMENT_MAX_COUNT}장까지 첨부할 수 있어요.` };
  }
  const images: string[] = [];
  for (const item of value) {
    if (!isAllowedImageDataUrl(item)) {
      return { error: "이미지는 webp/jpeg/png 데이터 URL만 첨부할 수 있어요." };
    }
    if (dataUrlBytes(item) > ATTACHMENT_MAX_BYTES) {
      return { error: "이미지 한 장은 2MB 이하여야 해요." };
    }
    images.push(item);
  }
  return { images };
}

// ── 클라이언트 전용(브라우저 DOM) ──────────────────────────────────────────────

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했어요."));
    };
    img.src = url;
  });
}

// 파일 → 긴 변 1600px 이하 webp(미지원 시 jpeg) 데이터 URL. 2MB를 넘으면 품질을 단계적으로 낮춘다.
// avatar-uploader의 다운스케일 컨벤션을 따르되, 크롭 없이 비율을 유지한다.
export async function fileToAttachmentDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 첨부할 수 있어요.");
  const img = await loadImageFromFile(file);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > ATTACHMENT_MAX_DIMENSION ? ATTACHMENT_MAX_DIMENSION / longest : 1;
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 변환할 수 없어요.");
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.82;
  let out = canvas.toDataURL("image/webp", quality);
  if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlBytes(out) > ATTACHMENT_MAX_BYTES && quality > 0.35) {
    quality -= 0.12;
    out = out.startsWith("data:image/webp")
      ? canvas.toDataURL("image/webp", quality)
      : canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrlBytes(out) > ATTACHMENT_MAX_BYTES) {
    throw new Error("이미지를 2MB 이하로 줄이지 못했어요. 더 작은 이미지를 사용해 주세요.");
  }
  return out;
}
