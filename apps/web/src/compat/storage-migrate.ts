// 구 브랜드(webdex) → 신 브랜드(toonspectrum) localStorage 키 1회 이관.
// zustand persist 스토어는 모듈 평가 시점(import)에 동기 hydrate 되므로,
// 이 모듈은 어떤 스토어보다 먼저 평가되도록 main.tsx 의 "최상단" import 로 둔다.
// 기존 사용자가 로그아웃되거나 설정(테마·언어·필터·로컬 데이터)을 잃지 않게 한다.

const RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["webdex-theme", "toonspectrum-theme"],
  ["webdex-lang", "toonspectrum-lang"],
  ["webdex-store", "toonspectrum-store"],
  ["webdex-auth-session", "toonspectrum-auth-session"],
  ["webdex-filters-remember", "toonspectrum-filters-remember"],
];

// `webdex-filters:{scope}` 처럼 접두사로 묶인 키들.
const PREFIX_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["webdex-filters:", "toonspectrum-filters:"],
];

function move(from: string, to: string) {
  const v = localStorage.getItem(from);
  if (v === null) return;
  if (localStorage.getItem(to) === null) localStorage.setItem(to, v);
  localStorage.removeItem(from);
}

export function migrateLegacyStorageKeys() {
  try {
    for (const [from, to] of RENAMES) move(from, to);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      for (const [from, to] of PREFIX_RENAMES) {
        if (k.startsWith(from)) move(k, to + k.slice(from.length));
      }
    }
  } catch {
    /* 비공개 모드 등 localStorage 접근 불가 — 무시 */
  }
}

migrateLegacyStorageKeys();
