import {
  deleteUnreferencedStudioWorkAssetUpload,
  uploadStudioWorkAsset,
} from "./studio-work-asset-client";

import {
  parseStudioWorkAssetDescriptor,
  parseStudioWorkAssetSourceUri,
  isStudioWorkAssetImageAdmissionOptedIn,
  STUDIO_WORK_ASSET_BOOLEAN_EDIT_KEYS,
  STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE,
  STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS,
  StudioWorkAssetSmartFiltersSchema,
  studioWorkAssetSourceUri,
  type StudioWorkAssetDescriptor,
  type StudioWorkAssetManifest,
} from "@/shared/lib/studio-work-asset-contract";

export interface StudioWorkAssetAdmissionImageLike {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  name?: string;
  [key: string]: unknown;
}

export interface StudioWorkAssetAdmissionPageLike<
  TElement extends { id: string; type: string },
> {
  id: string;
  elements: readonly TElement[];
}

export interface StudioWorkAssetAdmissionReceipt {
  assetId: string;
  source: string;
  canonicalSource: string;
  manifest: StudioWorkAssetManifest;
}

export interface StudioWorkAssetAdmissionDependencies {
  readLocalImage?: (source: string, signal: AbortSignal) => Promise<Blob>;
  upload?: typeof uploadStudioWorkAsset;
  cleanup?: typeof deleteUnreferencedStudioWorkAssetUpload;
  maximumConcurrent?: number;
  /** Tests/controlled previews may pass the same exact token as the Vite environment flag. */
  imageAdmissionOptIn?: unknown;
}

export interface StudioWorkAssetAdmissionSyncInput<
  TElement extends { id: string; type: string },
  TPage extends StudioWorkAssetAdmissionPageLike<TElement>,
> {
  workId: string | null;
  authUserId: string | null;
  editable: boolean;
  pages: readonly TPage[];
  /** Return false only when the exact local source is stale and the upload should be compensated. */
  onAdmitted: (receipt: StudioWorkAssetAdmissionReceipt) => boolean | void | Promise<boolean | void>;
  onError: (message: string, candidate: { assetId: string; source: string }) => void;
}

interface AdmissionCandidate {
  assetId: string;
  source: string;
  descriptor: StudioWorkAssetDescriptor;
}

interface AdmissionFailure {
  assetId: string;
  source: string;
  message: string;
}

interface InFlightAdmission {
  key: string;
  controller: AbortController;
}

interface PendingAdmission {
  scopeKey: string;
  workId: string;
  candidate: AdmissionCandidate;
  onAdmitted: StudioWorkAssetAdmissionSyncInput<never, never>["onAdmitted"];
  onError: StudioWorkAssetAdmissionSyncInput<never, never>["onError"];
}

const DEFAULT_MAXIMUM_CONCURRENT_ADMISSIONS = 4;

type LocalImageFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const LOCAL_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function browserImageAdmissionOptIn(): unknown {
  return import.meta.env.VITE_STUDIO_WORK_ASSET_IMAGE_ADMISSION;
}

function aborted(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

export function isStudioWorkAssetLocalImageSource(source: string): boolean {
  return source.startsWith("blob:") || /^data:image\//iu.test(source);
}

function responseContentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (raw === null) return null;
  if (!/^(0|[1-9]\d*)$/u.test(raw.trim())) {
    throw new Error("로컬 이미지의 Content-Length가 올바르지 않습니다.");
  }
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) throw new Error("로컬 이미지가 너무 큽니다.");
  return length;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel("studio_work_asset_local_body_rejected");
  } catch {
    // The original validation/abort error remains authoritative.
  }
}

/**
 * Reads only browser-owned data:/blob: image sources, and enforces the server's image byte budget
 * while streaming. Arbitrary http(s), file, extension and cross-origin URLs never reach fetch.
 */
export async function readBoundedStudioWorkAssetLocalImage(
  source: string,
  signal: AbortSignal,
  fetcher: LocalImageFetch = globalThis.fetch.bind(globalThis)
): Promise<Blob> {
  if (!isStudioWorkAssetLocalImageSource(source)) {
    throw new Error("data: 또는 blob: 로컬 이미지만 공동 작업 에셋으로 올릴 수 있습니다.");
  }
  const maximumBytes = STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE.image;
  // Avoid asking fetch to eagerly decode a pathological in-memory data URL. Base64 is roughly
  // 4/3 of the decoded size; the small allowance covers the media-type header and padding. A
  // percent-encoded body may be rejected conservatively rather than allocating beyond the budget.
  if (source.startsWith("data:") && source.length > Math.ceil(maximumBytes * 4 / 3) + 2_048) {
    throw new Error("공동 작업 이미지는 8MB 이하만 사용할 수 있습니다.");
  }
  const response = await fetcher(source, { signal });
  if (!response.ok) throw new Error("로컬 이미지 원본을 읽지 못했습니다.");
  const declaredLength = responseContentLength(response);
  if (declaredLength !== null && (declaredLength < 1 || declaredLength > maximumBytes)) {
    throw new Error("공동 작업 이미지는 8MB 이하만 사용할 수 있습니다.");
  }
  const responseMime = response.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const mimeType = responseMime && LOCAL_IMAGE_MIME_TYPES.has(responseMime)
    ? responseMime
    : "application/octet-stream";

  if (!response.body) {
    // Without a stream, allocation is safe only when the platform declared a bounded length first.
    if (declaredLength === null) {
      throw new Error("이 환경에서는 크기를 확인할 수 있는 로컬 이미지만 올릴 수 있습니다.");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== declaredLength || bytes.byteLength > maximumBytes) {
      throw new Error("로컬 이미지 크기가 선언값과 다릅니다.");
    }
    return new Blob([bytes], { type: mimeType });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let byteLength = 0;
  try {
    while (true) {
      if (signal.aborted) {
        await cancelReader(reader);
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("작품 에셋 업로드가 취소되었습니다.", "AbortError");
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        await cancelReader(reader);
        throw new Error("로컬 이미지 스트림 형식이 올바르지 않습니다.");
      }
      if (chunk.value.byteLength > maximumBytes - byteLength) {
        await cancelReader(reader);
        throw new Error("공동 작업 이미지는 8MB 이하만 사용할 수 있습니다.");
      }
      // Copy the exact view so a fetch implementation cannot retain/mutate a larger backing store.
      chunks.push(new Uint8Array(chunk.value));
      byteLength += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength < 1 || (declaredLength !== null && declaredLength !== byteLength)) {
    throw new Error("로컬 이미지 크기가 올바르지 않습니다.");
  }
  return new Blob(chunks, { type: mimeType });
}

export function createStudioWorkAssetInitialImageDescriptor(
  element: StudioWorkAssetAdmissionImageLike
): StudioWorkAssetDescriptor {
  const descriptorElement: Record<string, unknown> = {
    id: element.id,
    type: "image",
  };
  for (const key of STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS) {
    if (key === "smartFilters") continue;
    const value = element[key];
    if (value !== undefined) descriptorElement[key] = value;
  }
  if (typeof element.name === "string") descriptorElement.name = element.name;
  // Placement, scalar, boolean, blur and curve fields all pass the strict base schema and fail
  // closed. Smart-filter stacks remain optional metadata: only an explicit bounded clone enters
  // the descriptor; an invalid, legacy or descriptor-budget-breaking program is safely omitted.
  const baseDescriptor = parseStudioWorkAssetDescriptor({
    version: 1,
    element: descriptorElement,
  }, {
    assetId: element.id,
    elementType: "image",
  });
  const smartFilters = StudioWorkAssetSmartFiltersSchema.safeParse(element.smartFilters);
  if (!smartFilters.success) return baseDescriptor;

  try {
    return parseStudioWorkAssetDescriptor({
      version: 1,
      element: {
        ...baseDescriptor.element,
        smartFilters: smartFilters.data,
      },
    }, {
      assetId: element.id,
      elementType: "image",
    });
  } catch {
    return baseDescriptor;
  }
}

function candidateKey(scopeKey: string, candidate: Pick<AdmissionCandidate, "assetId" | "source">): string {
  return JSON.stringify([scopeKey, candidate.assetId, candidate.source]);
}

function collectCandidates<
  TElement extends { id: string; type: string },
  TPage extends StudioWorkAssetAdmissionPageLike<TElement>,
>(pages: readonly TPage[]): {
  candidates: Map<string, AdmissionCandidate>;
  failures: AdmissionFailure[];
} {
  const candidates = new Map<string, AdmissionCandidate>();
  const failures = new Map<string, AdmissionFailure>();
  const blockedIds = new Set<string>();
  for (const page of pages) {
    for (const sourceElement of page.elements) {
      if (sourceElement.type !== "image") continue;
      const element = sourceElement as TElement & StudioWorkAssetAdmissionImageLike;
      if (typeof element.src !== "string" || !isStudioWorkAssetLocalImageSource(element.src)) continue;
      if (blockedIds.has(element.id)) continue;
      let descriptor: StudioWorkAssetDescriptor;
      try {
        descriptor = createStudioWorkAssetInitialImageDescriptor(element);
      } catch {
        blockedIds.add(element.id);
        candidates.delete(element.id);
        failures.set(element.id, {
          assetId: element.id,
          source: element.src,
          message: "이미지 배치 또는 필터 값이 안전 범위를 벗어나 업로드하지 않았습니다.",
        });
        continue;
      }
      const candidate: AdmissionCandidate = {
        assetId: element.id,
        source: element.src,
        descriptor,
      };
      // Once A/B has established an ambiguous identity, a later A must not silently put that ID
      // back into the upload set. The whole scan remains fail-closed for that ID.
      const previous = candidates.get(candidate.assetId);
      if (previous && previous.source !== candidate.source) {
        blockedIds.add(candidate.assetId);
        failures.set(candidate.assetId, {
          assetId: candidate.assetId,
          source: candidate.source,
          message: "같은 이미지 ID가 서로 다른 로컬 원본을 가리켜 업로드하지 않았습니다.",
        });
        candidates.delete(candidate.assetId);
        continue;
      }
      if (!previous) candidates.set(candidate.assetId, candidate);
    }
  }
  return { candidates, failures: [...failures.values()] };
}

/**
 * Lifecycle owner for local-image admission. One image ID has at most one request; edits and scope
 * rotation abort the old generation, while failures leave the local canvas body untouched and are
 * suppressed until that source or authorization scope changes.
 */
export class StudioWorkAssetAdmissionCoordinator {
  private scopeKey: string | null = null;
  private disposed = false;
  private readonly inFlight = new Map<string, InFlightAdmission>();
  private readonly pending = new Map<string, PendingAdmission>();
  private readonly failed = new Set<string>();
  private readonly readLocalImage: NonNullable<StudioWorkAssetAdmissionDependencies["readLocalImage"]>;
  private readonly upload: NonNullable<StudioWorkAssetAdmissionDependencies["upload"]>;
  private readonly cleanup: NonNullable<StudioWorkAssetAdmissionDependencies["cleanup"]>;
  private readonly maximumConcurrent: number;
  private readonly imageAdmissionEnabled: boolean;

  constructor(dependencies: StudioWorkAssetAdmissionDependencies = {}) {
    this.readLocalImage = dependencies.readLocalImage ?? ((source, signal) =>
      readBoundedStudioWorkAssetLocalImage(source, signal));
    this.upload = dependencies.upload ?? uploadStudioWorkAsset;
    this.cleanup = dependencies.cleanup ?? deleteUnreferencedStudioWorkAssetUpload;
    this.imageAdmissionEnabled = isStudioWorkAssetImageAdmissionOptedIn(
      dependencies.imageAdmissionOptIn ?? browserImageAdmissionOptIn()
    );
    this.maximumConcurrent = Number.isSafeInteger(dependencies.maximumConcurrent) &&
      (dependencies.maximumConcurrent ?? 0) > 0
      ? dependencies.maximumConcurrent!
      : DEFAULT_MAXIMUM_CONCURRENT_ADMISSIONS;
  }

  sync<
    TElement extends { id: string; type: string },
    TPage extends StudioWorkAssetAdmissionPageLike<TElement>,
  >(input: StudioWorkAssetAdmissionSyncInput<TElement, TPage>): void {
    if (this.disposed) return;
    if (!this.imageAdmissionEnabled) {
      this.scopeKey = null;
      this.failed.clear();
      this.abortAll();
      return;
    }
    const nextScopeKey = input.editable && input.workId && input.authUserId
      ? JSON.stringify([input.authUserId, input.workId])
      : null;
    if (nextScopeKey !== this.scopeKey) {
      this.abortAll();
      this.failed.clear();
      this.scopeKey = nextScopeKey;
    }
    if (!nextScopeKey || !input.workId) return;

    const collected = collectCandidates(input.pages);
    const liveKeys = new Map<string, AdmissionCandidate>();
    const activeKeys = new Set<string>();
    for (const candidate of collected.candidates.values()) {
      liveKeys.set(candidate.assetId, candidate);
    }
    for (const failure of collected.failures) {
      const key = candidateKey(nextScopeKey, failure);
      activeKeys.add(key);
      if (this.failed.has(key)) continue;
      this.failed.add(key);
      input.onError(failure.message, failure);
    }

    for (const [assetId, request] of this.inFlight) {
      const candidate = liveKeys.get(assetId);
      if (candidate && request.key === candidateKey(nextScopeKey, candidate)) continue;
      request.controller.abort();
      // Keep the superseded request in the slot until its server result settles. This serializes
      // same-ID source replacements so a late compensation can never remove the newer payload.
    }

    for (const [assetId, pending] of this.pending) {
      const candidate = liveKeys.get(assetId);
      if (candidate && pending.scopeKey === nextScopeKey && pending.workId === input.workId &&
        candidateKey(nextScopeKey, candidate) === candidateKey(pending.scopeKey, pending.candidate)) {
        continue;
      }
      this.pending.delete(assetId);
    }

    for (const candidate of liveKeys.values()) {
      const key = candidateKey(nextScopeKey, candidate);
      activeKeys.add(key);
      if (this.failed.has(key) || this.pending.has(candidate.assetId)) continue;
      const current = this.inFlight.get(candidate.assetId);
      if (current?.key === key) continue;
      this.pending.set(candidate.assetId, {
        scopeKey: nextScopeKey,
        workId: input.workId,
        candidate,
        onAdmitted: input.onAdmitted,
        onError: input.onError,
      });
    }
    for (const key of this.failed) {
      if (!activeKeys.has(key)) this.failed.delete(key);
    }
    this.drain();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scopeKey = null;
    this.failed.clear();
    this.abortAll();
  }

  private start(
    scopeKey: string,
    workId: string,
    candidate: AdmissionCandidate,
    onAdmitted: StudioWorkAssetAdmissionSyncInput<never, never>["onAdmitted"],
    onError: StudioWorkAssetAdmissionSyncInput<never, never>["onError"]
  ): void {
    const key = candidateKey(scopeKey, candidate);
    const controller = new AbortController();
    this.inFlight.set(candidate.assetId, { key, controller });
    void this.readLocalImage(candidate.source, controller.signal)
      .then((blob) => this.upload(
        workId,
        { assetId: candidate.assetId, elementType: "image" },
        candidate.descriptor,
        blob,
        controller.signal
      ))
      .then(async (manifest) => {
        const canonicalSource = studioWorkAssetSourceUri({
          assetId: manifest.assetId,
          elementType: manifest.elementType,
        });
        const parsed = parseStudioWorkAssetSourceUri(canonicalSource);
        if (
          !parsed || parsed.assetId !== candidate.assetId || parsed.elementType !== "image" ||
          manifest.descriptor.element.id !== candidate.assetId ||
          manifest.descriptor.element.type !== "image"
        ) {
          throw new Error("서버가 승인한 이미지 식별자가 로컬 요소와 다릅니다.");
        }
        if (!this.isCurrent(candidate.assetId, key, controller, scopeKey)) {
          await this.cleanupReceipt(workId, manifest);
          return;
        }
        let accepted: boolean | void;
        try {
          accepted = await onAdmitted({
            assetId: candidate.assetId,
            source: candidate.source,
            canonicalSource,
            manifest,
          });
        } catch (error) {
          // If publication partially reached the server, its atomic durable-reference proof will
          // retain the body. If publication never committed, this closes the same quota leak as a
          // stale source before surfacing the original editor failure.
          await this.cleanupReceipt(workId, manifest);
          throw error;
        }
        if (accepted === false) await this.cleanupReceipt(workId, manifest);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || aborted(error)) return;
        if (!this.isCurrent(candidate.assetId, key, controller, scopeKey)) return;
        this.failed.add(key);
        onError(
          error instanceof Error ? error.message : "공동 작업 이미지를 업로드하지 못했습니다.",
          candidate
        );
      })
      .finally(() => {
        const current = this.inFlight.get(candidate.assetId);
        if (current?.controller === controller) this.inFlight.delete(candidate.assetId);
        this.drain();
      });
  }

  private async cleanupReceipt(
    workId: string,
    manifest: StudioWorkAssetManifest
  ): Promise<void> {
    try {
      await this.cleanup(
        workId,
        { assetId: manifest.assetId, elementType: manifest.elementType },
        manifest.sha256
      );
    } catch {
      // Compensation is deliberately best-effort. A permission change, durable reference, or
      // transient network failure must not replace the editor's authoritative upload outcome.
    }
  }

  private drain(): void {
    if (this.disposed || !this.scopeKey) return;
    while (this.inFlight.size < this.maximumConcurrent) {
      let next: [string, PendingAdmission] | undefined;
      for (const entry of this.pending) {
        if (!this.inFlight.has(entry[0])) {
          next = entry;
          break;
        }
      }
      if (!next) return;
      const [assetId, admission] = next;
      this.pending.delete(assetId);
      if (admission.scopeKey !== this.scopeKey) continue;
      const key = candidateKey(admission.scopeKey, admission.candidate);
      if (this.failed.has(key)) continue;
      this.start(
        admission.scopeKey,
        admission.workId,
        admission.candidate,
        admission.onAdmitted,
        admission.onError
      );
    }
  }

  private isCurrent(
    assetId: string,
    key: string,
    controller: AbortController,
    scopeKey: string
  ): boolean {
    const current = this.inFlight.get(assetId);
    return !this.disposed && !controller.signal.aborted && this.scopeKey === scopeKey &&
      current?.key === key && current.controller === controller;
  }

  private abortAll(): void {
    for (const request of this.inFlight.values()) request.controller.abort();
    this.inFlight.clear();
    this.pending.clear();
  }
}

export interface StudioWorkAssetHistoryAdmissionResult<TPage> {
  history: TPage[][];
  changed: boolean;
  previousCurrentPages: readonly TPage[];
  nextCurrentPages: readonly TPage[];
}

/** Rewrites only the exact admitted local source; failed/pending or subsequently edited images stay. */
export function replaceStudioWorkAssetSourceAcrossHistory<
  TElement extends { id: string; type: string; src?: string },
  TPage extends { elements: TElement[] },
>(input: {
  history: readonly (readonly TPage[])[];
  currentIndex: number;
  assetId: string;
  expectedSource: string;
  canonicalSource: string;
}): StudioWorkAssetHistoryAdmissionResult<TPage> {
  const canonical = parseStudioWorkAssetSourceUri(input.canonicalSource);
  if (!canonical || canonical.assetId !== input.assetId || canonical.elementType !== "image") {
    throw new Error("승인된 이미지 참조 URI가 요소 식별자와 일치하지 않습니다.");
  }
  const currentIndex = Math.max(0, Math.min(input.currentIndex, input.history.length - 1));
  let changed = false;
  const history = input.history.map((snapshot) => {
    let snapshotChanged = false;
    const pages = snapshot.map((page) => {
      let pageChanged = false;
      const elements = page.elements.map((element) => {
        if (
          element.id !== input.assetId || element.type !== "image" ||
          element.src !== input.expectedSource
        ) return element;
        pageChanged = true;
        return { ...element, src: input.canonicalSource };
      });
      if (!pageChanged) return page;
      snapshotChanged = true;
      return { ...page, elements };
    });
    if (!snapshotChanged) return snapshot as TPage[];
    changed = true;
    return pages;
  });
  return {
    history: changed ? history : input.history.map((snapshot) => snapshot as TPage[]),
    changed,
    previousCurrentPages: input.history[currentIndex] ?? [],
    nextCurrentPages: history[currentIndex] ?? [],
  };
}

// Compile-time assurance that descriptor and realtime boolean key sets do not silently diverge.
void STUDIO_WORK_ASSET_BOOLEAN_EDIT_KEYS;
