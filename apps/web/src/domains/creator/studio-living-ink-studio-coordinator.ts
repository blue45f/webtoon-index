import {
  createStudioLivingInkStrokeOperation,
  estimateStudioLivingInkStrokeMarkCount,
  STUDIO_LIVING_INK_LIMITS,
  type StudioLivingInkDepositOperation,
  type StudioLivingInkOperation,
  type StudioLivingInkSelectionMask,
  type StudioLivingInkStrokeSample,
  type StudioLivingInkWaterOperation,
} from "./studio-living-ink-field";
import {
  createStudioLivingInkExecutionProvider,
} from "./studio-living-ink-provider";

import type {
  StudioLivingInkExecutionApplied,
  StudioLivingInkExecutionApplyOptions,
  StudioLivingInkExecutionApplyResult,
  StudioLivingInkExecutionConfig,
  StudioLivingInkExecutionFrame,
  StudioLivingInkExecutionProviderId,
  StudioLivingInkExecutionReceipt,
} from "./studio-living-ink-execution-protocol";

export type StudioLivingInkStudioState = "failed" | "loading" | "ready" | "unavailable";
export type StudioLivingInkStrokeMode = "ink" | "water";

export interface StudioLivingInkAuthoritativeSample extends StudioLivingInkStrokeSample {
  readonly tiltX?: number;
  readonly tiltY?: number;
}

export interface StudioLivingInkStrokeRecipeSnapshot {
  readonly mode: StudioLivingInkStrokeMode;
  readonly tool: StudioLivingInkDepositOperation["tool"];
  readonly baseWidth: number;
  readonly fieldScale: number;
  readonly waterLoad: number;
  readonly pigmentLoad: number;
  readonly color: readonly [number, number, number, number];
  readonly pointerSource: "finger" | "mouse" | "pen";
  readonly selection: StudioLivingInkSelectionMask | null;
}

export interface StudioLivingInkFinishedWork {
  readonly frame: StudioLivingInkExecutionFrame;
  readonly journal: readonly StudioLivingInkOperation[];
  readonly routeKey: string;
  readonly strokeId: string;
}

export interface StudioLivingInkActionWork {
  readonly frame: StudioLivingInkExecutionFrame;
  readonly journal: readonly StudioLivingInkOperation[];
  readonly routeKey: string;
}

interface ActiveStroke {
  readonly pageId: string;
  readonly strokeId: string;
  readonly recipe: StudioLivingInkStrokeRecipeSnapshot;
  routeKey: string | null;
  failed: Error | null;
  finishing: boolean;
  /** Last accepted input station. It bridges separately journaled sample chunks without a gap. */
  lastAuthoritativeSample: StudioLivingInkAuthoritativeSample | null;
  pendingSamples: StudioLivingInkAuthoritativeSample[];
  operationCount: number;
}

export interface StudioLivingInkCoordinatorProvider {
  apply(
    operation: StudioLivingInkOperation,
    options?: StudioLivingInkExecutionApplyOptions,
  ): Promise<StudioLivingInkExecutionApplyResult>;
  render(displayMode: "composite"): Promise<StudioLivingInkExecutionFrame>;
  dispose(): Promise<void>;
}

export interface StudioLivingInkStudioCoordinatorOptions {
  readonly onStateChange?: (state: StudioLivingInkStudioState, message?: string) => void;
  readonly onCapacityDiagnostic?: (message: string) => void;
  /** Test seam. Production uses one explicitly selected isolated Worker GPU provider. */
  readonly providerFactory?: (
    config: StudioLivingInkExecutionConfig,
    backend: StudioLivingInkExecutionProviderId,
  ) => Promise<StudioLivingInkCoordinatorProvider>;
}

const CANONICAL_SAMPLES_PER_OPERATION = 8;
const MAX_OPERATIONS_PER_STROKE = 128;
const RELEASE_SETTLE_TICKS = 120;
const MAX_JOURNAL_OPERATIONS = 512;

function isExecutionFrame(
  result: StudioLivingInkExecutionApplyResult,
): result is StudioLivingInkExecutionFrame {
  return "image" in result;
}

function requireSimulationAck(
  result: StudioLivingInkExecutionApplyResult,
): StudioLivingInkExecutionApplied {
  if (isExecutionFrame(result)) {
    result.image.close();
    throw new Error("Living Ink simulation-only operation unexpectedly produced a presentation frame.");
  }
  if (result.kind !== "living-ink/applied" || result.presented !== false) {
    throw new Error("Living Ink simulation-only operation returned an invalid acknowledgement.");
  }
  return result;
}

function cloneOperations(
  operations: readonly StudioLivingInkOperation[],
): StudioLivingInkOperation[] {
  return structuredClone([...operations]);
}

function normalizeJournal(
  operations: readonly StudioLivingInkOperation[],
): StudioLivingInkOperation[] | null {
  if (operations.length > 512) return null;
  const cloned = cloneOperations(operations);
  for (let index = 0; index < cloned.length; index += 1) {
    if (cloned[index]?.sequence !== index + 1) return null;
  }
  return cloned;
}

function waterOperation(
  sequence: number,
  recipe: StudioLivingInkStrokeRecipeSnapshot,
  samples: readonly StudioLivingInkAuthoritativeSample[],
): StudioLivingInkWaterOperation {
  const expectedMarks = estimateStudioLivingInkStrokeMarkCount(recipe, samples);
  if (expectedMarks > STUDIO_LIVING_INK_LIMITS.maxMarksPerOperation) {
    throw new RangeError(
      `Living Ink water operation requires ${expectedMarks} marks; maximum is ${STUDIO_LIVING_INK_LIMITS.maxMarksPerOperation}.`,
    );
  }
  const marks: StudioLivingInkWaterOperation["marks"][number][] = [];
  const radius = Math.max(0.25, recipe.baseWidth * recipe.fieldScale * 0.5);
  const maximumStep = Math.max(0.5, radius * 0.28);
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index]!;
    const previous = samples[Math.max(0, index - 1)]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    const durationSeconds = Math.max(1 / 1_000, (current.timeMs - previous.timeMs) / 1_000);
    const speed = index === 0 ? 0 : distance / durationSeconds;
    const steps = index === 0 ? 0 : Math.max(1, Math.ceil(distance / maximumStep));
    for (let step = index === 0 ? 0 : 1; step <= steps; step += 1) {
      const ratio = steps === 0 ? 0 : step / steps;
      marks.push(Object.freeze({
        x: previous.x + dx * ratio,
        y: previous.y + dy * ratio,
        radius,
        pressure: Math.min(1, Math.max(0, previous.pressure + (current.pressure - previous.pressure) * ratio)),
        speed,
        waterMass: recipe.waterLoad,
      }));
    }
  }
  return Object.freeze({
    kind: "water",
    version: 1,
    sequence,
    tool: "water-brush",
    marks: Object.freeze(marks),
    selection: recipe.selection,
  });
}

function omitRepeatedAnchor<Operation extends StudioLivingInkDepositOperation | StudioLivingInkWaterOperation>(
  operation: Operation,
  anchor: StudioLivingInkAuthoritativeSample,
): Operation {
  const opening = operation.marks[0];
  const firstNewMark = opening
    && Math.abs(opening.x - anchor.x) < 1e-9
    && Math.abs(opening.y - anchor.y) < 1e-9
    ? 1
    : 0;
  return Object.freeze({
    ...operation,
    marks: Object.freeze(operation.marks.slice(firstNewMark)),
  }) as unknown as Operation;
}

/**
 * Product coordinator above the Worker provider. Input operations are queued in order and never
 * replaced. Only ImageBitmap presentation may be coalesced by the overlay host.
 */
export class StudioLivingInkStudioCoordinator {
  readonly #options: StudioLivingInkStudioCoordinatorOptions;
  #provider: StudioLivingInkCoordinatorProvider | null = null;
  /** Provider owned while persisted operations replay, before physical authority is accepted. */
  #activatingProvider: StudioLivingInkCoordinatorProvider | null = null;
  #config: StudioLivingInkExecutionConfig | null = null;
  #backend: StudioLivingInkExecutionProviderId | null = null;
  #pageId: string | null = null;
  #state: StudioLivingInkStudioState = "unavailable";
  #epoch = 0;
  #queue: Promise<void> = Promise.resolve();
  #committedJournal: StudioLivingInkOperation[] = [];
  #committedReceipt: StudioLivingInkExecutionReceipt | null = null;
  #workingJournal: StudioLivingInkOperation[] = [];
  #active: ActiveStroke | null = null;
  #pendingActionRouteKey: string | null = null;
  #capacityDiagnostic: string | null = null;

  constructor(options: StudioLivingInkStudioCoordinatorOptions = {}) {
    this.#options = options;
  }

  get state(): StudioLivingInkStudioState {
    return this.#state;
  }

  get pageId(): string | null {
    return this.#pageId;
  }

  get hasActiveStroke(): boolean {
    return this.#active !== null;
  }

  get capacityDiagnostic(): string | null {
    return this.#capacityDiagnostic;
  }

  #setState(state: StudioLivingInkStudioState, message?: string): void {
    this.#state = state;
    this.#options.onStateChange?.(state, message);
  }

  async activate(input: Readonly<{
    pageId: string;
    backend: StudioLivingInkExecutionProviderId;
    config: StudioLivingInkExecutionConfig;
    journal?: readonly StudioLivingInkOperation[];
    expectedFinalReceipt?: StudioLivingInkExecutionReceipt | null;
  }>): Promise<boolean> {
    const epoch = ++this.#epoch;
    const previous = this.#provider;
    const previousActivating = this.#activatingProvider;
    const previousQueue = this.#queue;
    if (this.#active) {
      this.#active.failed ??= new DOMException(
        "Living Ink page/runtime changed while a stroke was active.",
        "AbortError",
      );
    }
    this.#provider = null;
    this.#activatingProvider = null;
    this.#active = null;
    this.#pendingActionRouteKey = null;
    this.#pageId = input.pageId;
    this.#config = structuredClone(input.config);
    this.#backend = input.backend;
    this.#capacityDiagnostic = null;
    this.#setState("loading");
    // Revoke the old Worker first. The provider rejects every pending request before terminating
    // its Worker, so waiting for an arbitrary in-flight simulation before dispose can strand a
    // page switch indefinitely. The detached queue keeps its own rejection handler and closes any
    // late fake/test frame through the stale-owner guard in #enqueueOperation.
    void previousQueue.catch(() => undefined);
    await Promise.all(
      [...new Set([previous, previousActivating].filter(
        (provider): provider is StudioLivingInkCoordinatorProvider => provider !== null,
      ))].map((provider) => provider.dispose().catch(() => undefined)),
    );
    if (epoch !== this.#epoch) return false;
    this.#queue = Promise.resolve();
    const normalized = normalizeJournal(input.journal ?? []);
    if (!normalized) {
      if (epoch === this.#epoch) this.#setState("failed", "물리 operation journal이 손상되었습니다.");
      return false;
    }
    let candidate: StudioLivingInkCoordinatorProvider | null = null;
    try {
      const receiptBackend = input.expectedFinalReceipt?.backend === "webgl2-offscreen-half-float"
        ? "webgl2"
        : input.expectedFinalReceipt?.backend === "webgpu-offscreen-half-float"
          ? "webgpu"
          : null;
      if (receiptBackend && receiptBackend !== input.backend) {
        throw new Error(
          "Living Ink persisted receipt backend differs from the explicitly selected provider.",
        );
      }
      const provider = await (
        this.#options.providerFactory?.(input.config, input.backend)
        ?? createStudioLivingInkExecutionProvider(input.config, { backend: input.backend })
      );
      candidate = provider;
      if (epoch !== this.#epoch) {
        await provider.dispose();
        return false;
      }
      this.#activatingProvider = provider;
      for (let index = 0; index < normalized.length; index += 1) {
        const operation = normalized[index]!;
        const applied = await provider.apply(operation, {
          // `advance` is the persisted pointer-release settle operation. The live path executes it
          // with the settle pressure budget in #enqueueOperation; replay must use that exact same
          // budget or the journal hash matches while the canonical RGBA8 receipt does not.
          quality: operation.kind === "fix" || operation.kind === "advance"
            ? "settle"
            : "interactive",
          simulationTicks: operation.kind === "advance" ? operation.fixedTicks : undefined,
          present: false,
        });
        if (epoch !== this.#epoch || this.#activatingProvider !== provider) return false;
        const ack = requireSimulationAck(applied);
        if (ack.operationKind !== operation.kind || ack.revision !== index + 1) {
          throw new Error("Living Ink replay acknowledgement did not match the journal sequence.");
        }
      }
      if (input.expectedFinalReceipt) {
        const replayFrame = await provider.render("composite");
        if (epoch !== this.#epoch || this.#activatingProvider !== provider) {
          replayFrame.image.close();
          return false;
        }
        const accepted = replayFrame.receipt.engineVersion === input.expectedFinalReceipt.engineVersion
          && replayFrame.receipt.displaySha256 === input.expectedFinalReceipt.displaySha256
          && replayFrame.receipt.operationSha256 === input.expectedFinalReceipt.operationSha256
          && replayFrame.receipt.fixedPigmentPolicy === input.expectedFinalReceipt.fixedPigmentPolicy;
        replayFrame.image.close();
        if (!accepted) {
          throw new Error(
            "Living Ink 재열기 결과가 저장된 최종 GPU 영수증과 달라 물리 편집을 비활성화했습니다.",
          );
        }
      }
      if (epoch !== this.#epoch || this.#activatingProvider !== provider) return false;
      this.#activatingProvider = null;
      this.#provider = provider;
      candidate = null;
      this.#committedJournal = normalized;
      this.#committedReceipt = input.expectedFinalReceipt
        ? structuredClone(input.expectedFinalReceipt)
        : null;
      this.#workingJournal = cloneOperations(normalized);
      this.#setState("ready");
      return true;
    } catch (cause) {
      if (candidate && this.#activatingProvider === candidate) {
        this.#activatingProvider = null;
        await candidate.dispose().catch(() => undefined);
      }
      if (epoch === this.#epoch) {
        this.#provider = null;
        this.#committedJournal = [];
        this.#committedReceipt = null;
        this.#workingJournal = [];
        this.#setState("failed", cause instanceof Error ? cause.message : "Living Ink Worker를 시작하지 못했습니다.");
      }
      return false;
    }
  }

  admitStroke(input: Readonly<{
    pageId: string;
    strokeId: string;
    recipe: StudioLivingInkStrokeRecipeSnapshot;
  }>): boolean {
    if (
      this.#state !== "ready"
      || !this.#provider
      || this.#pageId !== input.pageId
      || this.#active
      || this.#pendingActionRouteKey
    ) return false;
    this.#workingJournal = cloneOperations(this.#committedJournal);
    const remainingCapacity = MAX_JOURNAL_OPERATIONS - this.#workingJournal.length;
    if (remainingCapacity < MAX_OPERATIONS_PER_STROKE + 1) {
      this.#capacityDiagnostic = [
        "Living Ink 물리 기록 용량이 부족해 새 획을 안전하게 시작하지 않았습니다.",
        "현재 PNG는 보존되며, 물리 스냅샷 재열기 기능이 준비될 때까지 새 물리 레이어를 사용해 주세요.",
      ].join(" ");
      this.#options.onCapacityDiagnostic?.(this.#capacityDiagnostic);
      return false;
    }
    this.#capacityDiagnostic = null;
    this.#active = {
      pageId: input.pageId,
      strokeId: input.strokeId,
      recipe: structuredClone(input.recipe),
      routeKey: null,
      failed: null,
      finishing: false,
      lastAuthoritativeSample: null,
      pendingSamples: [],
      operationCount: 0,
    };
    return true;
  }

  pinActiveRoute(strokeId: string, routeKey: string): boolean {
    const active = this.#active;
    if (!active || active.strokeId !== strokeId || active.routeKey || !routeKey) return false;
    active.routeKey = routeKey;
    return true;
  }

  append(
    strokeId: string,
    routeKey: string,
    samples: readonly StudioLivingInkAuthoritativeSample[],
  ): boolean {
    const active = this.#active;
    if (
      !active
      || active.strokeId !== strokeId
      || active.routeKey !== routeKey
      || active.failed
      || active.finishing
      || samples.length === 0
    ) return false;
    const requiredOperations = Math.floor(
      (active.pendingSamples.length + samples.length) / CANONICAL_SAMPLES_PER_OPERATION,
    );
    if (active.operationCount + requiredOperations > MAX_OPERATIONS_PER_STROKE) {
      active.failed = new Error(
        "Living Ink 한 획의 안전 기록 한도를 넘었습니다. 현재 획은 벡터 원본으로 보존됩니다.",
      );
      this.#capacityDiagnostic = active.failed.message;
      this.#options.onCapacityDiagnostic?.(active.failed.message);
      return false;
    }
    active.pendingSamples.push(...structuredClone(samples));
    return this.#flushCanonicalSampleChunks(active, false);
  }

  #flushCanonicalSampleChunks(active: ActiveStroke, includeRemainder: boolean): boolean {
    while (
      active.pendingSamples.length >= CANONICAL_SAMPLES_PER_OPERATION
      || (includeRemainder && active.pendingSamples.length > 0)
    ) {
      const count = Math.min(CANONICAL_SAMPLES_PER_OPERATION, active.pendingSamples.length);
      const chunk = active.pendingSamples.splice(0, count);
      const anchoredSamples = active.lastAuthoritativeSample
        ? [active.lastAuthoritativeSample, ...chunk]
        : chunk;
      const sequence = this.#workingJournal.length + 1;
      let rawOperation: StudioLivingInkDepositOperation | StudioLivingInkWaterOperation;
      try {
        rawOperation = active.recipe.mode === "water"
          ? waterOperation(sequence, active.recipe, anchoredSamples)
          : createStudioLivingInkStrokeOperation(sequence, {
              fieldScale: active.recipe.fieldScale,
              baseWidth: active.recipe.baseWidth,
              waterLoad: active.recipe.waterLoad,
              pigmentLoad: active.recipe.pigmentLoad,
              color: active.recipe.color,
              tool: active.recipe.tool,
            }, anchoredSamples, active.recipe.selection);
      } catch (cause) {
        active.failed = new Error(
          [
            "Living Ink 입력 간격이 한 번의 물리 연산 mark 한도를 넘었습니다.",
            "잘린 물리 획을 저장하지 않고 전체 벡터 원본으로 복구합니다.",
            cause instanceof Error ? cause.message : "mark 예산을 계산하지 못했습니다.",
          ].join(" "),
        );
        this.#capacityDiagnostic = active.failed.message;
        this.#options.onCapacityDiagnostic?.(active.failed.message);
        return false;
      }
      // The anchor exists only to generate interpolation from the previous chunk tail. Removing its
      // first station prevents double deposition while retaining every segment across canonical
      // 8-sample groups and separate pointer-event boundaries.
      const operation: StudioLivingInkOperation = active.lastAuthoritativeSample
        ? omitRepeatedAnchor(rawOperation, active.lastAuthoritativeSample)
        : rawOperation;
      this.#workingJournal.push(operation);
      active.lastAuthoritativeSample = structuredClone(chunk[chunk.length - 1]!);
      active.operationCount += 1;
      this.#enqueueOperation(active, operation, "interactive");
    }
    return true;
  }

  #enqueueOperation(
    owner: ActiveStroke,
    operation: StudioLivingInkOperation,
    quality: "interactive" | "settle",
  ): void {
    this.#queue = this.#queue.then(async () => {
      try {
        if (owner.failed) return;
        const provider = this.#provider;
        if (!provider || this.#active !== owner || !owner.routeKey) {
          throw new Error("Living Ink pointer route가 operation 완료 전에 변경되었습니다.");
        }
        const applied = await provider.apply(operation, {
          quality,
          simulationTicks: operation.kind === "advance" ? operation.fixedTicks : undefined,
          present: false,
        });
        const ack = requireSimulationAck(applied);
        if (ack.operationKind !== operation.kind || ack.revision !== operation.sequence) {
          throw new Error("Living Ink interactive acknowledgement did not match its operation.");
        }
        if (this.#active !== owner || owner.failed || !owner.routeKey) {
          return;
        }
        // Pointer-contact presentation is owned by the retained vector shadow. The GPU field is
        // still updated in-order here, but it never crosses GPU→CPU while the pen is down. A single
        // canonical readback occurs after the deterministic release settle in finishStroke().
      } catch (cause) {
        owner.failed = cause instanceof Error ? cause : new Error("Living Ink operation이 실패했습니다.");
      }
    });
  }

  async finishStroke(strokeId: string, routeKey: string): Promise<StudioLivingInkFinishedWork> {
    const active = this.#active;
    if (
      !active
      || active.strokeId !== strokeId
      || active.routeKey !== routeKey
      || active.finishing
    ) throw new Error("Living Ink 최종화 route가 현재 획과 일치하지 않습니다.");
    if (active.failed) throw active.failed;
    if (active.operationCount + (active.pendingSamples.length > 0 ? 1 : 0) > MAX_OPERATIONS_PER_STROKE) {
      throw new Error("Living Ink 한 획의 안전 기록 한도를 넘어 최종화할 수 없습니다.");
    }
    if (!this.#flushCanonicalSampleChunks(active, true)) {
      throw active.failed ?? new Error("Living Ink mark 한도를 넘어 최종화할 수 없습니다.");
    }
    active.finishing = true;
    const advance: StudioLivingInkOperation = Object.freeze({
      kind: "advance",
      version: 1,
      sequence: this.#workingJournal.length + 1,
      // This is a bounded release settle, not a background 60 Hz simulation clock. It makes the
      // pointer-up canonical frame deterministic while keeping the journal replayable.
      fixedTicks: RELEASE_SETTLE_TICKS,
    });
    this.#workingJournal.push(advance);
    this.#enqueueOperation(active, advance, "settle");
    await this.#queue;
    if (active.failed) throw active.failed;
    const provider = this.#provider;
    if (!provider || this.#active !== active) {
      throw new Error("Living Ink Worker가 최종 프레임 전에 교체되었습니다.");
    }
    const frame = await provider.render("composite");
    return Object.freeze({
      frame,
      journal: Object.freeze(cloneOperations(this.#workingJournal)),
      routeKey,
      strokeId,
    });
  }

  acceptFinishedStroke(work: StudioLivingInkFinishedWork): boolean {
    const active = this.#active;
    if (!active || active.strokeId !== work.strokeId || active.routeKey !== work.routeKey) return false;
    this.#committedJournal = cloneOperations(work.journal);
    this.#committedReceipt = structuredClone(work.frame.receipt);
    this.#workingJournal = cloneOperations(work.journal);
    this.#active = null;
    return true;
  }

  async cancelStroke(strokeId?: string | null): Promise<void> {
    const active = this.#active;
    if (!active || (strokeId && active.strokeId !== strokeId)) return;
    active.failed ??= new DOMException("Living Ink stroke cancelled.", "AbortError");
    this.#active = null;
    // #rebuildCommitted -> activate revokes the provider first. Waiting for the old queue here
    // defeats that guarantee when a GPU/Worker request is hung.
    void this.#queue.catch(() => undefined);
    await this.#rebuildCommitted();
  }

  async rollbackFinishedStroke(work: StudioLivingInkFinishedWork): Promise<void> {
    if (this.#active?.strokeId === work.strokeId) this.#active = null;
    work.frame.image.close();
    await this.#rebuildCommitted();
  }

  async applyAction(input: Readonly<{
    routeKey: string;
    kind: "clear" | "fix";
    scope: "all" | "selection";
    selection: StudioLivingInkSelectionMask | null;
  }>): Promise<StudioLivingInkActionWork> {
    if (
      this.#state !== "ready"
      || !this.#provider
      || this.#active
      || this.#pendingActionRouteKey
      || (input.scope === "selection" && !input.selection)
      || this.#workingJournal.length >= MAX_JOURNAL_OPERATIONS
    ) throw new Error("Living Ink 물리 상태가 준비되지 않았거나 선택 범위가 없습니다.");
    const provider = this.#provider;
    this.#pendingActionRouteKey = input.routeKey;
    this.#workingJournal = cloneOperations(this.#committedJournal);
    const operation: StudioLivingInkOperation = Object.freeze({
      kind: input.kind,
      version: 1,
      sequence: this.#workingJournal.length + 1,
      scope: input.scope,
      selection: input.selection ? structuredClone(input.selection) : null,
    });
    this.#workingJournal.push(operation);
    try {
      const applied = await provider.apply(operation, {
        quality: input.kind === "fix" ? "settle" : "interactive",
        present: false,
      });
      // Persist the same canonical render receipt used by stroke finalization. An apply receipt
      // hashes the operation request, while reload validation renders the replayed composite; using
      // that apply receipt as expectedFinalReceipt makes a correct Clear journal fail every reopen.
      const ack = requireSimulationAck(applied);
      if (ack.operationKind !== operation.kind || ack.revision !== operation.sequence) {
        throw new Error("Living Ink action acknowledgement did not match its operation.");
      }
      if (this.#provider !== provider || this.#pendingActionRouteKey !== input.routeKey) {
        throw new DOMException("Living Ink action route changed before canonical render.", "AbortError");
      }
      const frame = await provider.render("composite");
      if (this.#provider !== provider || this.#pendingActionRouteKey !== input.routeKey) {
        frame.image.close();
        throw new DOMException("Living Ink action route changed before canonical receipt.", "AbortError");
      }
      return Object.freeze({
        frame,
        journal: Object.freeze(cloneOperations(this.#workingJournal)),
        routeKey: input.routeKey,
      });
    } catch (cause) {
      if (this.#provider === provider && this.#pendingActionRouteKey === input.routeKey) {
        this.#pendingActionRouteKey = null;
        await this.#rebuildCommitted();
      }
      throw cause;
    }
  }

  acceptAction(work: StudioLivingInkActionWork): boolean {
    if (this.#pendingActionRouteKey !== work.routeKey) return false;
    this.#committedJournal = cloneOperations(work.journal);
    this.#committedReceipt = structuredClone(work.frame.receipt);
    this.#workingJournal = cloneOperations(work.journal);
    this.#pendingActionRouteKey = null;
    return true;
  }

  async rollbackAction(work: StudioLivingInkActionWork): Promise<void> {
    work.frame.image.close();
    if (this.#pendingActionRouteKey === work.routeKey) this.#pendingActionRouteKey = null;
    await this.#rebuildCommitted();
  }

  async #rebuildCommitted(): Promise<void> {
    const config = this.#config;
    const backend = this.#backend;
    const pageId = this.#pageId;
    if (!config || !backend || !pageId) {
      this.#setState("unavailable");
      return;
    }
    await this.activate({
      pageId,
      backend,
      config,
      journal: this.#committedJournal,
      expectedFinalReceipt: this.#committedReceipt,
    });
  }

  /**
   * Keeps the flattened PNG visible while revoking all physical edit authority. Product callers
   * use this after a document commit whose Worker acceptance receipt cannot be proven.
   */
  async failClosed(message: string): Promise<void> {
    this.#epoch += 1;
    if (this.#active) this.#active.failed ??= new Error(message);
    this.#active = null;
    this.#pendingActionRouteKey = null;
    const provider = this.#provider;
    const activatingProvider = this.#activatingProvider;
    const queue = this.#queue;
    this.#provider = null;
    this.#activatingProvider = null;
    // Detach stale work before disposal completes. A rapid physical-mode re-enable must not be
    // overwritten by a late continuation from the provider being revoked here.
    this.#queue = Promise.resolve();
    this.#setState("failed", message);
    void queue.catch(() => undefined);
    await Promise.all(
      [...new Set([provider, activatingProvider].filter(
        (candidate): candidate is StudioLivingInkCoordinatorProvider => candidate !== null,
      ))].map((candidate) => candidate.dispose().catch(() => undefined)),
    );
  }

  async dispose(): Promise<void> {
    this.#epoch += 1;
    if (this.#active) {
      this.#active.failed ??= new DOMException("Living Ink coordinator disposed.", "AbortError");
    }
    this.#active = null;
    this.#pendingActionRouteKey = null;
    const provider = this.#provider;
    const activatingProvider = this.#activatingProvider;
    const queue = this.#queue;
    this.#provider = null;
    this.#activatingProvider = null;
    this.#pageId = null;
    this.#config = null;
    this.#backend = null;
    this.#committedJournal = [];
    this.#committedReceipt = null;
    this.#workingJournal = [];
    this.#capacityDiagnostic = null;
    // Detach stale work synchronously. A rapid off/on cycle may start a new activation while the
    // previous provider is still terminating; no late disposal continuation may reset that new
    // activation's queue.
    this.#queue = Promise.resolve();
    this.#setState("unavailable");
    void queue.catch(() => undefined);
    await Promise.all(
      [...new Set([provider, activatingProvider].filter(
        (candidate): candidate is StudioLivingInkCoordinatorProvider => candidate !== null,
      ))].map((candidate) => candidate.dispose().catch(() => undefined)),
    );
  }
}
