import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useStudioEditorClient } from "./StudioEditorClientContext";

/**
 * 편집기 스냅샷에서 필요한 조각만 읽는다.
 *
 * `useSyncExternalStore` 의 getSnapshot 은 "값이 안 바뀌면 같은 참조"를 돌려줘야 하므로,
 * 선택 결과를 클로저에 캐시해 `isEqual` 로 비교한다. 그래서 스냅샷이 바뀌어도 내가 보는
 * 조각이 그대로면 리렌더가 나지 않는다.
 *
 * 선택자는 **안정적인 참조**여야 한다(모듈 최상단 `selectBrushUi` 같은 것, 혹은
 * `useCallback`). 매 렌더 새로 만드는 인라인 선택자가 매번 새 객체를 돌려주면 캐시가
 * 초기화되어 리렌더 루프가 생긴다 — zustand/redux 선택자와 같은 제약이다.
 */
export function useEditorSelector<S, T>(
  selector: (snapshot: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const client = useStudioEditorClient<S>();

  const subscribe = useCallback(
    (onStoreChange: () => void) => client.subscribe(onStoreChange),
    [client],
  );

  const getSelection = useMemo(() => {
    // 캐시는 이 클로저에만 사는 셀이다(렌더 중 재할당되는 변수가 아니므로 컴파일러 규칙과
    // 충돌하지 않는다). `client`/`selector`/`isEqual` 가 바뀌면 통째로 새로 만들어진다.
    const cache: { filled: boolean; value: T | undefined } = {
      filled: false,
      value: undefined,
    };
    return (): T => {
      const next = selector(client.getSnapshot());
      if (cache.filled && isEqual(cache.value as T, next)) return cache.value as T;
      cache.filled = true;
      cache.value = next;
      return next;
    };
  }, [client, selector, isEqual]);

  // 서버 스냅샷도 같은 캐시를 쓴다: 이 클라이언트는 SSR 에서도 순수 메모리 스토어다.
  return useSyncExternalStore(subscribe, getSelection, getSelection);
}
