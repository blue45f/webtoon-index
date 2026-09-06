import {
  isRecord,
  parseActiveScreenShare,
  safeIdentifier,
  safeString,
  type ServerActiveScreenShare,
} from "./studio-live-socket-wire";

export function eventMessage(error: unknown, fallback: string): string {
  let rawMsg = "";
  if (error instanceof Error && error.message.trim()) rawMsg = error.message;
  else if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
    rawMsg = error.message;
  }
  if (rawMsg.includes("503") || rawMsg.toLowerCase().includes("service unavailable")) {
    return "실시간 서버를 준비 중이거나 점검 상태입니다. 캔버스 편집은 지속되며 잠시 후 자동 연결됩니다.";
  }
  if (rawMsg.toLowerCase().includes("xhr poll error") || rawMsg.toLowerCase().includes("websocket error")) {
    return "팀 네트워크 연결이 원활하지 않습니다. 작업 내용은 지속적으로 보존되며 자동 재연결을 시도합니다.";
  }
  return rawMsg ? rawMsg.slice(0, 500) : fallback;
}

export function connectErrorCode(error: unknown): string | null {
  if (!isRecord(error) || !isRecord(error.data) || !safeString(error.data.code, 80)) return null;
  return error.data.code;
}

export function isTerminalConnectErrorCode(code: string | null): boolean {
  return code === "unauthenticated" || code === "forbidden" || code === "access_revoked";
}

export function isNonRecoverable(code: string): boolean {
  return code === "unauthenticated" || code === "forbidden";
}

export function parseScreenAnnouncement(value: unknown): ServerActiveScreenShare | null {
  if (!isRecord(value)) return null;
  return parseActiveScreenShare({
    connectionId: value.fromConnectionId,
    shareId: value.shareId,
    label: value.label,
  });
}

export function parseScreenStop(
  value: unknown
): { connectionId: string; shareId: string } | null {
  if (
    !isRecord(value) ||
    !safeIdentifier(value.fromConnectionId, 128) ||
    !safeIdentifier(value.shareId, 160)
  ) {
    return null;
  }
  return { connectionId: value.fromConnectionId, shareId: value.shareId };
}
