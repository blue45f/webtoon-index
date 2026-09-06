import {
  CommandBus,
  fnv1a64Hex,
  recoverProject,
  sceneDigest,
} from "@toonspectrum/studio-project-model";

import { createSqliteJournalStore } from "./studio-sqlite-journal-store";

import type { StudioLocalDatabase } from "./studio-local-database";
import type { SqliteJournalStore } from "./studio-sqlite-journal-store";
import type {
  ColorIR,
  RecoveryReport,
  SceneIR,
  SceneNodeIR,
} from "@toonspectrum/studio-project-model";

/**
 * V11 스트랭글러 — 레거시 오토세이브의 **관찰 전용 섀도 미러 레인**.
 *
 * 레거시 오토세이브(localStorage/OPFS 계열)는 한 글자도 건드리지 않는다.
 * 호출자가 레거시 저장이 일어나는 지점 옆에서 같은 문서 스냅샷을
 * {@link ShadowAutosaveMirror.enqueueSnapshot} 로 주입하면, 이 레인이 문서를
 * SceneIR 축약 상태로 정규화한 뒤 V11 CommandBus + SQLite 저널에 결정적
 * 명령 시퀀스로 미러한다. 컷오버 슬라이스는 {@link readShadowAutosave} 로
 * 미러 상태를 판독해 레거시 저장본과 대조할 수 있다.
 *
 * 명령 매핑(전체 교체 스냅샷 방식):
 * - 스냅샷 1건 = `scene/init`(빈 nodes 셸) + 노드별 `scene/add-node` 배치.
 *   reducer 가 실측 지원하는 명령만 사용하며, 같은 스냅샷 시퀀스(+같은 주입
 *   클럭)는 항상 같은 저널 바이트를 낳는다.
 * - 축약 규칙: 문서 전체의 안정 직렬화 digest 를 담는 `doc:digest` 텍스트
 *   노드 1개(문서가 조금이라도 달라지면 scene digest 가 반드시 달라지는
 *   완전성 보증) + pagesList → group 노드, elements → 텍스트 노드(위치는
 *   x/y, 내용은 요소별 digest). 원본 페이로드는 저널에 싣지 않는다 —
 *   관찰 레인은 "무엇이 언제 어떻게 변했나"를 추적하는 것이 목적이다.
 *
 * 큐/백프레셔:
 * - enqueue 는 동기·무예외. 트레일링 디바운스(주입 스케줄러) 뒤 미러 패스가
 *   시작되고, 패스 진행 중 도착한 스냅샷은 **최신 1건만** 유지된다. 교체로
 *   드롭된 중간 상태는 `droppedSnapshots` 카운터로 표면화된다(조용한 손실
 *   금지).
 *
 * 실패 격리:
 * - SQLite 개방·정규화·dispatch 실패는 절대 밖으로 던지지 않는다. 상태
 *   객체의 `lastError` + 카운터(`failedMirrors`/`maintenanceFailures`)로만
 *   표면화되고, 다음 패스에서 자연 재시도한다(레거시 경로 무전파).
 * - close() 는 잔여 스냅샷을 드레인하고 클린 셧다운 스냅샷 앵커를 남겨
 *   재개방 recovery digest 가 마지막 미러 상태와 일치하도록 한다.
 */

const DEFAULT_SHADOW_DEBOUNCE_MS = 1_500;
const DEFAULT_SHADOW_SCENE_WIDTH = 1_080;
const DEFAULT_SHADOW_SCENE_HEIGHT = 1_920;

const SHADOW_INK: ColorIR = { r: 0, g: 0, b: 0, a: 1 };
const SHADOW_PAPER: ColorIR = { r: 1, g: 1, b: 1, a: 1 };

// ---------------------------------------------------------------------------
// 안정 직렬화 + 문서 digest
// ---------------------------------------------------------------------------

/**
 * 임의 문서 상태의 결정적 직렬화. canonicalJson 과 달리 어떤 입력에도 던지지
 * 않는다: 비유한 수·undefined·함수·심벌·순환 참조를 **비따옴표 센티널
 * 토큰**으로 표기해 실제 문자열 값과 충돌하지 않는 해시 입력을 만든다.
 * 키는 재귀 정렬되므로 객체 키 순서는 digest 에 영향을 주지 않는다.
 */
function stableSerialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (Number.isFinite(value)) return JSON.stringify(value);
      if (Number.isNaN(value)) return "#nan";
      return value > 0 ? "#inf" : "#-inf";
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return "#undef";
    case "bigint":
      return `#bigint:${String(value)}`;
    case "function":
      return "#function";
    case "symbol":
      return "#symbol";
    default:
      break;
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) return "#circular";
  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      const items = (objectValue as readonly unknown[]).map((item) =>
        stableSerialize(item, seen),
      );
      return `[${items.join(",")}]`;
    }
    const record = objectValue as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${stableSerialize(entry, seen)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(objectValue);
  }
}

/** 임의 상태 값의 안정 직렬화 FNV-1a 64비트 digest(16-hex). 무예외. */
export function shadowStateDigest(value: unknown): string {
  return fnv1a64Hex(stableSerialize(value, new Set()));
}

// ---------------------------------------------------------------------------
// 문서 → SceneIR 축약 정규화
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveIntOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function labelOf(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "anon";
}

function digestTextNode(id: string, x: number, y: number, text: string): SceneNodeIR {
  return {
    id,
    kind: "text",
    x,
    y,
    text,
    fontSizePx: 1,
    color: { ...SHADOW_INK },
    fontFamily: "sans-serif",
    opacity: 1,
    blend: "src-over",
  };
}

function toElementNode(element: unknown, index: number): SceneNodeIR {
  const record = asRecord(element);
  return digestTextNode(
    `el:${index}:${labelOf(record?.id)}`,
    finiteOr(record?.x, 0),
    finiteOr(record?.y, 0),
    shadowStateDigest(element),
  );
}

function toPageGroupNode(page: unknown, pageIndex: number): SceneNodeIR {
  const record = asRecord(page);
  const elements = asArray(record?.elements) ?? [];
  const children: SceneNodeIR[] = [];
  let elementIndex = 0;
  for (const element of elements) {
    children.push(toElementNode(element, elementIndex));
    elementIndex += 1;
  }
  return {
    id: `page:${pageIndex}:${labelOf(record?.id)}`,
    kind: "group",
    opacity: 1,
    blend: "src-over",
    clip: null,
    children,
  };
}

/**
 * 임의 문서 상태를 SceneIR 축약 상태로 정규화한다(순수·결정적·무예외).
 *
 * - `doc:digest` 텍스트 노드: 문서 전체의 {@link shadowStateDigest}.
 *   구조 인식 실패(미지의 문서 모양)라도 이 노드가 변경 감지를 보증한다.
 * - `pagesList` 배열 → 페이지별 group 노드(자식 = 요소 digest 텍스트 노드).
 * - `pagesList` 없이 `elements` 배열만 있으면 최상위 요소 노드로 축약.
 * - 캔버스 치수는 문서의 양의 정수 `width`/`height` 를 채택하고, 없으면
 *   기본 치수를 쓴다(축약 상태의 형식 요건일 뿐 관찰 의미는 없다).
 */
export function normalizeShadowDocument(document: unknown): SceneIR {
  const record = asRecord(document);
  const nodes: SceneNodeIR[] = [
    digestTextNode("doc:digest", 0, 0, shadowStateDigest(document)),
  ];
  const pages = asArray(record?.pagesList);
  if (pages !== null) {
    let pageIndex = 0;
    for (const page of pages) {
      nodes.push(toPageGroupNode(page, pageIndex));
      pageIndex += 1;
    }
  } else {
    const elements = asArray(record?.elements) ?? [];
    let elementIndex = 0;
    for (const element of elements) {
      nodes.push(toElementNode(element, elementIndex));
      elementIndex += 1;
    }
  }
  return {
    version: 11,
    width: positiveIntOr(record?.width, DEFAULT_SHADOW_SCENE_WIDTH),
    height: positiveIntOr(record?.height, DEFAULT_SHADOW_SCENE_HEIGHT),
    background: { ...SHADOW_PAPER },
    nodes,
  };
}

/**
 * 문서가 미러되었을 때 기대되는 scene digest. 컷오버 슬라이스가
 * {@link readShadowAutosave} 결과와 대조해 미러 신선도를 판정하는 계약 API.
 */
export function shadowDocumentDigest(document: unknown): string {
  return sceneDigest(normalizeShadowDocument(document));
}

// ---------------------------------------------------------------------------
// 섀도 미러
// ---------------------------------------------------------------------------

/** 디바운스 타이머 시임 — 테스트는 수동 스케줄러를 주입한다. */
export interface ShadowMirrorScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const defaultScheduler: ShadowMirrorScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface ShadowAutosaveMirrorOptions {
  database: StudioLocalDatabase;
  /** 미러 저널의 프로젝트 스코프(레거시 프로젝트 키와 1:1 대응 권장). */
  projectId: string;
  /** 트레일링 디바운스(기본 1500ms — 레거시 오토세이브 주기와 동일). */
  debounceMs?: number;
  /** CommandBus 자동 스냅샷 주기(기본은 CommandBus 기본값). */
  snapshotEvery?: number;
  /** 저널 타임스탬프 클럭(기본 Date.now). 결정성 테스트는 고정 클럭 주입. */
  now?: () => number;
  scheduler?: ShadowMirrorScheduler;
  /**
   * 성공 패스마다 스냅샷 앵커를 쓰고 앵커 미만 엔트리를 compaction 한다
   * (기본 true). 전체 교체 미러는 과거 엔트리 없이도 복구 가능하므로 장기
   * 소크에서 저널이 무한 성장하지 않는다. 저널 바이트 스트림 자체를 검사하는
   * 테스트만 끈다.
   */
  compactAfterMirror?: boolean;
}

export interface ShadowAutosaveMirrorStatus {
  projectId: string;
  closed: boolean;
  /** 미러 패스가 지금 진행 중인가. */
  mirroring: boolean;
  /** 아직 미러되지 않은 최신 스냅샷이 대기 중인가. */
  pendingSnapshot: boolean;
  enqueuedSnapshots: number;
  mirroredSnapshots: number;
  /** 백프레셔로 교체·드롭된 중간 스냅샷 수(조용한 손실 금지 계약). */
  droppedSnapshots: number;
  /** close() 이후 거절된 enqueue 수. */
  rejectedAfterClose: number;
  /** 정규화·개방·dispatch 실패로 통째로 실패한 미러 패스 수. */
  failedMirrors: number;
  /** 스냅샷 앵커/compaction 등 유지보수 단계의 실패 수(미러 자체는 성공). */
  maintenanceFailures: number;
  /** 가장 최근 실패(성공 패스가 지운다). 레거시 경로로는 절대 전파되지 않는다. */
  lastError: unknown;
  lastMirroredSeq: number | null;
  lastMirroredDigest: string | null;
}

export class ShadowAutosaveMirror {
  private readonly database: StudioLocalDatabase;
  private readonly projectId: string;
  private readonly debounceMs: number;
  private readonly snapshotEvery: number | undefined;
  private readonly now: (() => number) | undefined;
  private readonly scheduler: ShadowMirrorScheduler;
  private readonly compactAfterMirror: boolean;
  private readonly store: SqliteJournalStore;

  private bus: CommandBus | null = null;
  private pending: { document: unknown } | null = null;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private closed = false;
  private closing: Promise<void> | null = null;

  private enqueuedSnapshots = 0;
  private mirroredSnapshots = 0;
  private droppedSnapshots = 0;
  private rejectedAfterClose = 0;
  private failedMirrors = 0;
  private maintenanceFailures = 0;
  private lastError: unknown = null;
  private lastMirroredSeq: number | null = null;
  private lastMirroredDigest: string | null = null;

  constructor(options: ShadowAutosaveMirrorOptions) {
    this.database = options.database;
    this.projectId = options.projectId;
    this.debounceMs = options.debounceMs ?? DEFAULT_SHADOW_DEBOUNCE_MS;
    this.snapshotEvery = options.snapshotEvery;
    this.now = options.now;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.compactAfterMirror = options.compactAfterMirror ?? true;
    // projectId 검증은 여기서 즉시 터진다(프로그래밍 오류는 조기 실패).
    this.store = createSqliteJournalStore(this.database, this.projectId);
  }

  /**
   * 문서 스냅샷 접수. 동기·무예외 — 레거시 저장 경로 옆에서 fire-and-forget
   * 으로 불러도 안전하다. 반환값은 접수 여부(close 이후는 false).
   */
  enqueueSnapshot(document: unknown): boolean {
    if (this.closed) {
      this.rejectedAfterClose += 1;
      return false;
    }
    this.enqueuedSnapshots += 1;
    if (this.pending !== null) this.droppedSnapshots += 1;
    this.pending = { document };
    // 패스 진행 중이면 완료 핸들러가 최신 1건을 즉시 집어간다(타이머 불필요).
    if (this.running === null) this.armDebounce();
    return true;
  }

  /** 대기·진행 중인 미러를 전부 드레인한다(디바운스 무시, 즉시 실행). */
  async flush(): Promise<void> {
    while (this.running !== null || this.pending !== null) {
      this.cancelTimer();
      this.startPass();
      if (this.running !== null) await this.running;
    }
  }

  /**
   * 잔여 스냅샷을 드레인하고 클린 셧다운 스냅샷 앵커를 남긴 뒤 닫는다.
   * 이후 enqueue 는 거절된다. 데이터베이스는 이 레인의 소유가 아니므로
   * 닫지 않는다. 멱등.
   */
  close(): Promise<void> {
    if (this.closing === null) {
      this.closed = true;
      this.closing = this.performClose();
    }
    return this.closing;
  }

  getStatus(): ShadowAutosaveMirrorStatus {
    return {
      projectId: this.projectId,
      closed: this.closed,
      mirroring: this.running !== null,
      pendingSnapshot: this.pending !== null,
      enqueuedSnapshots: this.enqueuedSnapshots,
      mirroredSnapshots: this.mirroredSnapshots,
      droppedSnapshots: this.droppedSnapshots,
      rejectedAfterClose: this.rejectedAfterClose,
      failedMirrors: this.failedMirrors,
      maintenanceFailures: this.maintenanceFailures,
      lastError: this.lastError,
      lastMirroredSeq: this.lastMirroredSeq,
      lastMirroredDigest: this.lastMirroredDigest,
    };
  }

  private async performClose(): Promise<void> {
    await this.flush();
    if (this.bus !== null) {
      try {
        await this.bus.writeSnapshot();
      } catch (error) {
        this.lastError = error;
        this.maintenanceFailures += 1;
      }
    }
  }

  private armDebounce(): void {
    this.cancelTimer();
    this.timer = this.scheduler.schedule(() => {
      this.timer = null;
      this.startPass();
    }, this.debounceMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.scheduler.cancel(this.timer);
    this.timer = null;
  }

  private startPass(): void {
    if (this.running !== null || this.pending === null) return;
    this.cancelTimer();
    this.running = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending !== null) {
        const next = this.pending;
        this.pending = null;
        await this.mirrorOnce(next.document);
      }
    } finally {
      this.running = null;
    }
  }

  /** 스냅샷 1건 미러. 어떤 실패도 밖으로 던지지 않는다(레거시 격리 계약). */
  private async mirrorOnce(document: unknown): Promise<void> {
    try {
      const bus = await this.ensureBus();
      const scene = normalizeShadowDocument(document);
      // 전체 교체: 빈 셸로 init 한 뒤 축약 노드를 순서대로 add 한다.
      await bus.dispatch({ type: "scene/init", scene: { ...scene, nodes: [] } });
      for (const node of scene.nodes) {
        await bus.dispatch({ type: "scene/add-node", node });
      }
      this.lastMirroredSeq = bus.getSeq();
      this.lastMirroredDigest = sceneDigest(bus.getScene());
      this.mirroredSnapshots += 1;
      this.lastError = null;
      if (this.compactAfterMirror) {
        try {
          await bus.writeSnapshot();
          await this.store.compactBefore(bus.getSeq());
        } catch (error) {
          this.lastError = error;
          this.maintenanceFailures += 1;
        }
      }
    } catch (error) {
      this.lastError = error;
      this.failedMirrors += 1;
    }
  }

  /** CommandBus 지연 개방(첫 미러 시점). 실패 시 다음 패스에서 재시도한다. */
  private async ensureBus(): Promise<CommandBus> {
    if (this.bus !== null) return this.bus;
    const { bus } = await CommandBus.open(this.store, {
      ...(this.snapshotEvery === undefined ? {} : { snapshotEvery: this.snapshotEvery }),
      ...(this.now === undefined ? {} : { now: this.now }),
    });
    this.bus = bus;
    return bus;
  }
}

/** 관찰 전용 섀도 미러를 만든다. 빈 projectId 는 즉시 던진다. */
export function createShadowAutosaveMirror(
  options: ShadowAutosaveMirrorOptions,
): ShadowAutosaveMirror {
  return new ShadowAutosaveMirror(options);
}

// ---------------------------------------------------------------------------
// 복구 판독 (컷오버 소비 API)
// ---------------------------------------------------------------------------

export interface ShadowAutosaveRecoveredState {
  projectId: string;
  /** 복구된 마지막 저널 seq(미러 이력이 없으면 0). */
  seq: number;
  /** 최신 미러 상태의 scene digest(미러 이력이 없으면 null). */
  digest: string | null;
  scene: SceneIR | null;
  recovery: RecoveryReport;
}

/**
 * 프로젝트의 섀도 미러 상태를 재개방+recovery 로 판독한다. 컷오버 슬라이스가
 * `digest` 를 {@link shadowDocumentDigest}(현재 레거시 문서)와 대조해 미러
 * 신선도·정합을 판정한다. 미러 레인과 달리 SQLite 오류를 그대로 전파한다 —
 * 읽기 소비자가 폴백 정책을 소유한다.
 */
export async function readShadowAutosave(
  database: StudioLocalDatabase,
  projectId: string,
): Promise<ShadowAutosaveRecoveredState> {
  const recovered = await recoverProject(createSqliteJournalStore(database, projectId));
  return {
    projectId,
    seq: recovered.seq,
    digest: recovered.scene === null ? null : sceneDigest(recovered.scene),
    scene: recovered.scene,
    recovery: recovered.report,
  };
}
