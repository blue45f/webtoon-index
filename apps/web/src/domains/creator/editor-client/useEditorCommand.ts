import { useCallback } from "react";

import { useStudioEditorClient } from "./StudioEditorClientContext";

import type {
  CommandId,
  CommandReceipt,
  DispatchOptions,
  EditorCommandSource,
} from "@toonspectrum/studio-command-registry";

export type EditorCommandDispatcher = (
  payload?: unknown,
  options?: DispatchOptions,
) => Promise<CommandReceipt>;

/**
 * 명령 하나에 묶인 안정적인 발사기를 돌려준다.
 *
 * `source` 는 리시트에 그대로 실려, 같은 명령이 레일에서 왔는지 단축키에서 왔는지를
 * 텔레메트리·원격 진단에서 구분하게 한다. 반환 함수는 `client`/`id`/`source` 가 바뀌지 않는 한
 * 참조가 유지되므로 `memo` 자식의 prop 으로 그대로 내려도 안전하다.
 */
export function useEditorCommand(
  id: CommandId,
  source: EditorCommandSource,
): EditorCommandDispatcher {
  const client = useStudioEditorClient();
  return useCallback(
    (payload?: unknown, options?: DispatchOptions) =>
      client.dispatch({ id, payload, source }, options),
    [client, id, source],
  );
}
