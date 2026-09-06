import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { buildStudioHref } from "./creator-studio-links";
import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioDiscardLocalChangesRequest } from "./studio-destructive-command-catalog";
import { downscaleDataUrl, downscaleImageFile } from "./studio-image-utils";
import {
  getStudioSharedDocument,
  getStudioSharedDocumentMeta,
  isStudioSharedDocumentAccessError,
  isStudioSharedDocumentRevisionConflictError,
  updateStudioSharedDocument,
  type StudioSharedDocumentMeta,
} from "./studio-shared-document-client";
import {
  assertStudioUploadSourceBatch,
  inspectStudioUploadSourceImage,
  selectStudioUploadDecodedPixelLimit,
} from "./studio-upload-image-safety";
import {
  STUDIO_UPLOAD_ACTION_DOCK_CLASS,
  STUDIO_UPLOAD_CONTAINER_CLASS,
  STUDIO_UPLOAD_PAGE_CONTROLS_CLASS,
  STUDIO_UPLOAD_PAGE_CONTROL_CLASS,
  STUDIO_UPLOAD_PAGE_LIST_CLASS,
  STUDIO_UPLOAD_PAGE_ROW_CLASS,
} from "./studio-upload-layout";
import {
  advanceStudioUploadSharedMetaAfterSave,
  assertStudioUploadJsonPayloadSize,
  assertStudioUploadPublishScope,
  assertStudioUploadSharedMetaUnchanged,
  canEditStudioUploadSharedDocument,
  canPublishStudioUploadSharedDocument,
  captureStudioUploadPublishScope,
  isStudioUploadHydrationScopeCurrent,
  isStudioUploadPublishScopeCurrent,
  isStudioUploadPublishScopeInvalidatedError,
  isStudioUploadSharedAccessChangedError,
  isStudioUploadWorkspaceLocked,
  resolveStudioUploadActionLocks,
  resolveStudioUploadSharedCrdtSaveFence,
  resolveStudioUploadUpdateRevision,
  runStudioUploadPublishStages,
  shouldResetStudioUploadDraft,
  validateStudioUploadHydratedSharedDocument,
  validateStudioUploadSavedWork,
  type StudioUploadCurrentScope,
  type StudioUploadHydrationStatus,
  type StudioUploadPublishScope,
} from "./studio-upload-publish-safety";
import { resolveStudioUploadWorkId } from "./studio-upload-route";
import { StudioPublishContextBanner, type PublishContext } from "./StudioPublishContextBanner";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import { useSession } from "@/src/compat/auth-session-store";
import Link from "@/src/compat/router-link";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import {
  getChallenge,
  getSeries,
} from "@/src/infrastructure/creator-client";

const MAX_PAGES = 40;

type UploadPage = {
  id: string;
  src: string;
  width: number;
  height: number;
  name: string;
};

function uid() {
  return `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface StudioUploadPublishProps {
  /** Canonical route identity. Undefined keeps the legacy query-only entry compatible. */
  readonly workId?: string | null;
}

export function StudioUploadPublish({ workId: routeWorkId }: StudioUploadPublishProps = {}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: session } = useSession();
  const authUserId = session?.user?.id ?? null;
  const loggedIn = authUserId !== null;
  const workId = resolveStudioUploadWorkId(routeWorkId, params.get("id"));
  useDocumentTitle(workId ? "업로드 작품 수정" : "이미지 업로드 게시");

  const seriesId = params.get("seriesId");
  const challengeId = params.get("challengeId");
  const titleId = params.get("titleId");

  const [pages, setPages] = useState<UploadPage[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [publishContext, setPublishContext] = useState<PublishContext>({});
  const [hydrationStatus, setHydrationStatus] = useState<StudioUploadHydrationStatus>(
    workId ? "loading" : "ready"
  );
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [workRevision, setWorkRevision] = useState<number | undefined>();
  const [hydratedScope, setHydratedScope] = useState<StudioUploadPublishScope | null>(null);
  const [sharedMeta, setSharedMeta] = useState<StudioSharedDocumentMeta | null>(null);
  const mountedRef = useRef(false);
  const currentScopeRef = useRef<StudioUploadCurrentScope>({ authUserId, workId });
  const committedScopeRef = useRef<StudioUploadCurrentScope>({ authUserId, workId });
  const publishAbortRef = useRef<AbortController | null>(null);
  const publishRequestIdRef = useRef(0);
  currentScopeRef.current = { authUserId, workId };
  const currentScope = { authUserId, workId };
  const hydrationScopeCurrent = isStudioUploadHydrationScopeCurrent(
    hydratedScope,
    currentScope
  );
  const hydrating = Boolean(
    workId &&
      (hydrationStatus === "loading" ||
        (hydrationStatus === "ready" && !hydrationScopeCurrent))
  );
  const workspaceLocked = isStudioUploadWorkspaceLocked({
    workId,
    currentScope,
    hydratedScope,
    hydrationStatus,
    saving,
    loadingFiles,
  });
  const { sharedCanEdit, sharedCanPublish, mutationLocked, publishLocked } =
    resolveStudioUploadActionLocks({ workId, workspaceLocked, meta: sharedMeta });

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      publishRequestIdRef.current += 1;
      publishAbortRef.current?.abort();
      publishAbortRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const nextScope = { authUserId, workId };
    const previousScope = committedScopeRef.current;
    const resetDraft = shouldResetStudioUploadDraft(previousScope, nextScope);
    const adoptingGuestDraft =
      previousScope.authUserId === null &&
      previousScope.workId === null &&
      nextScope.authUserId !== null &&
      nextScope.workId === null;
    committedScopeRef.current = nextScope;
    publishRequestIdRef.current += 1;
    publishAbortRef.current?.abort();
    publishAbortRef.current = null;
    setSaving(false);
    setLoadingFiles(false);
    if (resetDraft) {
      setPages([]);
      setTitle("");
      setDescription("");
      setTagsText("");
      setError(null);
      setSuccessMessage(null);
      setDirty(false);
      setHydrationError(null);
      setWorkRevision(undefined);
      setHydratedScope(null);
      setSharedMeta(null);
      setHydrationStatus(workId ? "loading" : "ready");
    } else if (adoptingGuestDraft) {
      setError(null);
    }
  }, [authUserId, workId]);

  useEffect(() => {
    if (!workId) {
      setHydrationStatus("ready");
      setHydrationError(null);
      setWorkRevision(undefined);
      setHydratedScope(null);
      setSharedMeta(null);
      return;
    }
    setPages([]);
    setTitle("");
    setDescription("");
    setTagsText("");
    setWorkRevision(undefined);
    setHydratedScope(null);
    setSharedMeta(null);
    setHydrationStatus("loading");
    setHydrationError(null);
    setSuccessMessage(null);
    if (!authUserId) {
      setHydrationStatus("error");
      setHydrationError("기존 작품을 열려면 참여 권한이 있는 계정으로 로그인해 주세요.");
      return;
    }
    const controller = new AbortController();
    const scope = captureStudioUploadPublishScope(authUserId, workId);
    void getStudioSharedDocument(workId, controller.signal)
      .then((shared) => {
        if (
          controller.signal.aborted ||
          !isStudioUploadPublishScopeCurrent(
            scope,
            currentScopeRef.current,
            mountedRef.current
          )
        ) {
          return;
        }
        const loadedRevision = validateStudioUploadHydratedSharedDocument(shared, scope);
        const pageMeta = Array.isArray(shared.document.doc.pageMeta)
          ? (shared.document.doc.pageMeta as Array<{
              width?: unknown;
              height?: unknown;
              name?: unknown;
            }>)
          : [];
        setPages(
          shared.document.pages.map((src, index) => {
            const meta = pageMeta[index];
            return {
              id: uid(),
              src,
              width: Math.max(1, Number(meta?.width) || 1),
              height: Math.max(1, Number(meta?.height) || 1),
              name: typeof meta?.name === "string" && meta.name.trim() ? meta.name : `${index + 1}페이지`,
            };
          })
        );
        const { document: _document, ...meta } = shared;
        setTitle(shared.document.title);
        setDescription(shared.document.description);
        setTagsText(shared.document.tags.join(", "));
        setWorkRevision(loadedRevision);
        setHydratedScope(scope);
        setSharedMeta(meta);
        setDirty(false);
        setHydrationStatus("ready");
        setHydrationError(null);
      })
      .catch((cause) => {
        if (
          controller.signal.aborted ||
          !isStudioUploadPublishScopeCurrent(
            scope,
            currentScopeRef.current,
            mountedRef.current
          )
        ) {
          return;
        }
        setHydrationStatus("error");
        setHydrationError(
          cause instanceof Error ? cause.message : "작품을 불러오지 못했습니다."
        );
      });
    return () => controller.abort();
  }, [authUserId, hydrationAttempt, workId]);

  useEffect(() => {
    if (
      !workId ||
      !authUserId ||
      hydrationStatus !== "ready" ||
      saving ||
      !sharedMeta ||
      !hydratedScope ||
      !isStudioUploadHydrationScopeCurrent(hydratedScope, currentScopeRef.current)
    ) {
      return;
    }

    const expectedMeta = sharedMeta;
    const scope = hydratedScope;
    let generation = 0;
    let activeController: AbortController | null = null;

    const failClosed = (message: string) => {
      setWorkRevision(undefined);
      setHydratedScope(null);
      setSharedMeta(null);
      setHydrationStatus("error");
      setHydrationError(message);
    };

    const revalidate = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const requestGeneration = generation + 1;
      generation = requestGeneration;
      try {
        const fresh = await getStudioSharedDocumentMeta(workId, controller.signal);
        if (
          controller.signal.aborted ||
          requestGeneration !== generation ||
          !isStudioUploadPublishScopeCurrent(
            scope,
            currentScopeRef.current,
            mountedRef.current
          )
        ) {
          return;
        }
        assertStudioUploadSharedMetaUnchanged(expectedMeta, fresh);
      } catch (cause) {
        if (
          controller.signal.aborted ||
          requestGeneration !== generation ||
          !isStudioUploadPublishScopeCurrent(
            scope,
            currentScopeRef.current,
            mountedRef.current
          )
        ) {
          return;
        }
        failClosed(
          cause instanceof Error
            ? cause.message
            : "공동 문서 권한을 다시 확인하지 못했습니다. 작품을 다시 불러와 주세요."
        );
      }
    };

    const onFocus = () => {
      void revalidate();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      generation += 1;
      activeController?.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authUserId, hydratedScope, hydrationStatus, saving, sharedMeta, workId]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    async function loadContext() {
      const next: PublishContext = {};
      if (seriesId) {
        try {
          const series = await getSeries(seriesId, controller.signal);
          if (!alive) return;
          const maxEpisode = series.episodeList.reduce(
            (max, episode) => Math.max(max, episode.episodeNo ?? 0),
            0
          );
          next.series = {
            id: series.id,
            title: series.title,
            nextEpisodeNo: maxEpisode + 1,
          };
        } catch {
          // 시리즈 로드 실패 시 맥락 배너만 생략.
        }
      }
      if (challengeId) {
        try {
          const challenge = await getChallenge(challengeId, controller.signal);
          if (!alive) return;
          next.challenge = {
            id: challenge.id,
            title: challenge.title,
            theme: challenge.theme,
          };
        } catch {
          // 챌린지 로드 실패 시 맥락 배너만 생략.
        }
      }
      if (alive) setPublishContext(next);
    }
    void loadContext();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [seriesId, challengeId]);

  async function onPickImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (mutationLocked) return;
    if (files.length === 0) return;
    if (pages.length + files.length > MAX_PAGES) {
      setError(`이미지는 최대 ${MAX_PAGES}장까지 올릴 수 있어요.`);
      return;
    }
    try {
      assertStudioUploadSourceBatch(files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이미지 원본 크기를 확인하지 못했습니다.");
      return;
    }
    setLoadingFiles(true);
    setError(null);
    setSuccessMessage(null);
    const fileScope = { authUserId, workId };
    const isFileScopeCurrent = () =>
      mountedRef.current &&
      currentScopeRef.current.authUserId === fileScope.authUserId &&
      currentScopeRef.current.workId === fileScope.workId;
    try {
      const next: UploadPage[] = [];
      const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
      const maximumPixels = selectStudioUploadDecodedPixelLimit({
        coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
        deviceMemoryGb: navigatorWithMemory.deviceMemory,
      });
      for (const file of files) {
        await inspectStudioUploadSourceImage(file, maximumPixels);
        if (!isFileScopeCurrent()) return;
        const scaled = await downscaleImageFile(file, 1600, 0.88);
        if (!isFileScopeCurrent()) return;
        next.push({
          id: uid(),
          src: scaled.src,
          width: scaled.width,
          height: scaled.height,
          name: file.name,
        });
      }
      if (!isFileScopeCurrent()) return;
      setPages((current) => [...current, ...next]);
      setDirty(true);
      if (!title.trim() && next[0]) {
        const base = next[0].name.replace(/\.[^.]+$/, "").trim();
        if (base) setTitle(base.slice(0, 80));
      }
    } catch (err) {
      if (isFileScopeCurrent()) {
        setError(err instanceof Error ? err.message : "이미지를 불러오지 못했습니다.");
      }
    } finally {
      if (isFileScopeCurrent()) setLoadingFiles(false);
    }
  }

  function movePage(id: string, direction: -1 | 1) {
    if (mutationLocked) return;
    setSuccessMessage(null);
    setDirty(true);
    setPages((current) => {
      const index = current.findIndex((page) => page.id === id);
      if (index < 0) return current;
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function removePage(id: string) {
    if (mutationLocked) return;
    setSuccessMessage(null);
    setDirty(true);
    setPages((current) => current.filter((page) => page.id !== id));
  }

  async function handlePublish(status: "published" | "draft") {
    if (publishAbortRef.current || saving) return;
    let publishScope: StudioUploadPublishScope;
    try {
      publishScope = captureStudioUploadPublishScope(authUserId, workId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인 후 게시할 수 있어요.");
      return;
    }
    let baseRevision: number | undefined;
    try {
      baseRevision = resolveStudioUploadUpdateRevision(
        publishScope,
        hydratedScope,
        hydrationStatus,
        workRevision
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "기존 작품을 다시 불러와 주세요.");
      return;
    }
    const sharedMetaSnapshot = sharedMeta;
    if (publishScope.workId) {
      if (!sharedMetaSnapshot || !canEditStudioUploadSharedDocument(sharedMetaSnapshot)) {
        setError("현재 역할은 공동 원고를 저장할 수 없습니다.");
        return;
      }
      if (status === "published" && !canPublishStudioUploadSharedDocument(sharedMetaSnapshot)) {
        setError("작품 게시 상태는 소유자만 변경할 수 있습니다.");
        return;
      }
    }
    if (!title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    if (pages.length === 0) {
      setError("이미지를 1장 이상 추가해주세요.");
      return;
    }
    const pageSnapshot = pages.map((page) => ({ ...page }));
    const titleSnapshot = title.trim();
    const descriptionSnapshot = description.trim();
    const tagsSnapshot = tagsText;
    const tags = tagsSnapshot
      .split(/[,\s]+/)
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .slice(0, 8);
    const publishSeriesId = seriesId;
    const publishChallengeId = challengeId;
    const publishTitleId = titleId;
    const controller = new AbortController();
    const requestId = publishRequestIdRef.current + 1;
    publishRequestIdRef.current = requestId;
    publishAbortRef.current = controller;
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const pageImages = pageSnapshot.map((page) => page.src);
      const saved = await runStudioUploadPublishStages({
        scope: publishScope,
        currentScope: () => currentScopeRef.current,
        mounted: () => mountedRef.current,
        signal: controller.signal,
        downscale: () => downscaleDataUrl(pageImages[0], 480),
        loadClient: async () =>
          publishScope.workId
            ? ({
                kind: "shared" as const,
                getMeta: getStudioSharedDocumentMeta,
                update: updateStudioSharedDocument,
              })
            : ({
                kind: "create" as const,
                module: await import("@/src/infrastructure/creator-client"),
              }),
        mutate: async (client, cover, signal) => {
          const editableContent = {
            title: titleSnapshot,
            description: descriptionSnapshot,
            tags,
            cover,
            pages: pageImages,
            doc: {
              format: "upload",
              pageMeta: pageSnapshot.map((page) => ({
                width: page.width,
                height: page.height,
                name: page.name,
              })),
            },
          };
          if (publishScope.workId) {
            if (
              client.kind !== "shared" ||
              baseRevision === undefined ||
              !sharedMetaSnapshot
            ) {
              throw new Error("공동 문서 저장 범위를 확인하지 못했어요.");
            }
            const fresh = await client.getMeta(
              publishScope.workId,
              signal
            );
            assertStudioUploadPublishScope(
              publishScope,
              currentScopeRef.current,
              mountedRef.current,
              signal
            );
            assertStudioUploadSharedMetaUnchanged(sharedMetaSnapshot, fresh);
            if (!canEditStudioUploadSharedDocument(fresh)) {
              throw new Error("공동 문서 편집 권한이 변경되었습니다.");
            }
            if (status === "published" && !canPublishStudioUploadSharedDocument(fresh)) {
              throw new Error("작품 게시 상태는 소유자만 변경할 수 있습니다.");
            }
            const patch = {
              baseRevision,
              // Upload documents do not mount the live CRDT editor. The fresh server-attested
              // frontier is still fenced by the PATCH transaction; any append after this GET
              // produces creator_crdt_sequence_conflict instead of silently crossing the save.
              crdtServerSequence: resolveStudioUploadSharedCrdtSaveFence(fresh),
              ...editableContent,
              ...(fresh.role === "owner"
                ? {
                    status,
                    ...(publishTitleId ? { titleId: publishTitleId } : {}),
                  }
                : {}),
            };
            assertStudioUploadJsonPayloadSize(patch);
            const response = await client.update(
              publishScope.workId,
              fresh.role,
              patch,
              signal
            );
            return {
              workId: response.workId,
              revision: response.revision,
              updatedAt: response.updatedAt,
            };
          }
          if (client.kind !== "create") {
            throw new Error("새 작품 게시 클라이언트를 확인하지 못했어요.");
          }
          const payload = {
            ...editableContent,
            format: "upload" as const,
            titleId: publishTitleId ?? undefined,
            status,
            seriesId: publishSeriesId ?? undefined,
            challengeId: publishChallengeId ?? undefined,
          };
          assertStudioUploadJsonPayloadSize(payload);
          const work = await client.module.createWork(payload, signal);
          return {
            workId: work.id,
            revision: validateStudioUploadSavedWork(work, publishScope, undefined),
            updatedAt: undefined,
          };
        },
      });
      assertStudioUploadPublishScope(
        publishScope,
        currentScopeRef.current,
        mountedRef.current,
        controller.signal
      );
      if (saved.revision !== undefined) setWorkRevision(saved.revision);
      if (publishScope.workId && sharedMetaSnapshot && saved.updatedAt) {
        const nextMeta = advanceStudioUploadSharedMetaAfterSave(sharedMetaSnapshot, {
          workId: saved.workId,
          revision: saved.revision ?? sharedMetaSnapshot.revision,
          updatedAt: saved.updatedAt,
        });
        setSharedMeta(nextMeta);
        setDirty(false);
        if (sharedMetaSnapshot.role === "owner" && status === "published") {
          navigate(`/create/${saved.workId}`);
        } else {
          setSuccessMessage(
            `공동 변경사항을 revision ${saved.revision ?? sharedMetaSnapshot.revision}로 저장했습니다.`
          );
        }
      } else {
        navigate(`/create/${saved.workId}`);
      }
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        !isStudioUploadPublishScopeInvalidatedError(cause) &&
        isStudioUploadPublishScopeCurrent(
          publishScope,
          currentScopeRef.current,
          mountedRef.current
        )
      ) {
        if (
          publishScope.workId &&
          (isStudioUploadSharedAccessChangedError(cause) ||
            isStudioSharedDocumentAccessError(cause) ||
            isStudioSharedDocumentRevisionConflictError(cause))
        ) {
          setWorkRevision(undefined);
          setHydratedScope(null);
          setSharedMeta(null);
          setHydrationStatus("error");
          setHydrationError(
            cause instanceof Error
              ? cause.message
              : "공동 문서 권한 또는 버전이 변경되었습니다. 다시 불러와 주세요."
          );
          setError(null);
        } else {
          setError(cause instanceof Error ? cause.message : "게시에 실패했어요.");
        }
      }
    } finally {
      if (publishAbortRef.current === controller) publishAbortRef.current = null;
      if (
        requestId === publishRequestIdRef.current &&
        isStudioUploadPublishScopeCurrent(
          publishScope,
          currentScopeRef.current,
          mountedRef.current
        )
      ) {
        setSaving(false);
      }
    }
  }

  return (
    <Container
      size="wide"
      className={STUDIO_UPLOAD_CONTAINER_CLASS}
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {/* 인앱 브라우저에는 주소창도 뒤로 가기 크롬도 없다 — 이 링크가 게시 화면을 벗어나는
            유일한 문이다. 20px 텍스트 링크로 두면 손가락으로 잡기 어려우니 터치에서만 44px 로 올린다. */}
        <Link
          href="/create"
          className="inline-flex items-center gap-1.5 text-sm text-fg-3 transition-colors hover:text-fg pointer-coarse:min-h-11 pointer-coarse:-mx-1 pointer-coarse:px-1"
        >
          <ArrowLeft size={15} />
          창작 게시판
        </Link>
        {!workId && (
          <Link
            href={buildStudioHref({ seriesId, challengeId, titleId })}
            className={buttonClass({ size: "sm", variant: "outline", className: "ml-auto gap-1.5" })}
          >
            <PenLine size={14} />
            컷툰 스튜디오로 전환
          </Link>
        )}
      </div>

      <header className="mb-5 rounded-2xl border border-line bg-panel/45 p-5 surface-hl sm:p-6">
        <p className="eyebrow text-accent">{workId ? "UPLOAD EDIT" : "UPLOAD PUBLISH"}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          {workId ? "업로드 작품 수정" : "이미지 업로드 게시"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-2">
          완성된 이미지를 그대로 올려 공유하세요. 여러 장을 순서대로 배치하면 세로 스크롤 웹툰처럼 읽을 수
          있습니다.
        </p>
      </header>

      <StudioPublishContextBanner context={publishContext} />

      {!loggedIn && (
        <div className="mb-4 rounded-xl border border-line bg-card/60 px-3 py-2 text-sm text-fg-2">
          게시하려면 로그인이 필요해요. (이미지 추가·미리보기는 로그인 없이도 가능)
        </div>
      )}

      {error && (
        <div
          className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad"
          role="alert"
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          aria-live="polite"
          className="mb-4 rounded-xl border border-good/40 bg-good/10 px-3 py-2 text-sm text-good"
          role="status"
        >
          {successMessage}
        </div>
      )}

      {hydrating && (
        <div
          aria-busy="true"
          className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-card/60 px-3 py-2 text-sm text-fg-2"
          role="status"
        >
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> 기존 작품을
          불러오는 중…
        </div>
      )}

      {workId && hydrationStatus === "error" && (
        <div
          className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-3 py-3"
          role="alert"
        >
          <p className="text-sm font-semibold text-fg">기존 작품을 열지 못했어요</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-2">
            {hydrationError ?? "작품을 다시 불러와 주세요."}
          </p>
          {dirty && (
            <p className="mt-2 text-xs leading-relaxed text-warn">
              화면의 미저장 변경은 보존되어 있습니다. 다시 불러오면 서버 원고로 교체됩니다.
            </p>
          )}
          <button
            className={buttonClass({
              size: "sm",
              variant: "outline",
              className: "mt-3 min-h-11 gap-1.5",
            })}
            disabled={!loggedIn || saving}
            type="button"
            onClick={() => {
              void (async () => {
                if (
                  dirty &&
                  !(await confirmStudioDestructiveAction(
                    studioDiscardLocalChangesRequest()
                  ))
                ) {
                  return;
                }
                setHydrationAttempt((attempt) => attempt + 1);
              })();
            }}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {dirty ? "로컬 변경 버리고 다시 불러오기" : "다시 시도"}
          </button>
        </div>
      )}

      {workId && hydrationStatus === "ready" && sharedMeta && !sharedCanEdit && (
        <div
          className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-3 py-3 text-sm"
          role="note"
        >
          <p className="font-semibold text-fg">읽기 전용 공동 원고입니다</p>
          <p className="mt-1 leading-relaxed text-fg-2">
            {sharedMeta.role === "commenter" ? "검토자" : "열람자"} 권한으로 원고를 볼 수
            있지만 이미지·작품 정보·서버 원본은 변경할 수 없습니다.
          </p>
        </div>
      )}

      {workId && hydrationStatus === "ready" && sharedCanEdit && !sharedCanPublish && (
        <div className="mb-4 rounded-xl border border-line bg-card/60 px-3 py-2 text-sm text-fg-2" role="note">
          공동 편집 변경 사항은 저장할 수 있습니다. 공개·비공개 상태와 연결 작품은 소유자만
          변경할 수 있습니다.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-line bg-panel/35 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-fg">이미지 ({pages.length})</h2>
            <label
              aria-disabled={mutationLocked}
              className={cn(
                buttonClass({
                  size: "sm",
                  variant: "solid",
                  className:
                    "cursor-pointer gap-1.5 focus-within:ring-2 focus-within:ring-accent/80 focus-within:ring-offset-2 focus-within:ring-offset-canvas pointer-coarse:h-11 pointer-coarse:min-h-11",
                }),
                mutationLocked && "pointer-events-none cursor-not-allowed opacity-70"
              )}
            >
              {loadingFiles ? (
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
              ) : (
                <ImagePlus size={14} />
              )}
              이미지 추가
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                onChange={onPickImages}
                disabled={mutationLocked}
              />
            </label>
          </div>

          {pages.length === 0 ? (
            <label
              aria-disabled={mutationLocked}
              className={cn(
                "mt-4 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-card/40 px-6 py-10 text-center transition-colors hover:border-accent/45 hover:bg-card/60 focus-within:outline-none focus-within:ring-2 focus-within:ring-accent/80 focus-within:ring-offset-2 focus-within:ring-offset-canvas",
                mutationLocked && "pointer-events-none cursor-not-allowed opacity-60"
              )}
            >
              <Upload size={28} className="mb-3 text-fg-3" />
              <p className="text-sm font-medium text-fg">이미지를 끌어다 놓거나 탭해서 선택</p>
              <p className="mt-1 text-xs text-fg-3">PNG, JPG, WebP · 최대 {MAX_PAGES}장</p>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                disabled={mutationLocked}
                onChange={onPickImages}
              />
            </label>
          ) : (
            <div className={STUDIO_UPLOAD_PAGE_LIST_CLASS}>
              {pages.map((page, index) => (
                <div
                  key={page.id}
                  className={STUDIO_UPLOAD_PAGE_ROW_CLASS}
                >
                  <span className="numeral w-6 shrink-0 text-center text-xs font-bold text-fg-3">{index + 1}</span>
                  <div className="relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded-lg bg-raised/50 sm:w-20">
                    <img src={page.src} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{page.name}</p>
                    <p className="text-[0.72rem] text-fg-3">
                      <span className="numeral">{page.width}</span>×<span className="numeral">{page.height}</span>
                    </p>
                  </div>
                  <div className={STUDIO_UPLOAD_PAGE_CONTROLS_CLASS}>
                    <button
                      type="button"
                      onClick={() => movePage(page.id, -1)}
                      disabled={mutationLocked || index === 0}
                      className={cn(
                        STUDIO_UPLOAD_PAGE_CONTROL_CLASS,
                        "text-fg-3 hover:bg-raised focus-visible:outline-accent"
                      )}
                      aria-label="위로 이동"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePage(page.id, 1)}
                      disabled={mutationLocked || index === pages.length - 1}
                      className={cn(
                        STUDIO_UPLOAD_PAGE_CONTROL_CLASS,
                        "text-fg-3 hover:bg-raised focus-visible:outline-accent"
                      )}
                      aria-label="아래로 이동"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePage(page.id)}
                      disabled={mutationLocked}
                      className={cn(
                        STUDIO_UPLOAD_PAGE_CONTROL_CLASS,
                        "text-bad hover:bg-bad/10 focus-visible:outline-bad"
                      )}
                      aria-label="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-panel/35 p-4">
            <h2 className="text-sm font-bold text-fg">작품 정보</h2>
            <label className="mt-3 flex flex-col gap-1 text-xs text-fg-2">
              제목
              <input
                disabled={mutationLocked}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setDirty(true);
                  setSuccessMessage(null);
                }}
                placeholder="작품 제목"
                className="h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-fg outline-none focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:h-11"
              />
            </label>
            <label className="mt-3 flex flex-col gap-1 text-xs text-fg-2">
              설명
              <textarea
                disabled={mutationLocked}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setDirty(true);
                  setSuccessMessage(null);
                }}
                rows={4}
                placeholder="작품 소개 (선택)"
                className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label className="mt-3 flex flex-col gap-1 text-xs text-fg-2">
              태그
              <input
                disabled={mutationLocked}
                value={tagsText}
                onChange={(event) => {
                  setTagsText(event.target.value);
                  setDirty(true);
                  setSuccessMessage(null);
                }}
                placeholder="로맨스, 일상 (쉼표로 구분)"
                className="h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-fg outline-none focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:h-11"
              />
            </label>
          </div>

          <div className={STUDIO_UPLOAD_ACTION_DOCK_CLASS}>
            <button
              type="button"
              onClick={() => handlePublish("draft")}
              disabled={mutationLocked}
              className={buttonClass({
                size: "md",
                variant: "outline",
                className: "w-full pointer-coarse:h-11 pointer-coarse:min-h-11",
              })}
            >
              {workId && sharedMeta?.role !== "owner" ? "공동 변경사항 저장" : workId ? "초안으로 저장" : "임시저장"}
            </button>
            <button
              type="button"
              onClick={() => handlePublish("published")}
              disabled={publishLocked}
              title={workId && !sharedCanPublish ? "게시 상태는 작품 소유자만 변경할 수 있습니다." : undefined}
              className={buttonClass({
                size: "md",
                variant: "solid",
                className: "w-full gap-1.5 pointer-coarse:h-11 pointer-coarse:min-h-11",
              })}
            >
              {saving ? (
                <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Send size={15} />
              )}
              {workId && !sharedCanPublish ? "소유자만 게시 가능" : workId ? "수정사항 게시" : "게시하기"}
            </button>
          </div>
        </aside>
      </div>
    </Container>
  );
}
