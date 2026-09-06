/**
 * EditorClient React 계층.
 *
 * UI 진입점(메뉴·툴레일·라디얼 HUD·모바일 독·인스펙터·AI 액션·컴패니언 창)은 여기 셋만
 * 쓰면 된다: 프로바이더로 클라이언트를 내리고, `useEditorSelector` 로 읽고,
 * `useEditorCommand` 로 쓴다.
 */

export {
  StudioEditorClientProvider,
  useStudioEditorClient,
} from "./StudioEditorClientContext";
export type { StudioEditorClientProviderProps } from "./StudioEditorClientContext";

export { useEditorCommand } from "./useEditorCommand";
export type { EditorCommandDispatcher } from "./useEditorCommand";

export { useEditorSelector } from "./useEditorSelector";

export {
  STUDIO_LEFT_TOOL_RAIL_COMMANDS,
  createStudioLeftToolRailClient,
  createStudioLeftToolRailRuntime,
} from "./studio-left-tool-rail-client";
export type {
  StudioLeftToolRailActionArguments,
  StudioLeftToolRailActionName,
  StudioLeftToolRailActions,
  StudioLeftToolRailClient,
  StudioLeftToolRailClientInput,
  StudioLeftToolRailHandlersContract,
  StudioLeftToolRailRuntime,
  StudioLeftToolRailSnapshot,
} from "./studio-left-tool-rail-client";
