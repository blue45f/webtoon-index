// 이메레스 개인 보관함 패널 — studio-emeres-templates.ts(고정 카탈로그)의 "내가 만든 틀" 탭.
// 캔버스 요소를 캡처하거나(우클릭 "이메레스로 저장" — 통합 문서 §3 참고) 이미지를 업로드해
// 개인 스케치/사진 참고 틀로 저장·이름변경·삭제·분류하고, 캔버스에 다시 꺼내 쓴다.
//
// 이미 열려 있는 이메레스 드롭다운(StudioPage의 menu === "emeres") 안의 탭 콘텐츠로 마운트되므로
// (StudioBrushLibraryPanel.tsx와 동일한 이유로) position:fixed/absolute를 쓰지 않는다 — 배치는
// 그 드롭다운을 감싼 컨테이너가 담당한다. 캔버스 제스처를 가로채지 않으므로(그냥 이미지 저장/적용)
// disarmAllPixelTools() 대상에도 포함되지 않는다. 자세한 통합 지점은
// docs/studio-emeres-library-integration.md 참고.
import { ImagePlus, Pencil, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import {
  createEmeresLibraryItem,
  deleteEmeresLibraryItemInMemory,
  MAX_EMERES_LIBRARY_ITEMS,
  renameEmeresLibraryItemInMemory,
  setEmeresLibraryItemCategoryInMemory,
  type StudioEmeresLibraryItem,
  upsertEmeresLibraryItem,
} from "./studio-emeres-library";
import { getProductStudioEmeresSqliteRepository } from "./studio-emeres-sqlite-repository";
import { EMERES_CATEGORIES, type EmeresCategory } from "./studio-emeres-templates";
import { downscaleImageFile } from "./studio-image-utils";

import { cx } from "@/shared/lib/cx";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB — StudioBrandKitPanel의 로고 업로드 가드(MAX_LOGO_UPLOAD_BYTES)와 동일한, 다운스케일 전 원본 파일에 대한 저비용 가드.
const UPLOAD_MAX_DIM = 960; // 참고 이미지는 로고보다 커야 트레이싱에 쓸만하지만, MAX_EMERES_LIBRARY_ITEMS(30) 예산을 고려해 과하게 키우지 않는다.
const UPLOAD_QUALITY = 0.82;

export interface StudioEmeresLibraryPanelProps {
  /** 저장된 항목을 고르면 호출 — 실제 캔버스 삽입(밑그림 배치 + 펜 모드 전환)은 호출부(StudioPage)의
   *  addEmeresTemplate과 동일한 배치 로직으로 수행한다(위임 패턴, onApplyBrush와 동일 규약). */
  onPickItem: (item: StudioEmeresLibraryItem) => void;
  /** Test/embed seam. Product code leaves this undefined and uses shared V12 SQLite/OPFS. */
  repository?: StudioEmeresLibraryRepository;
}

export interface StudioEmeresLibraryRepository {
  readonly authority?: "sqlite" | "injected";
  list(): Promise<StudioEmeresLibraryItem[]>;
  save(item: StudioEmeresLibraryItem): Promise<StudioEmeresLibraryItem[]>;
  rename(id: string, name: string): Promise<StudioEmeresLibraryItem[]>;
  setCategory(
    id: string,
    category: EmeresCategory | undefined,
  ): Promise<StudioEmeresLibraryItem[]>;
  delete(id: string): Promise<StudioEmeresLibraryItem[]>;
  subscribe?(listener: () => void): () => void;
}

const PRODUCT_REPOSITORY: StudioEmeresLibraryRepository =
  getProductStudioEmeresSqliteRepository();

export function StudioEmeresLibraryPanel({
  onPickItem,
  repository = PRODUCT_REPOSITORY,
}: StudioEmeresLibraryPanelProps) {
  const [items, setItems] = useState<StudioEmeresLibraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ src: string; width: number; height: number } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const [storageState, setStorageState] = useState<
    "loading" | "sqlite" | "injected" | "memory" | "unavailable"
  >("loading");
  const loadGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const memoryModeRef = useRef(false);
  const mutationBusyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    memoryModeRef.current = false;

    const hydrate = async () => {
      const generation = ++loadGenerationRef.current;
      setStorageState("loading");
      try {
        const loaded = await repository.list();
        if (
          !active
          || !mountedRef.current
          || generation !== loadGenerationRef.current
          || memoryModeRef.current
        ) {
          return;
        }
        setItems(loaded);
        setError(null);
        setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
      } catch (cause) {
        if (!active || !mountedRef.current || generation !== loadGenerationRef.current) return;
        setError(
          `SQLite/OPFS 이메레스 보관함을 열지 못했습니다: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
        setStorageState("unavailable");
      }
    };

    void hydrate();
    const unsubscribe = repository.subscribe?.(() => void hydrate());
    return () => {
      active = false;
      loadGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [repository]);

  async function commitMutation(
    persisted: () => Promise<StudioEmeresLibraryItem[]>,
    memoryUpdate: (current: readonly StudioEmeresLibraryItem[]) => StudioEmeresLibraryItem[],
    successMessage: string,
  ): Promise<void> {
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    const generation = ++mutationGenerationRef.current;
    setMutationBusy(true);
    setError(null);
    setDoneMsg(null);
    if (storageState === "memory") {
      setItems((current) => memoryUpdate(current));
      setDoneMsg(`${successMessage} 세션 메모리에만 유지됩니다.`);
      mutationBusyRef.current = false;
      setMutationBusy(false);
      return;
    }
    try {
      const next = await persisted();
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
      setItems(next);
      setStorageState(repository.authority === "sqlite" ? "sqlite" : "injected");
      setDoneMsg(successMessage);
    } catch (cause) {
      if (!mountedRef.current || generation !== mutationGenerationRef.current) return;
      setItems((current) => memoryUpdate(current));
      memoryModeRef.current = true;
      setStorageState("memory");
      setError(
        `SQLite/OPFS 저장에 실패해 변경을 현재 탭 메모리에만 유지합니다: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    } finally {
      if (mountedRef.current && generation === mutationGenerationRef.current) {
        mutationBusyRef.current = false;
        setMutationBusy(false);
      }
    }
  }

  function handleDelete(id: string): void {
    void commitMutation(
      () => repository.delete(id),
      (current) => deleteEmeresLibraryItemInMemory(current, id),
      "틀을 삭제했습니다.",
    );
  }

  function startRename(i: StudioEmeresLibraryItem) {
    setRenamingId(i.id);
    setRenamingName(i.name);
  }

  function commitRename(): void {
    if (!renamingId) return;
    const id = renamingId;
    const name = renamingName;
    setRenamingId(null);
    void commitMutation(
      () => repository.rename(id, name),
      (current) => renameEmeresLibraryItemInMemory(current, id, name),
      "이름을 변경했습니다.",
    );
  }

  function handleRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setRenamingId(null);
  }

  function handleCategoryChange(id: string, value: string): void {
    const category = value === "" ? undefined : (value as EmeresCategory);
    void commitMutation(
      () => repository.setCategory(id, category),
      (current) => setEmeresLibraryItemCategoryInMemory(current, id, category),
      "분류를 변경했습니다.",
    );
  }

  async function handleUploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 시에도 onChange가 다시 발생하도록 즉시 리셋(다른 라이브러리 패널과 동일 관례).
    if (!file) return;
    setError(null);
    setDoneMsg(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("파일이 너무 커요. 8MB 이하 이미지만 틀로 저장할 수 있어요.");
      return;
    }
    setDraftBusy(true);
    try {
      const scaled = await downscaleImageFile(file, UPLOAD_MAX_DIM, UPLOAD_QUALITY);
      setDraft(scaled);
      setDraftName(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지를 불러오지 못했어요.");
    } finally {
      setDraftBusy(false);
    }
  }

  function handleConfirmSave(): void {
    if (!draft) return;
    // draft는 downscaleImageFile이 성공했을 때만 세팅되므로(항상 유한한 양수 width/height + 비어있지
    // 않은 src) createEmeresLibraryItem은 절대 던지지 않는다 — StudioBrandKitPanel.handleCreate와
    // 동일하게 try/catch가 필요 없다.
    const created = createEmeresLibraryItem(draftName, draft);
    setDraft(null);
    setDraftName("");
    void commitMutation(
      () => repository.save(created),
      (current) => upsertEmeresLibraryItem(current, created),
      `"${created.name}" 틀을 저장했어요.`,
    );
  }

  function handleCancelDraft() {
    setDraft(null);
    setDraftName("");
  }

  return (
    <div
      className="space-y-2"
      aria-busy={draftBusy || mutationBusy || storageState === "loading"}
      data-studio-emeres-authority={storageState}
    >
      <p className="rounded-lg border border-line bg-card px-2 py-1.5 text-[0.66rem] leading-snug text-fg-3">
        캔버스 요소를 우클릭해 &quot;이메레스로 저장&quot;을 누르거나, 이미지를 업로드해 나만의 밑그림 틀을 만들어보세요.
      </p>

      {error && (
        <p className="text-[0.64rem] text-bad" role="alert">
          {error}
        </p>
      )}
      {doneMsg && !error && (
        <p className="text-[0.64rem] text-good" role="status">
          {doneMsg}
        </p>
      )}

      <p className="text-[0.6rem] font-semibold text-fg-3" role="status">
        {storageState === "loading"
          ? "SQLite/OPFS 보관함 확인 중"
          : storageState === "sqlite"
            ? "이 기기 SQLite/OPFS 저장"
            : storageState === "memory"
              ? "현재 탭 메모리 임시 · 새로고침 시 사라짐"
              : storageState === "unavailable"
                ? "SQLite/OPFS 사용 불가 · 저장되지 않음"
                : "주입 저장소"}
      </p>

      {draft ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-card p-2">
          <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded bg-[oklch(0.96_0.006_78)] p-1">
            <img src={draft.src} alt="새 틀 미리보기" className="h-full w-full object-contain" />
          </div>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="틀 이름"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- 저장 폼은 업로드 완료 직후에만 열리고, 곧바로 이름을 입력할 것이므로 즉시 포커스가 정답
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmSave();
              else if (e.key === "Escape") handleCancelDraft();
            }}
            className="h-7 rounded border border-line bg-panel px-2 text-xs text-fg outline-none focus:border-accent"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleCancelDraft}
              className="flex-1 rounded-lg border border-line py-1.5 text-[0.66rem] font-semibold text-fg-2 transition-colors hover:bg-raised"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirmSave}
              disabled={mutationBusy || storageState === "loading"}
              className="flex-1 rounded-lg bg-accent py-1.5 text-[0.66rem] font-semibold text-on-accent transition-colors hover:opacity-90"
            >
              저장
            </button>
          </div>
        </div>
      ) : (
        <label
          className={cx(
            "flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg border border-line py-1.5 text-[0.66rem] font-semibold text-fg-2 transition-colors hover:bg-raised",
            (draftBusy || mutationBusy || storageState === "loading")
              && "pointer-events-none opacity-60"
          )}
        >
          <ImagePlus size={11} /> {draftBusy ? "불러오는 중…" : "이미지 업로드"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUploadFile}
            disabled={draftBusy || mutationBusy || storageState === "loading"}
          />
        </label>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[0.64rem] leading-relaxed text-fg-3">
          저장된 틀이 없어요. 위에서 이미지를 업로드하거나, 캔버스 요소를 우클릭해 저장해보세요.
        </p>
      ) : (
        <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
          {items.map((i) => (
            <div key={i.id} className="rounded-lg border border-line bg-card px-1.5 py-1.5">
              <div className="mb-1 flex items-center gap-0.5">
                {renamingId === i.id ? (
                  <input
                    type="text"
                    value={renamingName}
                    onChange={(e) => setRenamingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleRenameKeyDown}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- inline rename field opens only on user action; focusing it immediately is correct edit-on-demand UX
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-accent bg-panel px-1 py-0.5 text-[0.68rem] text-fg outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[0.68rem] font-medium text-fg" title={i.name}>
                    {i.name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => startRename(i)}
                  disabled={mutationBusy}
                  aria-label={`${i.name} 이름 변경`}
                  title="이름 변경"
                  className="shrink-0 text-fg-3 transition-colors hover:text-accent"
                >
                  <Pencil size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(i.id)}
                  disabled={mutationBusy}
                  aria-label={`${i.name} 틀 삭제`}
                  title="삭제"
                  className="shrink-0 text-fg-3 transition-colors hover:text-bad"
                >
                  <X size={10} />
                </button>
              </div>
              <select
                value={i.category ?? ""}
                onChange={(e) => handleCategoryChange(i.id, e.target.value)}
                disabled={mutationBusy}
                aria-label={`${i.name} 분류`}
                className="mb-1 h-5 w-full rounded border border-line bg-panel px-1 text-[0.58rem] text-fg-3 outline-none focus:border-accent"
              >
                <option value="">미분류</option>
                {EMERES_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onPickItem(i)}
                title={`${i.name} 불러오기`}
                className="flex h-20 w-full items-center justify-center overflow-hidden rounded border border-line/60 bg-[oklch(0.96_0.006_78)] p-1 transition-colors hover:border-accent"
              >
                <img src={i.src} alt={i.name} className="h-full w-full object-contain" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="border-t border-line/60 pt-1.5 text-[0.6rem] leading-snug text-fg-3">
        이 기기의 공유 Studio SQLite/OPFS에 저장돼요(다른 기기와 공유되지 않아요). 최대 {MAX_EMERES_LIBRARY_ITEMS}개까지 보관되고, 넘으면 가장 오래된 항목부터 사라져요.
      </p>
    </div>
  );
}
