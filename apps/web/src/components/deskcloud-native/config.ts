/**
 * DeskCloud 네이티브 통합 — 공용 설정/헬퍼.
 * ──────────────────────────────────────────────────────────────────────────
 * 형제 앱 공통 기능(피드백 설문·"What's new" 체인지로그·인앱 알림)을 외부 위젯 번들이
 * 아니라 **공식 npm SDK(@heejun/deskcloud)** 의 타입드 브라우저 클라이언트로 연결하고,
 * 화면은 **이 앱의 디자인 토큰/컴포넌트**로 직접 렌더한다(네이티브 룩앤필).
 *
 * 보안: 브라우저 코드는 publishable(pk_) 표면만 쓴다. `@heejun/deskcloud/server`(sk_)는
 * 절대 import 하지 않는다. pk_ 는 클라이언트 노출이 안전하며, 미지정 시 'pk_demo'로 폴백한다.
 *
 * env-gate: 각 desk 는 VITE_<DESK>DESK_URL 이 설정됐을 때만 활성화된다. 미설정이면 통합이
 * 비활성(렌더 트리에 추가되지 않음)이라 앱의 기존 1차(first-party) 기능에 무영향이다.
 */

const env = import.meta.env;

/** publishable 키 폴백(pk_demo). desk 전용 키가 있으면 그것을 쓴다. */
function pk(specific: string | undefined): string {
  return specific && specific.length > 0 ? specific : "pk_demo";
}

/** SurveyDesk(피드백 설문) 설정 — VITE_SURVEYDESK_URL 게이팅. */
export function surveyConfig(): { endpoint: string; publishableKey: string } | null {
  const endpoint = env.VITE_SURVEYDESK_URL;
  if (!endpoint) return null;
  return { endpoint, publishableKey: pk(env.VITE_SURVEYDESK_PK) };
}

/** ChangelogDesk("What's new") 설정 — VITE_CHANGELOGDESK_URL 게이팅. */
export function changelogConfig(): { endpoint: string; publishableKey: string } | null {
  const endpoint = env.VITE_CHANGELOGDESK_URL;
  if (!endpoint) return null;
  return { endpoint, publishableKey: pk(env.VITE_CHANGELOGDESK_PK) };
}

/** NotifyDesk(인앱 알림) 설정 — VITE_NOTIFYDESK_URL 게이팅. */
export function notifyConfig(): { endpoint: string; publishableKey: string } | null {
  const endpoint = env.VITE_NOTIFYDESK_URL;
  if (!endpoint) return null;
  return { endpoint, publishableKey: pk(env.VITE_NOTIFYDESK_PK) };
}

/**
 * AdDesk(스폰서 광고 지면) 설정 — VITE_ADDESK_URL 게이팅.
 *
 * 미설정이면 null → AdSlot 은 네트워크 광고를 부르지 않고 하우스 자리표시자로 폴백한다.
 * 광고 노출 자체는 전역 토글(monetizationEnabled, /api/config)이 켜진 뒤에만 일어난다 —
 * 즉 endpoint 설정과 수익화 토글이 **둘 다** 참이어야 실제 스폰서 크리에이티브가 서빙된다.
 */
export function adConfig(): { endpoint: string; publishableKey: string } | null {
  const endpoint = env.VITE_ADDESK_URL;
  if (!endpoint) return null;
  return { endpoint, publishableKey: pk(env.VITE_ADDESK_PK) };
}

const ANON_KEY = "ts:deskcloud:anon";

/**
 * 기기 단위 익명 식별자(localStorage 영속). Changelog unread/seen·Notify recipient 등
 * 로그인 없이도 "마지막으로 본 지점"을 추적하는 데 쓴다. 저장소 차단 환경에서는
 * 세션 메모리로 폴백해 동작은 유지하되 새로고침 시 초기화된다.
 */
let memoryAnonId: string | null = null;
export function getAnonId(): string {
  if (memoryAnonId) return memoryAnonId;
  try {
    const existing = globalThis.localStorage?.getItem(ANON_KEY);
    if (existing) {
      memoryAnonId = existing;
      return existing;
    }
  } catch {
    // 저장소 차단 — 메모리 폴백으로 진행
  }
  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `anon_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
  memoryAnonId = fresh;
  try {
    globalThis.localStorage?.setItem(ANON_KEY, fresh);
  } catch {
    // 저장소 차단 — 메모리에만 보관
  }
  return fresh;
}
