import { z } from "zod";

export const STUDIO_REMOTE_REFERENCE_IMAGE_CONTRACT_VERSION = 1 as const;
export const STUDIO_REMOTE_REFERENCE_IMAGE_ENDPOINT =
  "/api/creator/reference-images/import" as const;
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_URL_LENGTH = 2_048;
// Vercel Functions enforce a 4.5 MB request/response body limit:
// https://vercel.com/docs/functions/limitations#request-body-size
// A 3,000,000-byte image expands to exactly 4,000,000 base64 characters, leaving deterministic
// room for the data-URL prefix and JSON metadata below the separate 4,200,000-byte ceiling.
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES = 3_000_000;
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES = 4_200_000;
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_AXIS = 16_384;
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_PIXELS = 16_777_216;
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_DECODED_RGBA_BYTES =
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_PIXELS * 4;
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_REDIRECTS = 3;
export const STUDIO_REMOTE_REFERENCE_IMAGE_TIMEOUT_MS = 10_000;
export const STUDIO_REMOTE_REFERENCE_IMAGE_MAX_DATA_URL_LENGTH =
  "data:image/webp;base64,".length +
  Math.ceil(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES / 3) * 4;

export const STUDIO_REMOTE_REFERENCE_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const StudioRemoteReferenceImageMediaTypeSchema = z.enum(
  STUDIO_REMOTE_REFERENCE_IMAGE_MEDIA_TYPES
);

export type StudioRemoteReferenceImageMediaType = z.infer<
  typeof StudioRemoteReferenceImageMediaTypeSchema
>;

function remoteReferenceUrlIssue(value: string): string | null {
  if ([...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f;
  })) {
    return "URL에는 공백이나 제어 문자를 사용할 수 없습니다.";
  }
  if (value.includes("\\")) {
    return "URL에는 역슬래시를 사용할 수 없습니다.";
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "올바른 이미지 URL을 입력해 주세요.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "HTTP 또는 HTTPS 이미지 URL만 사용할 수 있습니다.";
  }
  if (url.username || url.password) {
    return "사용자 이름이나 비밀번호가 포함된 URL은 사용할 수 없습니다.";
  }
  if (url.hash) {
    return "URL 조각(#fragment)은 사용할 수 없습니다.";
  }
  // WHATWG URL은 명시된 :80/:443을 빈 port로 정규화한다. 따라서 여기서 남는 값은
  // 프로토콜의 표준 포트가 아닌 포트뿐이다.
  if (url.port) {
    return "HTTP 80 또는 HTTPS 443 표준 포트만 사용할 수 있습니다.";
  }
  if (!url.hostname || url.hostname.length > 253) {
    return "URL 호스트 이름이 올바르지 않습니다.";
  }
  return null;
}

export const StudioRemoteReferenceImageRequestSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "이미지 URL을 입력해 주세요.")
      .max(
        STUDIO_REMOTE_REFERENCE_IMAGE_MAX_URL_LENGTH,
        `이미지 URL은 ${STUDIO_REMOTE_REFERENCE_IMAGE_MAX_URL_LENGTH.toLocaleString("en-US")}자 이하여야 합니다.`
      )
      .superRefine((value, context) => {
        const issue = remoteReferenceUrlIssue(value);
        if (issue) context.addIssue({ code: "custom", message: issue });
      }),
  })
  .strict();

export const StudioRemoteReferenceImageResponseSchema = z
  .object({
    version: z.literal(STUDIO_REMOTE_REFERENCE_IMAGE_CONTRACT_VERSION),
    mediaType: StudioRemoteReferenceImageMediaTypeSchema,
    byteLength: z.number().int().min(1).max(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES),
    width: z.number().int().min(1).max(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_AXIS),
    height: z.number().int().min(1).max(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_AXIS),
    decodedRgbaBytes: z
      .number()
      .int()
      .min(4)
      .max(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_DECODED_RGBA_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    dataUrl: z.string().min(1).max(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_DATA_URL_LENGTH),
  })
  .strict()
  .superRefine((value, context) => {
    const pixels = value.width * value.height;
    if (
      !Number.isSafeInteger(pixels) ||
      pixels > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_PIXELS ||
      value.decodedRgbaBytes !== pixels * 4
    ) {
      context.addIssue({
        code: "custom",
        path: ["decodedRgbaBytes"],
        message: "이미지 크기와 RGBA 디코드 비용이 일치하지 않습니다.",
      });
    }
    if (!value.dataUrl.startsWith(`data:${value.mediaType};base64,`)) {
      context.addIssue({
        code: "custom",
        path: ["dataUrl"],
        message: "이미지 MIME과 data URL이 일치하지 않습니다.",
      });
    }
  });

export type StudioRemoteReferenceImageRequest = z.infer<
  typeof StudioRemoteReferenceImageRequestSchema
>;
export type StudioRemoteReferenceImageResponse = z.infer<
  typeof StudioRemoteReferenceImageResponseSchema
>;

export function studioRemoteReferenceImagePath(): typeof STUDIO_REMOTE_REFERENCE_IMAGE_ENDPOINT {
  return STUDIO_REMOTE_REFERENCE_IMAGE_ENDPOINT;
}
