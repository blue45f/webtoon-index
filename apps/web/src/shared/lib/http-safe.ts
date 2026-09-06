import { getLang, resolveI18nValue } from "./i18n";

export async function safeParseJson<T = unknown>(response: Response): Promise<T | null> {
  try {
    const raw = await response.text();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const SERVER_ERROR_KEY_MAP: Record<string, string> = {
  "로그인이 필요해요.": "apiError.loginRequired",
  "관리자 권한을 확인할 수 없습니다.": "apiError.adminRequired",
  "관리자 전용 페이지입니다.": "apiError.adminOnlyPage",
  "지원하지 않는 콘텐츠 타입이에요.": "apiError.unsupportedType",
  "비활성 계정은 관리자 권한을 사용할 수 없습니다.": "apiError.inactiveAccount",
  "정산 처리에 실패했습니다.": "apiError.settlementFailed",
};

// 서버 5xx Sanitized Envelope의 고정 문구 — 호출 맥락이 없는 내부용 문자열이라 그대로 노출하지
// 않고 호출자가 준 한국어 fallback(예: "서버 AI 요청에 실패했어요.")으로 대체한다.
const GENERIC_SERVER_ENVELOPE_MESSAGES = new Set([
  "Request could not be completed",
  "Internal server error",
]);

export function resolveApiError(payload: unknown, fallback: string): string {
  let rawMsg = "";

  if (payload && typeof payload === "object") {
    const errorField = (payload as { error?: unknown }).error;
    if (typeof errorField === "string" && errorField.trim().length > 0) {
      rawMsg = errorField.trim();
    } else {
      const messageField = (payload as { message?: unknown }).message;
      if (typeof messageField === "string" && messageField.trim().length > 0) {
        rawMsg = messageField.trim();
      } else if (Array.isArray(messageField)) {
        const first = messageField
          .map((item) => (typeof item === "string" ? item : ""))
          .find((item) => item.trim().length > 0);
        if (first) rawMsg = first.trim();
      }
    }
  }

  const msgToTranslate = rawMsg && !GENERIC_SERVER_ENVELOPE_MESSAGES.has(rawMsg) ? rawMsg : fallback;
  const key = SERVER_ERROR_KEY_MAP[msgToTranslate];
  if (key) {
    const translated = resolveI18nValue(getLang(), key);
    if (translated) return translated;
  }

  return msgToTranslate;
}

export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}
