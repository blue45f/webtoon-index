/**
 * 진단·버그 리포트에 실릴 자유 텍스트에서 개인 식별 가능 조각을 지운다.
 *
 * 버그 리포트는 사용자가 **밖으로 내보내는** 산출물이다. 그러니 "아마 안전할
 * 것"이 아니라 "구조적으로 못 들어간다"여야 한다. 이 모듈은 리포트에 들어가는
 * 모든 문자열이 통과하는 단 하나의 문이고, `studio-bug-report-package.test.ts`
 * 가 그 계약을 고정한다.
 *
 * 지우는 것: 이메일, http(s)/blob/data URI, 파일 경로, 32자 이상 토큰(키·해시),
 * 그리고 한국어·영문 이름처럼 보이는 따옴표 안의 문자열은 **지우지 않는다** —
 * 오탐으로 오류 메시지를 못 읽게 만들면 리포트가 쓸모없어지기 때문이다. 대신
 * 문서에서 온 자유 텍스트(레이어 이름·대사·파일명)는 애초에 리포트에 넣지 않는다.
 */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/gu;
const DATA_URI = /\b(?:data|blob):[^\s"')]+/giu;
const HTTP_URL = /\bhttps?:\/\/[^\s"')]+/giu;
/**
 * 원고·자산 파일 이름과 그것이 놓인 경로. 확장자를 열거해서 잡는 이유는, "점이
 * 들어간 낱말"을 통째로 지우면 오류 메시지가 읽을 수 없게 되기 때문이다. 파일
 * 이름은 한글일 수 있으므로 경로 몸통에 문자 종류 제한을 두지 않는다.
 */
const FILE_NAME =
  /\S*\.(?:psd|psb|clip|sut|abr|myb|kpp|ora|cbz|will|png|jpe?g|gif|webp|avif|svg|bmp|tiff?|pdf|json|zip|md|txt|csv|mp4|webm|mov|glb|gltf|vrm|obj|fbx|wasm)\b/giu;
/** 확장자가 없는 깊은 경로 — `/Users/foo/bar`, `C:\Users\foo\bar`. */
const DEEP_PATH = /(?:[A-Za-z]:\\|\/)(?:[^\s"'/\\]+[/\\]){2,}[^\s"'/\\]*/gu;
/** base64/hex 덩어리 — 토큰·해시·직렬화된 픽셀. */
const LONG_TOKEN = /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/gu;

export const STUDIO_REDACTION_PLACEHOLDER = "[가림]";

/** 리포트에 싣는 자유 텍스트의 최대 길이. 넘치면 잘라내고 표시한다. */
export const STUDIO_REDACTION_MAX_LENGTH = 240;

export function redactStudioDiagnosticText(input: string): string {
  const cleaned = input
    .replace(EMAIL, STUDIO_REDACTION_PLACEHOLDER)
    .replace(DATA_URI, STUDIO_REDACTION_PLACEHOLDER)
    .replace(HTTP_URL, STUDIO_REDACTION_PLACEHOLDER)
    .replace(FILE_NAME, STUDIO_REDACTION_PLACEHOLDER)
    .replace(DEEP_PATH, STUDIO_REDACTION_PLACEHOLDER)
    .replace(LONG_TOKEN, STUDIO_REDACTION_PLACEHOLDER)
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length > STUDIO_REDACTION_MAX_LENGTH
    ? `${cleaned.slice(0, STUDIO_REDACTION_MAX_LENGTH)}…`
    : cleaned;
}

/** `https://host/studio/work-123?token=…` → `https://host` — 경로·질의는 버린다. */
export function redactStudioLocation(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).origin;
  } catch {
    return null;
  }
}
