// 방문 통계(Visits) API 클라이언트 — desk-platform 공개 REST API 직접 호출.
//
// desk-platform이 모든 형제 앱을 위한 가벼운 방문 집계 백엔드(인증 없음, CORS 오픈)를
// 제공한다. 별도 SDK/npm 의존성 없이 fetch만으로 하루 1회 핑(POST)·통계(GET)를 처리한다.
// 베이스 URL은 VITE_DESK_PLATFORM_URL 로 오버라이드한다(inquiry-api.ts와 동일 규칙).
//
// 설계 원칙: 절대 렌더를 막지 않고, 모든 에러를 삼킨다(애널리틱스는 best-effort).
// API가 죽어 있어도 앱은 정상 동작해야 한다.

const BASE = import.meta.env.VITE_DESK_PLATFORM_URL ?? "https://desk-platform.vercel.app";

/** 이 앱의 슬러그(레포 이름). desk-platform이 앱별 집계를 구분하는 키. */
export const APP_ID = "toonspectrum";

/**
 * 자동 방문 집계를 허용하는 정식 웹 origin.
 *
 * Vite preview도 운영 번들(`import.meta.env.PROD === true`)을 제공하므로 빌드 모드만으로는
 * 로컬 preview와 정식 배포를 구분할 수 없다. 자동·비필수 ping은 정확한 정식 origin에서만
 * 보내 개발 서버, 127.0.0.1, LAN preview, 테스트 및 Vercel preview의 잡음과 비용을 막는다.
 */
export const VISIT_PING_PRODUCTION_ORIGIN = "https://www.toonstudio.cloud";

/** 하루 1회 핑을 디바운스하기 위한 localStorage 키(YYYY-MM-DD 저장). */
const LAST_PING_KEY = "visits:last-ping";

/** GET …/visits/stats 응답(가이드 VisitStatsDto). 모든 값은 추정 없는 정수. */
export interface VisitStats {
  appId: string;
  /** 집계 기준일(YYYY-MM-DD, 서버 타임존). */
  day: string;
  todayVisits: number;
  todayUniques: number;
  totalVisits: number;
  totalUniques: number;
}

/** 로컬 자정 기준 오늘 날짜(YYYY-MM-DD). 핑 디바운스에 사용. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface VisitPingEnvironment {
  isProductionBuild: boolean;
  origin?: string;
}

/**
 * 자동 방문 핑을 보낼 수 있는 환경인지 순수하게 판정한다.
 *
 * 빌드 모드와 exact origin을 함께 확인해 Vite preview(`PROD=true`)도 자동으로 차단한다.
 */
export function shouldSendVisitPing({
  isProductionBuild,
  origin,
}: VisitPingEnvironment): boolean {
  if (!isProductionBuild || !origin) return false;
  // desk-platform's visits API is currently a dead rewrite (502 / no CORS).
  // Do not probe it from Studio until it is explicitly re-enabled.
  if (import.meta.env.VITE_DESK_PLATFORM_VISITS !== "1") return false;

  try {
    return new URL(origin).origin === VISIT_PING_PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * 하루 한 번만 방문 핑을 보낸다(`POST …/visits/ping`).
 * - localStorage(`visits:last-ping`)로 같은 날 재핑을 막는다(없으면 항상 시도).
 * - 정식 production origin 이외의 dev/preview/test 환경에서는 네트워크를 사용하지 않는다.
 * - 모든 에러를 삼킨다 — 네트워크/스토리지 실패가 앱에 새 나가지 않게 한다.
 * - 렌더를 막지 않도록 호출부에서 await 없이 fire-and-forget로 쓴다.
 */
export async function pingVisit(): Promise<void> {
  if (
    !shouldSendVisitPing({
      isProductionBuild: import.meta.env.PROD,
      origin: typeof location !== "undefined" ? location.origin : undefined,
    })
  ) {
    return;
  }

  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_PING_KEY);
  } catch {
    // 비공개 모드 등 localStorage 차단 — 키 없이 진행(중복 핑은 서버가 흡수).
  }

  const day = today();
  if (last === day) return; // 오늘 이미 핑함 — 조용히 종료.

  try {
    const path = typeof location !== "undefined" ? location.pathname : "";
    const endpoint = new URL(`${BASE}/api/v1/apps/${APP_ID}/visits/ping`);
    if (path) {
      endpoint.searchParams.set("path", path);
    }
    const res = await fetch(endpoint.toString(), {
      method: "POST",
      keepalive: true,
    });
    // 성공(2xx)일 때만 디바운스 기록 — 실패하면 다음 마운트에서 재시도한다.
    if (res.ok) {
      try {
        localStorage.setItem(LAST_PING_KEY, day);
      } catch {
        // 스토리지 차단 — 디바운스 없이 동작(영향 미미).
      }
    }
  } catch {
    // 네트워크 실패 — 무음. 다음 방문에 다시 시도한다.
  }
}

/**
 * 누적 방문 통계를 불러온다(`GET …/visits/stats`).
 * 실패 시 throw하지 않고 null을 반환한다 — 호출부는 값이 없으면 조용히 숨긴다.
 */
export async function fetchVisitStats(): Promise<VisitStats | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/apps/${APP_ID}/visits/stats`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<VisitStats>;
    // 최소 형태 검증 — 숫자 필드가 깨졌으면 0으로 보정한다.
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      appId: typeof data.appId === "string" ? data.appId : APP_ID,
      day: typeof data.day === "string" ? data.day : today(),
      todayVisits: num(data.todayVisits),
      todayUniques: num(data.todayUniques),
      totalVisits: num(data.totalVisits),
      totalUniques: num(data.totalUniques),
    };
  } catch {
    return null;
  }
}
