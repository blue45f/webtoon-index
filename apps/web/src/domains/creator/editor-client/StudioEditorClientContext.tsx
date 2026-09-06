import { createContext, useContext } from "react";

import type { EditorClient } from "@toonspectrum/studio-command-registry";
import type { ReactNode } from "react";

/**
 * 스튜디오 UI 가 편집기와 이야기하는 유일한 통로.
 *
 * 2026-09-02 아키텍처 리뷰: 메뉴·툴레일·라디얼 HUD·모바일 독·AI 액션·컴패니언 창은
 * `Dispatch<SetStateAction<…>>` 뭉치가 아니라 `EditorClient` 하나만 받는다. 읽기는
 * `useEditorSelector`, 쓰기는 `useEditorCommand` 로 좁혀지므로 표면이 늘어나도 계약은
 * 그대로 하나다.
 *
 * 컨텍스트는 스냅샷 타입을 `unknown` 으로 지운다(React 컨텍스트는 제네릭이 될 수 없다).
 * `EditorClient<S>` 는 S 에 대해 공변이라 어떤 클라이언트든 `EditorClient<unknown>` 으로
 * 안전하게 담기고, 구체 타입은 `useStudioEditorClient<S>()` 한 곳에서만 되살린다.
 */
const StudioEditorClientContext = createContext<EditorClient<unknown> | null>(null);

export interface StudioEditorClientProviderProps<S> {
  client: EditorClient<S>;
  children: ReactNode;
}

export function StudioEditorClientProvider<S>({
  client,
  children,
}: StudioEditorClientProviderProps<S>) {
  return (
    <StudioEditorClientContext.Provider value={client}>
      {children}
    </StudioEditorClientContext.Provider>
  );
}

/**
 * 프로바이더 밖에서 부르면 던진다 — "조용히 undefined 를 받고 클릭이 먹지 않는" 실패보다
 * 배선 누락을 즉시 드러내는 편이 낫다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- 컨텍스트 접근자는 프로바이더와 같은 모듈에 둔다(훅만 분리하면 import 경로가 둘로 갈라진다).
export function useStudioEditorClient<S = unknown>(): EditorClient<S> {
  const client = useContext(StudioEditorClientContext);
  if (!client) {
    throw new Error(
      "useStudioEditorClient must be used inside <StudioEditorClientProvider>. "
        + "스튜디오 UI 진입점은 EditorClient 를 프로바이더로 받아야 합니다.",
    );
  }
  return client as EditorClient<S>;
}
