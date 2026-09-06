/**
 * Multi-tab / multi-document ownership of the origin-wide OPFS SQLite SAH pool.
 *
 * Only one page's DedicatedWorker may hold {@link STUDIO_LOCAL_DATABASE_WORKER_LOCK_NAME}.
 * Secondary Studio tabs fail open with SqliteUnavailableError; product surfaces must soft-degrade
 * (session memory) instead of dumping Worker/lock stack text into the global error banner.
 */

import { StudioLocalDatabaseWorkerLockError } from "./studio-local-database-worker-lock";

const OWNERSHIP_BUSY_MARKERS = Object.freeze([
  "already owned by another page",
  "DedicatedWorker ownership lock failed",
  "Studio OPFS SQLite is already owned by another page",
] as const);

function collectErrorText(error: unknown, depth = 0): string {
  if (depth > 8 || error == null) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
  } else {
    const name = Reflect.get(error, "name");
    const message = Reflect.get(error, "message");
    const reason = Reflect.get(error, "reason");
    const code = Reflect.get(error, "code");
    if (typeof name === "string") parts.push(name);
    if (typeof message === "string") parts.push(message);
    if (typeof reason === "string") parts.push(reason);
    if (typeof code === "string") parts.push(code);
  }
  const cause = Reflect.get(error, "cause");
  if (cause !== undefined) parts.push(collectErrorText(cause, depth + 1));
  return parts.join("\n");
}

/**
 * True when Studio local SQLite cannot open because another same-origin page already owns
 * the OPFS SAH Worker lock (or the serialized Worker error still describes that case).
 */
export function isStudioLocalDatabaseOwnershipBusyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    if (current instanceof StudioLocalDatabaseWorkerLockError) {
      if (current.code === "lock-unavailable") return true;
    }
    if (typeof current === "object") {
      const code = Reflect.get(current, "code");
      if (code === "lock-unavailable") return true;
    }
    current =
      typeof current === "object" && current !== null
        ? Reflect.get(current, "cause")
        : undefined;
  }

  const text = collectErrorText(error);
  if (!text) return false;
  return OWNERSHIP_BUSY_MARKERS.some((marker) => text.includes(marker));
}

/** Short Korean copy for session-only soft degrade (no technical Worker text). */
export const STUDIO_LOCAL_DATABASE_OWNERSHIP_BUSY_SESSION_HINT =
  "다른 Studio 탭이 로컬 저장소를 사용 중이라 이 탭 변경은 세션에만 유지돼요." as const;

export const STUDIO_BRUSH_QUICK_SLOTS_OWNERSHIP_BUSY_HINT =
  "다른 Studio 탭이 로컬 저장소를 사용 중이라 이 탭의 브러시 퀵 슬롯은 세션 전용으로 유지해요." as const;

export const STUDIO_WATERMARK_PREFERENCES_OWNERSHIP_BUSY_HINT =
  "다른 Studio 탭이 로컬 저장소를 사용 중이라 이 탭의 워터마크 설정은 세션 전용으로 유지해요." as const;

/**
 * Product-facing soft copy for multi-tab ownership busy. Technical Worker/lock stack text never
 * reaches the banner when the failure is classified as ownership busy.
 */
export function studioLocalDatabaseOwnershipBusyUserMessage(
  cause: unknown,
  ownershipBusyHint: string = STUDIO_LOCAL_DATABASE_OWNERSHIP_BUSY_SESSION_HINT,
): string | null {
  return isStudioLocalDatabaseOwnershipBusyError(cause) ? ownershipBusyHint : null;
}
