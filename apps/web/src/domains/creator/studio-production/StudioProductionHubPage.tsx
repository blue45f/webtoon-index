import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileClock,
  FolderKanban,
  Link2,
  MessageSquareCheck,
  Plus,
  Presentation,
  Radio,
  RotateCcw,
  Save,
  Share2,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  resolveStudioProductionScope,
  type StudioProductionScope as ProductionScope,
} from "./studio-production-scope";
import { StudioPitchPptxCard } from "./StudioPitchPptxCard";
import { StudioServerVersionsCard } from "./StudioServerVersionsCard";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

const STUDIO_PRODUCTION_SURFACES = [
  "projects",
  "review",
  "versions",
  "present",
  "share",
  "join",
] as const;

export type StudioProductionSurface = (typeof STUDIO_PRODUCTION_SURFACES)[number];

type TaskStatus = "todo" | "doing" | "blocked" | "done";
type ReviewSeverity = "blocker" | "major" | "minor";
type ReviewStatus = "open" | "resolved";
type PersistenceState = "loading" | "saved" | "memory" | "saving";

interface ProductionTask {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
  readonly due: string;
  readonly progress: number;
  readonly status: TaskStatus;
}

interface ReviewIssue {
  readonly id: string;
  readonly title: string;
  readonly assignee: string;
  readonly severity: ReviewSeverity;
  readonly status: ReviewStatus;
}

interface VersionSnapshot {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly tasks: readonly ProductionTask[];
  readonly reviews: readonly ReviewIssue[];
}

interface PitchSlide {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

interface ProductionWorkspace {
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly tasks: readonly ProductionTask[];
  readonly reviews: readonly ReviewIssue[];
  readonly versions: readonly VersionSnapshot[];
  readonly slides: readonly PitchSlide[];
  readonly members: readonly string[];
  readonly inviteToken: string;
}


const NAMESPACE = "studio-production-command-center-v1";
const FALLBACK_NOW = "2026-09-05T00:00:00.000Z";
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});
let fallbackSequence = 0;

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12);
  if (random) return `${prefix}-${random}`;
  fallbackSequence += 1;
  return `${prefix}-${fallbackSequence.toString(36)}`;
}

function stableToken(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `ts-${Math.abs(hash >>> 0).toString(36)}`;
}


function surfaceHref(surface: StudioProductionSurface, scope: ProductionScope): string {
  const scopedSurface = surface === "review" || surface === "versions" || surface === "present";
  if (scopedSurface && scope.key.startsWith("work:")) {
    return `/studio/work/${encodeURIComponent(scope.key.slice(5))}/${surface}`;
  }
  if (scopedSurface && scope.key.startsWith("remix:")) {
    return `/studio/remix/${encodeURIComponent(scope.key.slice(6))}/${surface}`;
  }
  const search = scope.key === "draft" ? "" : `?scope=${encodeURIComponent(scope.key)}`;
  return `/studio/${surface}${search}`;
}

function initialWorkspace(scopeKey: string): ProductionWorkspace {
  return {
    schemaVersion: 1,
    scopeKey,
    title: scopeKey === "draft"
      ? "새 웹툰 제작 프로젝트"
      : `${scopeKey.replace(":", " ")} 제작 운영`,
    updatedAt: FALLBACK_NOW,
    inviteToken: stableToken(scopeKey),
    members: ["디렉터", "작가", "편집자"],
    tasks: [
      {
        id: "task-story",
        title: "콘티와 대사 확정",
        owner: "작가",
        due: "2026-09-08",
        progress: 100,
        status: "done",
      },
      {
        id: "task-line",
        title: "선화·톤 작업",
        owner: "작가",
        due: "2026-09-10",
        progress: 68,
        status: "doing",
      },
      {
        id: "task-review",
        title: "연출·가독성 검수",
        owner: "편집자",
        due: "2026-09-11",
        progress: 35,
        status: "blocked",
      },
      {
        id: "task-release",
        title: "플랫폼 규격 내보내기",
        owner: "디렉터",
        due: "2026-09-12",
        progress: 0,
        status: "todo",
      },
    ],
    reviews: [
      {
        id: "review-continuity",
        title: "3컷 시선 방향 불일치",
        assignee: "작가",
        severity: "blocker",
        status: "open",
      },
      {
        id: "review-balloon",
        title: "말풍선 안전 영역 확인",
        assignee: "편집자",
        severity: "major",
        status: "open",
      },
      {
        id: "review-color",
        title: "야간 장면 색온도 통일",
        assignee: "작가",
        severity: "minor",
        status: "resolved",
      },
    ],
    versions: [],
    slides: [
      {
        id: "slide-concept",
        title: "작품 한 문장",
        body: "독자가 첫 세 컷 안에 세계와 갈등을 이해하는 연재형 웹툰.",
      },
      {
        id: "slide-character",
        title: "주요 캐릭터",
        body: "욕망·결핍·관계 변화를 장면 단위 제작 지표와 연결합니다.",
      },
      {
        id: "slide-release",
        title: "출시 계획",
        body: "검수 게이트를 통과한 버전만 플랫폼 규격으로 전달합니다.",
      },
    ],
  };
}

function parseWorkspace(raw: string | null, scopeKey: string): ProductionWorkspace | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<ProductionWorkspace>;
    if (
      value.schemaVersion !== 1
      || value.scopeKey !== scopeKey
      || !Array.isArray(value.tasks)
      || !Array.isArray(value.reviews)
      || !Array.isArray(value.versions)
      || !Array.isArray(value.slides)
      || !Array.isArray(value.members)
    ) {
      return null;
    }
    return value as ProductionWorkspace;
  } catch {
    return null;
  }
}

async function loadWorkspace(scopeKey: string): Promise<ProductionWorkspace | null> {
  const { acquireStudioLocalDatabase } = await import("../studio-local-database-runtime");
  const database = await acquireStudioLocalDatabase();
  return parseWorkspace(await database.kvGet(NAMESPACE, scopeKey), scopeKey);
}

async function saveWorkspace(workspace: ProductionWorkspace): Promise<void> {
  const { acquireStudioLocalDatabase } = await import("../studio-local-database-runtime");
  const database = await acquireStudioLocalDatabase();
  await database.kvSet(NAMESPACE, workspace.scopeKey, JSON.stringify(workspace));
}

function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: "neutral" | "success" | "warning" | "danger";
}) {
  let toneClass = "border-line bg-panel";
  if (tone === "success") toneClass = "border-emerald-500/30 bg-emerald-500/10";
  if (tone === "warning") toneClass = "border-amber-500/30 bg-amber-500/10";
  if (tone === "danger") toneClass = "border-red-500/30 bg-red-500/10";
  return (
    <div className={cn("rounded-2xl border p-3.5", toneClass)}>
      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-fg-3">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-fg">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-2">{detail}</p>
    </div>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  let toneClass = "border-line bg-raised text-fg-2";
  if (tone === "success") {
    toneClass = "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "warning") {
    toneClass = "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (tone === "danger") {
    toneClass = "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (tone === "accent") toneClass = "border-accent/30 bg-accent-soft text-accent";
  return (
    <span className={cn(
      "inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold",
      toneClass,
    )}>
      {children}
    </span>
  );
}

function Card({
  title,
  description,
  children,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-fg">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-fg-2">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const SURFACE_META: Readonly<
  Record<StudioProductionSurface, { readonly label: string; readonly icon: typeof FolderKanban }>
> = {
  projects: { label: "프로젝트", icon: FolderKanban },
  review: { label: "리뷰", icon: MessageSquareCheck },
  versions: { label: "버전", icon: FileClock },
  present: { label: "피치", icon: Presentation },
  share: { label: "공유", icon: Share2 },
  join: { label: "참여", icon: Users },
};

function taskTone(status: TaskStatus): "neutral" | "success" | "danger" | "accent" {
  if (status === "done") return "success";
  if (status === "blocked") return "danger";
  if (status === "doing") return "accent";
  return "neutral";
}

function reviewTone(severity: ReviewSeverity): "neutral" | "warning" | "danger" {
  if (severity === "blocker") return "danger";
  if (severity === "major") return "warning";
  return "neutral";
}

export function StudioProductionHubPage({
  surface,
  onOpenStudio,
}: {
  readonly surface: StudioProductionSurface;
  readonly onOpenStudio: () => void;
}) {
  const location = useLocation();
  const resolution = resolveStudioProductionScope(location);
  if (!resolution.valid) {
    return (
      <section className="m-4 rounded-xl border border-line p-4" role="alert">
        <h1 className="font-bold">프로젝트 범위를 확인할 수 없습니다</h1>
        <p className="my-3 text-sm">잘못되거나 서로 충돌하는 작품 정보입니다. 저장된 내용은 변경하지 않았습니다.</p>
        <button type="button" className={buttonClass()} onClick={onOpenStudio}>
          Studio 편집기로 돌아가기
        </button>
      </section>
    );
  }
  return (
    <StudioProductionHubWorkspace
      key={resolution.scope.key}
      surface={surface}
      scope={resolution.scope}
      onOpenStudio={onOpenStudio}
    />
  );
}

function StudioProductionHubWorkspace({ surface, scope, onOpenStudio }: {
  readonly surface: StudioProductionSurface;
  readonly scope: ProductionScope;
  readonly onOpenStudio: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const initial = useMemo(() => initialWorkspace(scope.key), [scope.key]);
  const [workspace, setWorkspace] = useState<ProductionWorkspace>(initial);
  const [persistence, setPersistence] = useState<PersistenceState>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const workspaceRef = useRef(workspace);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const inviteToken = useMemo(
    () => new URLSearchParams(location.search).get("invite"),
    [location.search],
  );

  const adoptWorkspace = useCallback((next: ProductionWorkspace) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  useEffect(() => {
    let active = true;
    setPersistence("loading");
    adoptWorkspace(initial);
    void loadWorkspace(scope.key)
      .then((loaded) => {
        if (!active) return;
        adoptWorkspace(loaded ?? initial);
        setPersistence("saved");
      })
      .catch(() => {
        if (!active) return;
        adoptWorkspace(initial);
        setPersistence("memory");
      });
    return () => {
      active = false;
    };
  }, [adoptWorkspace, initial, scope.key]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      const channel = new BroadcastChannel(`${NAMESPACE}:${scope.key}`);
      channel.onmessage = (event: MessageEvent<ProductionWorkspace>) => {
        if (event.data?.schemaVersion === 1 && event.data.scopeKey === scope.key) {
          adoptWorkspace(event.data);
        }
      };
      channelRef.current = channel;
      return () => {
        channel.close();
        channelRef.current = null;
      };
    } catch {
      channelRef.current = null;
    }
  }, [adoptWorkspace, scope.key]);

  const commit = useCallback((
    updater: (current: ProductionWorkspace) => ProductionWorkspace,
    message: string,
  ) => {
    const next = {
      ...updater(workspaceRef.current),
      updatedAt: new Date().toISOString(),
    };
    adoptWorkspace(next);
    setPersistence("saving");
    setNotice(message);
    channelRef.current?.postMessage(next);
    void saveWorkspace(next)
      .then(() => setPersistence("saved"))
      .catch(() => setPersistence("memory"));
  }, [adoptWorkspace]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const next = STUDIO_PRODUCTION_SURFACES[Number(event.key) - 1];
      if (!next) return;
      event.preventDefault();
      void navigate(surfaceHref(next, scope));
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [navigate, scope]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${SURFACE_META[surface].label} · ${workspace.title} · Toon Studio`;
    return () => {
      document.title = previous;
    };
  }, [surface, workspace.title]);

  const completed = workspace.tasks.filter((task) => task.status === "done").length;
  const blocked = workspace.tasks.filter((task) => task.status === "blocked").length;
  const openBlockers = workspace.reviews.filter(
    (issue) => issue.status === "open" && issue.severity === "blocker",
  ).length;
  const openMajor = workspace.reviews.filter(
    (issue) => issue.status === "open" && issue.severity === "major",
  ).length;
  const releaseReady = openBlockers === 0 && openMajor === 0 && blocked === 0;
  const progress = Math.round(
    workspace.tasks.reduce((sum, task) => sum + task.progress, 0)
      / Math.max(1, workspace.tasks.length),
  );

  const addTask = () => commit((current) => ({
    ...current,
    tasks: [
      ...current.tasks,
      {
        id: createId("task"),
        title: "새 제작 작업",
        owner: "미배정",
        due: new Date().toISOString().slice(0, 10),
        progress: 0,
        status: "todo",
      },
    ],
  }), "새 제작 작업을 추가했습니다.");

  const toggleTask = (id: string) => commit((current) => ({
    ...current,
    tasks: current.tasks.map((task) => {
      if (task.id !== id) return task;
      return task.status === "done"
        ? { ...task, status: "doing", progress: Math.min(task.progress, 90) }
        : { ...task, status: "done", progress: 100 };
    }),
  }), "작업 상태를 갱신했습니다.");

  const createSnapshot = () => commit((current) => ({
    ...current,
    versions: [
      {
        id: createId("version"),
        name: `체크포인트 ${current.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        tasks: current.tasks,
        reviews: current.reviews,
      },
      ...current.versions,
    ],
  }), "복구 가능한 체크포인트를 저장했습니다.");

  const restoreSnapshot = (version: VersionSnapshot) => commit((current) => ({
    ...current,
    tasks: version.tasks,
    reviews: version.reviews,
  }), `${version.name} 상태로 복원했습니다.`);

  const copyInvite = async () => {
    const invite = `${globalThis.location.origin}/studio/join?invite=${encodeURIComponent(
      workspace.inviteToken,
    )}&scope=${encodeURIComponent(scope.key)}`;
    try {
      await navigator.clipboard.writeText(invite);
      setNotice("참여 링크를 복사했습니다.");
    } catch {
      setNotice(invite);
    }
  };

  return (
    <div
      className="min-h-dvh bg-bg text-fg"
      data-studio-production-command-center
      data-scope-key={scope.key}
    >
      <header className="sticky top-0 z-40 border-b border-line bg-bg/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-3 px-3 py-2 sm:px-5">
          <button
            type="button"
            className={buttonClass({ variant: "quiet", size: "icon" })}
            onClick={onOpenStudio}
            aria-label="Studio 편집기로 돌아가기"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Radio className="size-4 text-accent" aria-hidden="true" />
              <h1 className="text-[0.6875rem] font-black uppercase tracking-[0.16em] text-fg-3">
                Local production planner · {SURFACE_META[surface].label}
              </h1>
              <Pill tone={releaseReady ? "success" : "warning"}>
                {releaseReady ? "출시 가능" : "검수 필요"}
              </Pill>
            </div>
            <input
              key={`${workspace.scopeKey}:${workspace.title}`}
              defaultValue={workspace.title}
              aria-label="프로젝트 제목"
              className="mt-0.5 min-h-11 w-full max-w-3xl bg-transparent text-base font-black tracking-tight outline-none sm:text-lg"
              onBlur={(event) => {
                const title = event.currentTarget.value.trim();
                if (!title || title === workspaceRef.current.title) return;
                commit((current) => ({ ...current, title }), "프로젝트 제목을 변경했습니다.");
              }}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-fg-2" role="status">
            <Save className="size-4" aria-hidden="true" />
            {persistence === "saved" ? "SQLite/OPFS 저장됨" : null}
            {persistence === "saving" ? "저장 중" : null}
            {persistence === "memory" ? "세션 메모리" : null}
            {persistence === "loading" ? "불러오는 중" : null}
          </div>
          <Link
            href={scope.editorHref}
            className={buttonClass({ variant: "outline", size: "sm" })}
          >
            원고 열기
          </Link>
        </div>
        <nav
          className="mx-auto max-w-[1920px] overflow-x-auto px-3 pb-2 sm:px-5"
          aria-label="제작 운영 기능"
        >
          <div className="flex min-w-max gap-1">
            {STUDIO_PRODUCTION_SURFACES.map((item, index) => {
              const meta = SURFACE_META[item];
              const Icon = meta.icon;
              const active = item === surface;
              return (
                <Link
                  key={item}
                  href={surfaceHref(item, scope)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors pointer-coarse:min-h-11",
                    active
                      ? "bg-accent text-on-accent"
                      : "text-fg-2 hover:bg-raised hover:text-fg",
                  )}
                  title={`${meta.label} · Alt+${index + 1}`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {meta.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-[1920px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
        {notice ? (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-fg"
            role="status"
          >
            <span>{notice}</span>
            <button
              type="button"
              className="font-semibold text-accent"
              onClick={() => setNotice(null)}
            >
              닫기
            </button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="제작 진척"
            value={`${progress}%`}
            detail={`${completed}/${workspace.tasks.length} 작업 완료`}
            tone={completed === workspace.tasks.length ? "success" : "neutral"}
          />
          <Metric
            label="차단 작업"
            value={`${blocked}건`}
            detail="다음 공정을 막는 작업"
            tone={blocked > 0 ? "danger" : "success"}
          />
          <Metric
            label="미해결 검수"
            value={`${openBlockers + openMajor}건`}
            detail={`Blocker ${openBlockers} · Major ${openMajor}`}
            tone={openBlockers > 0 ? "danger" : openMajor > 0 ? "warning" : "success"}
          />
          <Metric
            label="로컬 담당자"
            value={`${workspace.members.length}명`}
            detail={scope.label}
          />
        </div>

        {surface === "projects" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Card
              title="제작 보드"
              description="작업 상태와 진척을 한 곳에서 관리합니다."
              action={(
                <button type="button" className={buttonClass({ size: "sm" })} onClick={addTask}>
                  <Plus className="size-4" aria-hidden="true" />
                  작업 추가
                </button>
              )}
            >
              <div className="space-y-2">
                {workspace.tasks.map((task) => (
                  <article key={task.id} className="rounded-xl border border-line bg-panel p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold">{task.title}</h3>
                          <Pill tone={taskTone(task.status)}>{task.status}</Pill>
                        </div>
                        <p className="mt-1 text-xs text-fg-2">{task.owner} · 마감 {task.due}</p>
                      </div>
                      <button
                        type="button"
                        className={buttonClass({ variant: "outline", size: "sm" })}
                        onClick={() => toggleTask(task.id)}
                      >
                        {task.status === "done" ? (
                          <RotateCcw className="size-4" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                        )}
                        {task.status === "done" ? "재개" : "완료"}
                      </button>
                    </div>
                    <div
                      className="mt-3 h-2 overflow-hidden rounded-full bg-raised"
                      role="progressbar"
                      aria-valuenow={task.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </Card>
            <Card title="출시 게이트" description="차단 작업과 중요 검수가 모두 닫혀야 합니다.">
              <div className={cn(
                "rounded-2xl border p-4 text-center",
                releaseReady
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-amber-500/30 bg-amber-500/10",
              )}>
                {releaseReady ? (
                  <ShieldCheck className="mx-auto size-9 text-emerald-600" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mx-auto size-9 text-amber-600" aria-hidden="true" />
                )}
                <p className="mt-2 text-sm font-black">
                  {releaseReady ? "출시 준비 완료" : "검수 조치 필요"}
                </p>
                <p className="mt-1 text-xs text-fg-2">
                  차단 작업 {blocked} · 중요 검수 {openBlockers + openMajor}
                </p>
              </div>
            </Card>
          </div>
        ) : null}

        {surface === "review" ? (
          <Card
            title="리뷰 및 승인"
            description="중요도와 담당자를 기준으로 출시 차단 요소를 정리합니다."
          >
            <div className="space-y-2">
              {workspace.reviews.map((issue) => (
                <article
                  key={issue.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel p-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold">{issue.title}</h3>
                      <Pill tone={reviewTone(issue.severity)}>{issue.severity}</Pill>
                      <Pill tone={issue.status === "resolved" ? "success" : "accent"}>
                        {issue.status}
                      </Pill>
                    </div>
                    <p className="mt-1 text-xs text-fg-2">담당 {issue.assignee}</p>
                  </div>
                  <button
                    type="button"
                    className={buttonClass({ variant: "outline", size: "sm" })}
                    onClick={() => commit((current) => ({
                      ...current,
                      reviews: current.reviews.map((item) => item.id === issue.id
                        ? { ...item, status: item.status === "open" ? "resolved" : "open" }
                        : item),
                    }), "리뷰 상태를 갱신했습니다.")}
                  >
                    {issue.status === "open" ? "해결 처리" : "다시 열기"}
                  </button>
                </article>
              ))}
            </div>
          </Card>
        ) : null}

        {surface === "versions" ? (
          <Card
            title="작업·검수 체크포인트"
            description="로컬 작업·검수 목록만 저장·복원합니다. 원고의 컷·레이어와 서버 버전은 포함하지 않습니다."
            action={(
              <button
                type="button"
                className={buttonClass({ size: "sm" })}
                onClick={createSnapshot}
              >
                <FileClock className="size-4" aria-hidden="true" />
                체크포인트
              </button>
            )}
          >
            <div className="space-y-2">
              {workspace.versions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-2">
                  아직 저장된 체크포인트가 없습니다.
                </div>
              ) : workspace.versions.map((version) => (
                <article
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel p-3"
                >
                  <div>
                    <h3 className="text-sm font-bold">{version.name}</h3>
                    <p className="mt-1 text-xs text-fg-2">
                      {DATE_TIME_FORMATTER.format(new Date(version.createdAt))}
                      {` · 작업 ${version.tasks.length} · 검수 ${version.reviews.length}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={buttonClass({ variant: "outline", size: "sm" })}
                    onClick={() => restoreSnapshot(version)}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    복원
                  </button>
                </article>
              ))}
            </div>
          </Card>
        ) : null}

        {surface === "versions" ? (
          <StudioServerVersionsCard scopeKey={scope.key} />
        ) : null}

        {surface === "present" ? (
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Card title="피치 슬라이드" description="핵심 메시지를 순서대로 구성합니다.">
              <div className="space-y-2">
                {workspace.slides.map((slide, index) => (
                  <button
                    key={slide.id}
                    type="button"
                    className="w-full rounded-xl border border-line bg-panel p-3 text-left hover:border-accent"
                    onClick={() => setNotice(`${index + 1}. ${slide.title}: ${slide.body}`)}
                  >
                    <span className="text-[0.6875rem] font-bold text-fg-3">SLIDE {index + 1}</span>
                    <span className="mt-1 block text-sm font-bold">{slide.title}</span>
                  </button>
                ))}
              </div>
            </Card>
            <Card title="발표 미리보기" description="공유 전에 메시지 밀도와 순서를 확인합니다.">
              <div className="aspect-video rounded-2xl border border-line bg-panel p-[clamp(2rem,6vw,7rem)]">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-accent">
                  {workspace.title}
                </p>
                <h2 className="mt-6 max-w-[20ch] text-balance text-[clamp(2rem,5vw,5rem)] font-black leading-[1.02] tracking-[-0.05em]">
                  {workspace.slides[0]?.title}
                </h2>
                <p className="mt-5 max-w-[52ch] text-[clamp(0.9rem,1.5vw,1.5rem)] leading-relaxed text-fg-2">
                  {workspace.slides[0]?.body}
                </p>
              </div>
            </Card>
          </div>
        ) : null}

        {surface === "present" ? (
          <StudioPitchPptxCard
            title={workspace.title}
            slides={workspace.slides}
            onNotice={setNotice}
            onAddSlide={() => commit((current) => ({
              ...current,
              slides: [...current.slides, {
                id: createId("slide"),
                title: `새 슬라이드 ${current.slides.length + 1}`,
                body: "핵심 메시지를 입력하세요.",
              }],
            }), "피치 슬라이드를 추가했습니다.")}
            onChangeSlide={(id, patch) => commit((current) => ({
              ...current,
              slides: current.slides.map((slide) => slide.id === id ? { ...slide, ...patch } : slide),
            }), "피치 슬라이드를 수정했습니다.")}
          />
        ) : null}

        {surface === "share" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card
              title="안전한 프로젝트 공유"
              description="역할·승인·워터마크 정책을 유지하는 범위형 초대 링크입니다."
            >
              <label className="block text-xs font-semibold text-fg">
                초대 토큰
                <input
                  readOnly
                  value={workspace.inviteToken}
                  className="mt-2 min-h-11 w-full rounded-xl border border-line bg-panel px-3 font-mono text-sm"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={buttonClass()} onClick={() => void copyInvite()}>
                  <Copy className="size-4" aria-hidden="true" />
                  링크 복사
                </button>
                <button
                  type="button"
                  className={buttonClass({ variant: "outline" })}
                  onClick={() => commit((current) => ({
                    ...current,
                    inviteToken: `ts-${createId("invite")}`,
                  }), "기존 링크를 폐기하고 새 초대를 발급했습니다.")}
                >
                  <Link2 className="size-4" aria-hidden="true" />
                  링크 재발급
                </button>
              </div>
            </Card>
            <Card title="공유 정책">
              <ul className="space-y-2 text-xs text-fg-2">
                <li>초대 범위: {scope.label}</li>
                <li>기본 권한: 리뷰어</li>
                <li>다운로드: 비활성</li>
                <li>워터마크: 활성</li>
                <li>참여 승인: 필요</li>
              </ul>
            </Card>
          </div>
        ) : null}

        {surface === "join" ? (
          <Card
            title="공동 제작 참여"
            description="초대 링크를 검증한 뒤 현재 제작 운영 공간에 참여합니다."
          >
            <div className="mx-auto max-w-xl rounded-2xl border border-line bg-panel p-5 text-center">
              <Users className="mx-auto size-10 text-accent" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-black">
                {inviteToken ? "초대 링크가 확인되었습니다" : "초대 링크가 필요합니다"}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-2">
                {inviteToken
                  ? `${scope.label} 공간에 리뷰어 권한으로 참여 요청을 보냅니다.`
                  : "프로젝트 소유자가 발급한 /studio/join 링크로 다시 열어 주세요."}
              </p>
              <button
                type="button"
                className={cn(buttonClass(), "mt-5")}
                disabled={!inviteToken}
                onClick={() => {
                  const name = `참여자 ${workspaceRef.current.members.length + 1}`;
                  commit((current) => ({
                    ...current,
                    members: current.members.includes(name)
                      ? current.members
                      : [...current.members, name],
                  }), "참여 요청을 등록했습니다.");
                }}
              >
                참여 요청
              </button>
            </div>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
