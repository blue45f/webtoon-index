// 청크 로드 실패 자동 새로고침 게이트(hasAttemptedChunkReload/markChunkReloadAttempted)의
// 순수 로직 회귀 테스트.
//
// error-boundary.tsx가 이 모듈을 써서 "청크 로드 실패 시 세션당 딱 1번만 자동 새로고침을
// 시도한다"를 구현한다 — 클래스 컴포넌트 자체(componentDidCatch → setState → 재렌더)는 이
// 저장소의 vitest 환경(environment:"node", jsdom/happy-dom 없음)에서 렌더토스태틱마크업만
// 가능해 동적 에러 캐치 흐름을 시뮬레이션할 수 없으므로(StudioStockImagePanel.test.tsx의
// 주석과 동일한 제약), 그 부분은 브라우저 실측으로 검증했다(청크 로드 실패 → 최초 1회 자동
// window.location.reload() → 그래도 실패하면 수동 "새로고침"/"홈으로" 버튼이 있는 안내 화면).
import { afterEach, describe, expect, it } from "vitest";

import { CHUNK_RELOAD_FLAG, hasAttemptedChunkReload, markChunkReloadAttempted } from "./chunk-reload-guard";

function fakeSessionStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

describe("hasAttemptedChunkReload / markChunkReloadAttempted", () => {
  it("플래그가 없으면 아직 자동 재시도를 안 한 것으로 본다", () => {
    Object.defineProperty(globalThis, "sessionStorage", { value: fakeSessionStorage(), configurable: true });
    expect(hasAttemptedChunkReload()).toBe(false);
  });

  it("markChunkReloadAttempted 호출 후에는 정확히 그 세션스토리지 키·값으로 재시도 이력이 남는다", () => {
    const storage = fakeSessionStorage();
    Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });

    markChunkReloadAttempted();

    expect(storage.getItem(CHUNK_RELOAD_FLAG)).toBe("1");
    expect(hasAttemptedChunkReload()).toBe(true);
  });

  it("다른 값이 저장돼 있으면(예: 다른 코드가 실수로 같은 키를 건드림) 재시도 안 한 것으로 취급한다", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: fakeSessionStorage({ [CHUNK_RELOAD_FLAG]: "true" }),
      configurable: true,
    });
    expect(hasAttemptedChunkReload()).toBe(false);
  });

  it("sessionStorage 자체가 없으면 자동 새로고침 루프를 막기 위해 재시도 완료로 폴백한다", () => {
    // globalThis.sessionStorage가 아예 없는 상태(afterEach가 이미 지웠고, 이 테스트도 설정 안 함).
    expect(hasAttemptedChunkReload()).toBe(true);
    expect(() => markChunkReloadAttempted()).not.toThrow();
  });

  it("sessionStorage.getItem이 던지는 환경에서도 자동 새로고침을 fail-closed 한다", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
      },
      configurable: true,
    });
    expect(hasAttemptedChunkReload()).toBe(true);
    expect(() => markChunkReloadAttempted()).not.toThrow();
  });
});
