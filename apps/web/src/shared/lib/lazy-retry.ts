import { lazy, type ComponentType } from "react";

import { loadChunkWithReloadRecovery } from "./chunk-load-recovery";

/**
 * React.lazy + 배포 청크 실패 1회 자동복구. chunkId는 sessionStorage 키에 쓰이므로
 * 같은 페이지 안에서 다른 lazy 청크와 겹치지 않는 이름을 준다(보통 컴포넌트 이름).
 *
 * 제약을 ComponentType<any>로 두는 건 React 자체의 lazy() 시그니처와 동일한 선택이다 —
 * unknown으로 좁히면 함수 컴포넌트 Props의 반공변성 때문에 각 호출부의 구체적 Props 타입이
 * 제약을 만족하지 못해 T가 추론되지 않고 never로 무너진다(실사용 시 대량 타입 에러로 드러남).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, chunkId: string) {
  return lazy(() => loadChunkWithReloadRecovery(load, chunkId));
}
