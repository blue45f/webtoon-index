import { withCsrfProtection } from "./csrf";
import { useApp } from "./store";

// 로그인 시 변경을 DB API로 write-through (게스트는 localStorage만)
export function apiPost(path: string, body: unknown, method = "POST") {
  if (typeof window === "undefined") return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = useApp.getState().sessionToken;
  if (token) headers["x-user-id"] = token; // 서명 세션 토큰(서버가 검증해 실제 userId로 치환)
  fetch(path, withCsrfProtection({ method, headers, body: JSON.stringify(body) })).catch(() => {});
}
