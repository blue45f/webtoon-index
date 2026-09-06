/**
 * §15.3 Help ▸ Recovery Guide — "지금 내 작업은 어디까지 안전한가".
 *
 * 감사(§2.10)는 복구 자산이 있는데도 사용자가 그 상태를 볼 수 있는 곳이 한 군데도
 * 없다고 판정했다. 배너는 임시저장이 **있을 때만** 뜨고, 체크포인트는 패널을 열어야
 * 보이고, 안전 모드는 켜졌을 때만 나타난다. 그래서 "아무 배너도 없다"가 "안전하다"인지
 * "아무것도 저장되지 않았다"인지 구분되지 않았다.
 *
 * 이 모듈은 브라우저에 **실제로 남아 있는 것**을 세어 그 물음에 답한다. 지어낸
 * 안내 문구가 아니라 실측 레코드다. 순수 모듈이라 저장소를 주입받고, DOM 도 React 도
 * 만지지 않는다.
 */

import { parseStudioAutosave, studioAutosaveHasContent } from "./studio-autosave";

import type { StudioReliabilityStatusSnapshot } from "./studio-reliability-status-store";

/** `studio-autosave.ts` / `studio-checkpoints.ts` 가 쓰는 키 접두사(실측치). */
export const STUDIO_AUTOSAVE_KEY_PREFIX = "toonspectrum-studio-autosave:v12";
export const STUDIO_CHECKPOINT_KEY_PREFIX = "toonspectrum-studio-checkpoints:v12";

export interface StudioRecoveryStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

export interface StudioRecoveryAutosaveRecord {
  readonly key: string;
  /** 키에서 읽은 소유자·문서 구분자. 값은 브라우저에 이미 있는 것 그대로다. */
  readonly documentLabel: string;
  readonly savedAt: string | null;
  readonly pageCount: number;
  readonly hasContent: boolean;
}

export interface StudioRecoveryScan {
  readonly autosaves: readonly StudioRecoveryAutosaveRecord[];
  /** 체크포인트 목록을 읽어 볼 후보 키(로컬 색인 + 임시저장 키에서 유도). */
  readonly checkpointKeys: readonly string[];
  /** 저장소를 아예 읽지 못했으면 true — 0건과 구분한다. */
  readonly storageUnavailable: boolean;
}

function documentLabel(key: string, prefix: string): string {
  const tail = key.startsWith(`${prefix}:`) ? key.slice(prefix.length + 1) : key;
  const [owner = "", ...rest] = tail.split(":");
  const document = rest.join(":");
  const ownerLabel = owner === "guest" ? "게스트" : decodeURIComponent(owner);
  if (document === "new" || document.length === 0) return `${ownerLabel} · 새 문서`;
  return `${ownerLabel} · ${decodeURIComponent(document)}`;
}

function autosaveKeyToCheckpointKey(key: string): string {
  return `${STUDIO_CHECKPOINT_KEY_PREFIX}:${key.slice(STUDIO_AUTOSAVE_KEY_PREFIX.length + 1)}`;
}

/**
 * 브라우저 저장소에 남아 있는 복구 레코드를 센다. 값을 열어 보긴 하지만 원고
 * 내용은 절대 밖으로 내보내지 않는다 — 페이지 수와 저장 시각만 남긴다.
 */
export function scanStudioRecoveryStorage(
  storage: StudioRecoveryStorageLike | null,
): StudioRecoveryScan {
  if (!storage) {
    return { autosaves: [], checkpointKeys: [], storageUnavailable: true };
  }
  const autosaves: StudioRecoveryAutosaveRecord[] = [];
  const checkpointKeys = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      if (key.startsWith(`${STUDIO_CHECKPOINT_KEY_PREFIX}:`)) {
        checkpointKeys.add(key);
        continue;
      }
      if (!key.startsWith(`${STUDIO_AUTOSAVE_KEY_PREFIX}:`)) continue;
      const payload = parseStudioAutosave(storage.getItem(key));
      if (!payload) continue;
      autosaves.push({
        key,
        documentLabel: documentLabel(key, STUDIO_AUTOSAVE_KEY_PREFIX),
        savedAt: typeof payload.savedAt === "string" ? payload.savedAt : null,
        pageCount: payload.pagesList.length,
        hasContent: studioAutosaveHasContent(payload),
      });
      checkpointKeys.add(autosaveKeyToCheckpointKey(key));
    }
  } catch {
    // 사생활 보호 모드에서 localStorage 열거가 던지는 브라우저가 있다.
    return { autosaves, checkpointKeys: [...checkpointKeys], storageUnavailable: true };
  }
  autosaves.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  return { autosaves, checkpointKeys: [...checkpointKeys], storageUnavailable: false };
}

/* ---------------------------------------------------------------- actions */

export interface StudioRecoveryAction {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** 이 조치가 지금 상황에 특히 필요한가 — UI 가 강조에 쓴다. */
  readonly urgent: boolean;
}

export interface StudioRecoveryGuideInput {
  readonly scan: StudioRecoveryScan;
  readonly reliability: StudioReliabilityStatusSnapshot;
  readonly checkpointCount: number | null;
}

/**
 * 지금 화면 상태에서 사용자가 **실제로 할 수 있는** 조치만 낸다. 없는 기능(복구
 * 센터·버전 비교)은 만들어 내지 않는다.
 */
export function studioRecoveryActions(
  input: StudioRecoveryGuideInput,
): readonly StudioRecoveryAction[] {
  const actions: StudioRecoveryAction[] = [];
  const saveDegraded = input.reliability.save !== null;
  const storagePressure =
    input.reliability.storage !== null && input.reliability.storage.level !== "ok";

  if (input.scan.autosaves.some((record) => record.hasContent)) {
    actions.push({
      id: "restore-autosave",
      title: "임시저장 복구하기",
      body: "캔버스 위 상태 표시줄의 ‘복구하기’를 누르면 마지막 임시저장을 되살립니다. 되살리기 전에 ‘JSON 백업’으로 현재 상태를 먼저 받아 두면 되돌릴 수 있습니다.",
      urgent: saveDegraded,
    });
  }
  if ((input.checkpointCount ?? 0) > 0) {
    actions.push({
      id: "open-checkpoints",
      title: "체크포인트에서 되돌리기",
      body: "파일 ▸ 프로젝트 도구의 체크포인트 목록에서 이름 붙인 지점으로 돌아갈 수 있습니다. 최대 10개까지 보관합니다.",
      urgent: false,
    });
  }
  actions.push({
    id: "export-now",
    title: "지금 파일로 내보내기",
    body: "파일 ▸ 백업(.json) 또는 아카이브 백업은 브라우저 저장소와 무관하게 남는 유일한 사본입니다. 저장 경고가 떠 있다면 이것부터 하세요.",
    urgent: saveDegraded || storagePressure,
  });
  if (storagePressure) {
    actions.push({
      id: "reclaim-storage",
      title: "저장 공간 회수",
      body: "복구 저널에서 더 이상 필요 없는 기록을 지워 공간을 되찾습니다. 회수한 용량은 상태 표시줄에 그대로 보고됩니다.",
      urgent: true,
    });
  }
  if (input.reliability.safeMode.active) {
    actions.push({
      id: "exit-safe-mode",
      title: "안전 모드 해제",
      body: "원인이 사라졌다고 판단되면 상태 표시줄의 ‘안전 모드 해제’로 품질 제한을 풀 수 있습니다. 같은 실패가 다시 나면 자동으로 되돌아갑니다.",
      urgent: false,
    });
  }
  return actions;
}
