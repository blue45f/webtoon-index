import {
  Camera,
  Check,
  Copy,
  HardDrive,
  Search,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  cloneStudioSceneSnapshot,
  createStudioSceneSnapshot,
  filterStudioSceneSnapshots,
  normalizeStudioSceneSnapshotTags,
  STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES,
  STUDIO_SCENE_SNAPSHOT_TOTAL_MAX_BYTES,
  StudioSceneSnapshotLibraryError,
} from "./studio-scene-snapshot-library";
import { getProductStudioSceneSnapshotSqliteRepository } from "./studio-scene-snapshot-sqlite-repository";

import type { PageState } from "./studio-page-state";
import type {
  StudioSceneSnapshot,
  StudioSceneSnapshotTheme,
} from "./studio-scene-snapshot-library";

export interface StudioSceneSnapshotRepository {
  list: () => Promise<StudioSceneSnapshot[]>;
  save: (snapshot: StudioSceneSnapshot) => Promise<StudioSceneSnapshot[]>;
  duplicate: (id: string) => Promise<StudioSceneSnapshot[]>;
  delete: (id: string) => Promise<StudioSceneSnapshot[]>;
  readonly authority?: "sqlite" | "injected";
}

export interface StudioSceneSnapshotPanelProps {
  sourcePage: PageState;
  theme: StudioSceneSnapshotTheme;
  sourceWorkId?: string | null;
  onApply: (snapshot: StudioSceneSnapshot) => void;
  repository?: StudioSceneSnapshotRepository;
}

const DEFAULT_REPOSITORY: StudioSceneSnapshotRepository =
  getProductStudioSceneSnapshotSqliteRepository();

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes}B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)}KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)}MB`;
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function errorMessage(error: unknown): string {
  if (error instanceof StudioSceneSnapshotLibraryError) {
    switch (error.code) {
      case "item-too-large":
        return "이 페이지는 개별 스냅샷 용량 제한을 넘습니다.";
      case "data-url-too-large":
        return "페이지에 포함된 원본 이미지 데이터가 너무 큽니다. 대형 이미지를 에셋 링크로 바꿔 주세요.";
      case "3d-payload-too-large":
        return "페이지의 3D 편집 데이터가 너무 큽니다. 필요한 장면만 남긴 뒤 다시 저장해 주세요.";
      case "max-entries":
        return "개인 라이브러리가 가득 찼습니다. 사용하지 않는 스냅샷을 삭제해 주세요.";
      case "total-too-large":
        return "개인 라이브러리 전체 용량 제한을 넘습니다.";
      case "corrupt-data":
        return "손상된 로컬 스냅샷이 있어 저장하지 않았습니다. 정상 항목을 백업한 뒤 라이브러리를 정리해 주세요.";
      case "storage-blocked":
        return "다른 탭이 로컬 라이브러리 갱신을 막고 있습니다. 다른 Studio 탭을 닫아 주세요.";
      case "storage-unavailable":
      case "clone-unavailable":
        return "SQLite/OPFS 개인 장면 라이브러리를 사용할 수 없습니다. 저장되지 않았습니다.";
      case "not-found":
        return "선택한 장면 스냅샷을 찾지 못했습니다.";
      default:
        return "로컬 장면 라이브러리 작업을 완료하지 못했습니다.";
    }
  }
  return "로컬 장면 라이브러리 작업을 완료하지 못했습니다.";
}

export function StudioSceneSnapshotPanel({
  sourcePage,
  theme,
  sourceWorkId,
  onApply,
  repository = DEFAULT_REPOSITORY,
}: StudioSceneSnapshotPanelProps) {
  const nameId = useId();
  const tagsId = useId();
  const [snapshots, setSnapshots] = useState<StudioSceneSnapshot[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState(() =>
    sourcePage.name?.trim() ? `${sourcePage.name.trim()} 스냅샷` : "새 장면 스냅샷"
  );
  const [tagsText, setTagsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageState, setStorageState] = useState<
    "loading" | "sqlite" | "injected" | "unavailable"
  >("loading");
  const loadGenerationRef = useRef(0);
  const operationGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setStorageState("loading");
    void repository
      .list()
      .then((entries) => {
        if (!mountedRef.current || generation !== loadGenerationRef.current) return;
        setSnapshots(entries);
        setError(null);
        setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
      })
      .catch((cause: unknown) => {
        if (!mountedRef.current || generation !== loadGenerationRef.current) return;
        setError(errorMessage(cause));
        setStorageState("unavailable");
      })
      .finally(() => {
        if (mountedRef.current && generation === loadGenerationRef.current) setLoading(false);
      });
    return () => {
      if (loadGenerationRef.current === generation) loadGenerationRef.current += 1;
    };
  }, [repository]);

  const visibleSnapshots = filterStudioSceneSnapshots(snapshots, query);
  const usedBytes = snapshots.reduce((total, snapshot) => total + snapshot.byteSize, 0);

  async function captureCurrentPage(): Promise<void> {
    if (busyId) return;
    const generation = ++operationGenerationRef.current;
    setBusyId("capture");
    setError(null);
    try {
      const snapshot = createStudioSceneSnapshot({
        name,
        tags: normalizeStudioSceneSnapshotTags(tagsText.split(",")),
        page: sourcePage,
        theme,
        ...(sourceWorkId !== undefined ? { sourceWorkId } : {}),
      });
      const entries = await repository.save(snapshot);
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      setSnapshots(entries);
      setName(`${sourcePage.name?.trim() || "새 장면"} 스냅샷`);
      setTagsText("");
      setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
    } catch (cause) {
      if (mountedRef.current && generation === operationGenerationRef.current) {
        setError(errorMessage(cause));
        setStorageState("unavailable");
      }
    } finally {
      if (mountedRef.current && generation === operationGenerationRef.current) setBusyId(null);
    }
  }

  async function duplicateSnapshot(id: string): Promise<void> {
    if (busyId) return;
    const generation = ++operationGenerationRef.current;
    setBusyId(id);
    setError(null);
    try {
      const entries = await repository.duplicate(id);
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      setSnapshots(entries);
      setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
    } catch (cause) {
      if (mountedRef.current && generation === operationGenerationRef.current) {
        setError(errorMessage(cause));
        setStorageState("unavailable");
      }
    } finally {
      if (mountedRef.current && generation === operationGenerationRef.current) setBusyId(null);
    }
  }

  async function deleteSnapshot(id: string): Promise<void> {
    if (busyId) return;
    const generation = ++operationGenerationRef.current;
    setBusyId(id);
    setError(null);
    try {
      const entries = await repository.delete(id);
      if (!mountedRef.current || generation !== operationGenerationRef.current) return;
      setSnapshots(entries);
      setPendingDeleteId(null);
      setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
    } catch (cause) {
      if (mountedRef.current && generation === operationGenerationRef.current) {
        setError(errorMessage(cause));
        setStorageState("unavailable");
      }
    } finally {
      if (mountedRef.current && generation === operationGenerationRef.current) setBusyId(null);
    }
  }

  function applySnapshot(snapshot: StudioSceneSnapshot): void {
    try {
      onApply(cloneStudioSceneSnapshot(snapshot));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <section
      aria-labelledby="studio-scene-snapshot-title"
      className="flex h-full max-h-[calc(100dvh-1rem)] min-h-0 flex-col overflow-hidden bg-panel text-fg"
      data-studio-scene-snapshot-panel="true"
    >
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Camera size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="studio-scene-snapshot-title" className="text-sm font-bold text-fg">
                장면 스냅샷
              </h2>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.68rem] font-semibold text-fg-2">
                개인 · 이 기기 전용
              </span>
              <span
                className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.68rem] font-semibold text-fg-3"
                data-studio-scene-snapshot-authority={storageState}
              >
                {storageState === "loading"
                  ? "SQLite/OPFS 확인 중"
                  : storageState === "sqlite"
                    ? "SQLite/OPFS 저장"
                    : storageState === "unavailable"
                      ? "저장소 사용 불가"
                      : "주입 저장소"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              현재 페이지의 레이어, 배경, 메모, 테마와 애니메이션을 함께 보관합니다.
            </p>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-card px-3 py-2.5 text-xs leading-relaxed text-fg-2">
          <Users size={16} className="mt-0.5 shrink-0 text-fg-3" aria-hidden="true" />
          팀 공유와 에셋 마켓 게시는 아직 지원하지 않습니다. 이 브라우저의 개인
          라이브러리에만 저장됩니다.
        </p>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        data-studio-scene-snapshot-scroll-body="true"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void captureCurrentPage();
          }}
          className="space-y-3 border-b border-line pb-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-fg">현재 페이지 보관</h3>
              <p className="mt-0.5 text-[0.7rem] text-fg-3">
                원본 data URL과 3D 편집 데이터에는 안전 용량 제한이 적용됩니다.
              </p>
            </div>
            <span className="shrink-0 text-[0.68rem] tabular-nums text-fg-3">
              레이어 {sourcePage.elements.length}개
            </span>
          </div>
          <label htmlFor={nameId} className="block">
            <span className="mb-1 block text-xs font-semibold text-fg-2">이름</span>
            <input
              id={nameId}
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.currentTarget.value)}
              className="min-h-11 w-full rounded-xl border border-line-strong bg-card px-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              placeholder="예: 옥상 재회 장면"
            />
          </label>
          <label htmlFor={tagsId} className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-fg-2">
              <Tag size={13} aria-hidden="true" />
              태그
            </span>
            <input
              id={tagsId}
              value={tagsText}
              onChange={(event) => setTagsText(event.currentTarget.value)}
              className="min-h-11 w-full rounded-xl border border-line-strong bg-card px-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              placeholder="로맨스, 옥상, 해질녘"
            />
          </label>
          <button
            type="submit"
            disabled={Boolean(busyId) || !name.trim()}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera size={17} aria-hidden="true" />
            {busyId === "capture" ? "보관 중…" : "현재 페이지 스냅샷 보관"}
          </button>
        </form>

        <div className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-fg">
              개인 라이브러리 <span className="text-fg-3">{snapshots.length}개</span>
            </h3>
            <p className="flex items-center gap-1 text-[0.68rem] tabular-nums text-fg-3">
              <HardDrive size={13} aria-hidden="true" />
              {formatBytes(usedBytes)} / {formatBytes(STUDIO_SCENE_SNAPSHOT_TOTAL_MAX_BYTES)}
              {" · "}
              최대 {STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES}개
            </p>
          </div>
          <label className="relative mt-3 block">
            <span className="sr-only">장면 스냅샷 검색</span>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="min-h-11 w-full rounded-xl border border-line-strong bg-card pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              placeholder="이름, 태그, 페이지 메모 검색"
            />
          </label>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-xl border border-danger/45 bg-danger/10 px-3 py-2.5 text-xs leading-relaxed text-danger"
          >
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-2" aria-label="장면 스냅샷 불러오는 중">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-xl bg-card motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : visibleSnapshots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
            <Camera size={24} className="mx-auto text-fg-3" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-fg">
              {query.trim() ? "검색 결과가 없습니다" : "보관한 장면이 없습니다"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              {query.trim()
                ? "다른 이름이나 태그로 찾아보세요."
                : "위에서 현재 페이지를 첫 장면 스냅샷으로 보관해 보세요."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line border-y border-line" aria-label="장면 스냅샷 목록">
            {visibleSnapshots.map((snapshot) => {
              const deleting = pendingDeleteId === snapshot.id;
              const busy = busyId === snapshot.id;
              return (
                <li key={snapshot.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 block h-14 w-10 shrink-0 rounded-lg border border-line shadow-inner"
                      style={{
                        background:
                          snapshot.page.bgGrad?.length
                            ? `linear-gradient(180deg, ${snapshot.page.bgGrad.join(", ")})`
                            : snapshot.page.bg,
                      }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 truncate text-sm font-semibold text-fg">
                          {snapshot.name}
                        </p>
                        <span className="text-[0.65rem] font-semibold text-fg-3">
                          v{snapshot.version}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[0.68rem] text-fg-3">
                        {snapshot.page.elements.length}개 레이어 ·{" "}
                        {formatBytes(snapshot.byteSize)} · {formatTimestamp(snapshot.updatedAt)}
                      </p>
                      {snapshot.tags.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {snapshot.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-card px-2 py-0.5 text-[0.65rem] text-fg-2"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-2 text-[0.68rem] leading-relaxed text-warning">
                    적용하면 현재 페이지 전체가 이 스냅샷으로 교체됩니다. 최종 확인과
                    실행은 편집기가 담당합니다.
                  </p>

                  {deleting ? (
                    <div className="mt-2 flex gap-2 rounded-xl bg-card p-2">
                      <p className="min-w-0 flex-1 self-center text-xs text-fg-2">
                        이 장면을 삭제할까요?
                      </p>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                        className="min-h-11 rounded-xl border border-line px-3 text-xs font-semibold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteSnapshot(snapshot.id)}
                        className="min-h-11 rounded-xl bg-danger px-3 text-xs font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
                      >
                        {busy ? "삭제 중…" : "삭제"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => applySnapshot(snapshot)}
                        disabled={Boolean(busyId)}
                        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-accent px-2 text-xs font-bold text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
                      >
                        <Check size={15} aria-hidden="true" />
                        적용
                      </button>
                      <button
                        type="button"
                        onClick={() => void duplicateSnapshot(snapshot.id)}
                        disabled={Boolean(busyId)}
                        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-card px-2 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
                      >
                        <Copy size={15} aria-hidden="true" />
                        {busy ? "복제 중…" : "복제"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(snapshot.id)}
                        disabled={Boolean(busyId)}
                        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-card px-2 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        삭제
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
