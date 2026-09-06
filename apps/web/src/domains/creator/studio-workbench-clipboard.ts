/**
 * 이 헬퍼는 `lib/copy-text.ts` 로 옮겼다 — 인앱 브라우저에서 제일 먼저 깨지는 복사 버튼이
 * `src/components/browser-compat-modal.tsx` 에 있고, 그 레이어는 `src/domains` 를 import 하지
 * 않기 때문이다. 스튜디오 쪽 호출부를 위해 이름만 다시 내보낸다.
 */
export { copyStudioText } from "../../shared/lib/copy-text";
