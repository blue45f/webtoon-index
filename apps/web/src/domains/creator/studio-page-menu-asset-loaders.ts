import { useEffect, useRef } from "react";

/**
 * One guarded lazy catalog load bound to a menu/panel open. `load` performs the
 * dynamic import and returns an `apply` closure; the hook invokes it only while the
 * page is still mounted, mirroring the previous per-effect mounted guard.
 */
export interface StudioMenuAssetLoaderEntry {
  /** 이 카탈로그를 여는 메뉴가 현재 열려 있는가 (`menu === "..."`). */
  readonly active: boolean;
  /** 이미 로드됨 — 재로드하지 않는다. */
  readonly loaded: boolean;
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string | null) => void;
  /** `console.error` 프리픽스 (실패 원인 로그). */
  readonly logLabel: string;
  /** 사용자에게 보여줄 실패 메시지. */
  readonly errorMessage: string;
  /** 모듈 import — resolve 값은 카탈로그 상태를 반영하는 apply 클로저. */
  readonly load: () => Promise<() => void>;
}

/**
 * Menu-gated lazy asset catalog loader extracted from StudioPage. Replaces the
 * previously repeated per-catalog effects (panel layouts / scene templates / SFX /
 * background scenes / stickers / emeres) with one table-driven hook. Behavior is
 * identical: a load starts only while its menu is open and neither loaded nor
 * in-flight, a failure clears the in-flight slot so reopening retries, and state is
 * only touched while the page is mounted. The success promise stays cached so a
 * loaded catalog never re-imports.
 */
export function useStudioMenuAssetLoader(
  entries: readonly StudioMenuAssetLoaderEntry[],
): void {
  const mountedRef = useRef(true);
  const loadsRef = useRef<(Promise<void> | null)[]>([]);
  // 효과는 signature 변화 시점에만 돌지만, 그 시점의 최신 entries(설정자·load 클로저)를
  // 읽어야 하므로 render 마다 ref 로 동기화한다 — 원래 effect 들의 렌더 클로저와 동일.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // 각 항목의 (열림, 로드됨) 짝이 바뀔 때만 다시 평가한다 — 원래의 [menu, loaded] 의존성과
  // 동일한 트리거의 합집합이며, 아래 가드 덕분에 재실행은 관측 가능한 차이를 만들지 않는다.
  const signature = entries
    .map((entry) => `${entry.active ? 1 : 0}${entry.loaded ? 1 : 0}`)
    .join("");
  useEffect(() => {
    entriesRef.current.forEach((entry, index) => {
      if (!entry.active) return;
      if (entry.loaded || loadsRef.current[index]) return;
      entry.setLoading(true);
      entry.setError(null);
      loadsRef.current[index] = entry
        .load()
        .then((apply) => {
          if (!mountedRef.current) return;
          apply();
        })
        .catch((err) => {
          console.error(entry.logLabel, err);
          loadsRef.current[index] = null;
          if (mountedRef.current) {
            entry.setError(entry.errorMessage);
          }
        })
        .finally(() => {
          if (mountedRef.current) {
            entry.setLoading(false);
          }
        });
    });
  }, [signature]);
}
