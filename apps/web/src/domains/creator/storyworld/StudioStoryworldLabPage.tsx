import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Download,
  FileJson,
  FlaskConical,
  GitBranch,
  Import,
  Info,
  Network,
  RefreshCcw,
  Save,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Users,
  WandSparkles,
  XCircle,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { storyworldDraftStore } from "./draft-store";
import {
  STORYWORLD_CAPABILITIES,
  STORYWORLD_CAPABILITY_GROUPS,
  storyworldCapabilitiesByGroup,
  storyworldCapabilityCounts,
  type StoryworldCapabilityGroup,
  type StoryworldCapabilityMaturity,
} from "./studio-storyworld-catalog";
import {
  STORYWORLD_DEMO_PROJECT,
  STUDIO_STORYWORLD_SCHEMA_VERSION,
  analyzeStoryworldProject,
  rankStoryworldParetoFrontier,
  simulateStoryworldCounterfactual,
  type StoryworldAnalysisResult,
  type StoryworldAxisId,
  type StoryworldBranchMutation,
  type StoryworldIssue,
  type StoryworldProject,
  type StoryworldSeverity,
} from "./studio-storyworld-causality";
import "./studio-storyworld-lab.css";

import Link from "@/src/compat/router-link";
import { useDocumentTitle } from "@/src/hooks/use-document-title";

export interface StudioStoryworldLabPageProps {
  readonly workId: string | null;
  readonly remixSourceWorkId: string | null;
}

type StoryworldTab =
  | "overview"
  | "issues"
  | "multiverse"
  | "knowledge"
  | "contracts"
  | "capabilities"
  | "json";

type SaveState = "idle" | "saved" | "error";


const TAB_ITEMS: readonly {
  readonly id: StoryworldTab;
  readonly label: string;
  readonly icon: typeof Network;
}[] = [
  { id: "overview", label: "대시보드", icon: Network },
  { id: "issues", label: "모순·위험", icon: AlertTriangle },
  { id: "multiverse", label: "멀티버스", icon: GitBranch },
  { id: "knowledge", label: "인물 지식", icon: Users },
  { id: "contracts", label: "서사 계약", icon: BookOpenCheck },
  { id: "capabilities", label: "창의 기능 지도", icon: Sparkles },
  { id: "json", label: "원본 데이터", icon: FileJson },
];

const AXIS_LABELS: Readonly<Record<StoryworldAxisId, string>> = {
  canon: "캐논",
  "character-knowledge": "인물 지식",
  "setup-payoff": "복선·회수",
  "spoiler-safety": "스포일러",
  "emotional-continuity": "감정 연속성",
  production: "제작",
  localization: "현지화",
  accessibility: "접근성",
  "rights-provenance": "권리·출처",
};

const SEVERITY_LABELS: Readonly<Record<StoryworldSeverity, string>> = {
  error: "오류",
  warning: "경고",
  info: "확인",
};

const MATURITY_LABELS: Readonly<Record<StoryworldCapabilityMaturity, string>> = {
  engine: "엔진 포함",
  adapter: "연계 설계",
  experimental: "실험실",
};

function cloneDemoProject(): StoryworldProject {
  return JSON.parse(JSON.stringify(STORYWORLD_DEMO_PROJECT)) as StoryworldProject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path}는 비어 있지 않은 문자열이어야 합니다.`);
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}는 유한한 숫자여야 합니다.`);
  }
}

function assertOptionalStringArray(record: Record<string, unknown>, key: string, path: string): void {
  const value = record[key];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${path}.${key}는 문자열 배열이어야 합니다.`);
  }
}

function assertOptionalRecordArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  validate: (item: Record<string, unknown>, itemPath: string) => void,
): void {
  const value = record[key];
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${path}.${key}는 배열이어야 합니다.`);
  value.forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`${path}.${key}[${index}]는 객체여야 합니다.`);
    validate(item, `${path}.${key}[${index}]`);
  });
}

function assertOptionalFiniteNumber(record: Record<string, unknown>, key: string, path: string): void {
  if (record[key] !== undefined) assertFiniteNumber(record[key], `${path}.${key}`);
}

function assertStoryworldCharacter(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path}는 객체여야 합니다.`);
  assertString(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`);
  assertOptionalStringArray(value, "initialFactIds", path);
  assertOptionalStringArray(value, "secretFactIds", path);
}

function assertStoryworldFact(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path}는 객체여야 합니다.`);
  assertString(value.id, `${path}.id`);
  assertString(value.label, `${path}.label`);
  assertString(value.subjectId, `${path}.subjectId`);
  assertString(value.key, `${path}.key`);
  assertOptionalFiniteNumber(value, "intendedReaderRevealOrder", path);
  assertOptionalStringArray(value, "tags", path);
}

function assertStoryworldScene(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path}는 객체여야 합니다.`);
  assertString(value.id, `${path}.id`);
  assertString(value.title, `${path}.title`);
  assertFiniteNumber(value.order, `${path}.order`);
  assertOptionalFiniteNumber(value, "timeIndex", path);
  assertOptionalStringArray(value, "participantIds", path);
  assertOptionalStringArray(value, "dependsOnSceneIds", path);
  assertOptionalStringArray(value, "setupIds", path);
  assertOptionalStringArray(value, "payoffIds", path);
  assertOptionalStringArray(value, "motifIds", path);

  assertOptionalRecordArray(value, "preconditions", path, (item, itemPath) => {
    assertString(item.factId, `${itemPath}.factId`);
    if (item.comparator !== undefined && ![
      "exists", "not-exists", "equals", "not-equals", "greater-than", "less-than",
    ].includes(String(item.comparator))) {
      throw new Error(`${itemPath}.comparator가 지원되지 않습니다.`);
    }
  });
  assertOptionalRecordArray(value, "effects", path, (item, itemPath) => {
    assertString(item.factId, `${itemPath}.factId`);
    if (!["set", "delete", "increment", "decrement"].includes(String(item.op))) {
      throw new Error(`${itemPath}.op가 지원되지 않습니다.`);
    }
  });
  assertOptionalRecordArray(value, "knowledgeUses", path, (item, itemPath) => {
    assertString(item.characterId, `${itemPath}.characterId`);
    assertString(item.factId, `${itemPath}.factId`);
  });
  assertOptionalRecordArray(value, "reveals", path, (item, itemPath) => {
    assertString(item.factId, `${itemPath}.factId`);
    if (!Array.isArray(item.audiences) || item.audiences.some((audience) =>
      typeof audience !== "string" || audience.length === 0
    )) {
      throw new Error(`${itemPath}.audiences는 문자열 배열이어야 합니다.`);
    }
  });
  assertOptionalRecordArray(value, "emotionalBeats", path, (item, itemPath) => {
    assertString(item.characterId, `${itemPath}.characterId`);
    assertFiniteNumber(item.valence, `${itemPath}.valence`);
    assertFiniteNumber(item.arousal, `${itemPath}.arousal`);
  });
  assertOptionalRecordArray(value, "localization", path, (item, itemPath) => {
    assertString(item.locale, `${itemPath}.locale`);
    assertFiniteNumber(item.sourceCharacters, `${itemPath}.sourceCharacters`);
    assertFiniteNumber(item.translatedCharacters, `${itemPath}.translatedCharacters`);
    assertFiniteNumber(item.balloonCapacityCharacters, `${itemPath}.balloonCapacityCharacters`);
  });
  assertOptionalRecordArray(value, "assets", path, (item, itemPath) => {
    assertString(item.assetId, `${itemPath}.assetId`);
    assertString(item.label, `${itemPath}.label`);
    if (!["cleared", "restricted", "unknown", "expired"].includes(String(item.licenseStatus))) {
      throw new Error(`${itemPath}.licenseStatus가 지원되지 않습니다.`);
    }
  });
  if (value.production !== undefined) {
    if (!isRecord(value.production)) throw new Error(`${path}.production은 객체여야 합니다.`);
    for (const key of [
      "drawingMinutes", "letteringMinutes", "renderMinutes", "reviewMinutes", "uniqueAssetCount", "complexity",
    ]) {
      assertOptionalFiniteNumber(value.production, key, `${path}.production`);
    }
    assertOptionalStringArray(value.production, "assigneeIds", `${path}.production`);
  }
  if (value.accessibility !== undefined && !isRecord(value.accessibility)) {
    throw new Error(`${path}.accessibility는 객체여야 합니다.`);
  }
}

function parseStoryworldProject(text: string): StoryworldProject {
  if (text.length > 1_000_000) throw new Error("스토리월드 JSON은 1MB 이하여야 합니다.");
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("최상위 값은 객체여야 합니다.");
  if (value.schemaVersion !== STUDIO_STORYWORLD_SCHEMA_VERSION) {
    throw new Error(`schemaVersion은 ${STUDIO_STORYWORLD_SCHEMA_VERSION}이어야 합니다.`);
  }
  assertString(value.id, "project.id");
  assertString(value.title, "project.title");
  if (!Array.isArray(value.characters) || !Array.isArray(value.facts) || !Array.isArray(value.scenes)) {
    throw new Error("characters, facts, scenes는 배열이어야 합니다.");
  }
  if (value.characters.length > 64 || value.facts.length > 512 || value.scenes.length > 256) {
    throw new Error("로컬 분석 한도는 인물 64명, 사실 512개, 장면 256개입니다.");
  }
  value.characters.forEach((item, index) => assertStoryworldCharacter(item, `characters[${index}]`));
  value.facts.forEach((item, index) => assertStoryworldFact(item, `facts[${index}]`));
  value.scenes.forEach((item, index) => assertStoryworldScene(item, `scenes[${index}]`));
  if (value.setupContracts !== undefined) {
    if (!Array.isArray(value.setupContracts)) throw new Error("setupContracts는 배열이어야 합니다.");
    value.setupContracts.forEach((item, index) => {
      const path = `setupContracts[${index}]`;
      if (!isRecord(item)) throw new Error(`${path}는 객체여야 합니다.`);
      assertString(item.id, `${path}.id`);
      assertString(item.label, `${path}.label`);
      assertOptionalFiniteNumber(item, "payoffDueByOrder", path);
      assertOptionalFiniteNumber(item, "requiredPayoffCount", path);
    });
  }
  if (value.motifs !== undefined) {
    if (!Array.isArray(value.motifs)) throw new Error("motifs는 배열이어야 합니다.");
    value.motifs.forEach((item, index) => {
      const path = `motifs[${index}]`;
      if (!isRecord(item)) throw new Error(`${path}는 객체여야 합니다.`);
      assertString(item.id, `${path}.id`);
      assertString(item.label, `${path}.label`);
      assertOptionalFiniteNumber(item, "minOccurrences", path);
      assertOptionalFiniteNumber(item, "maxGapScenes", path);
    });
  }
  assertOptionalFiniteNumber(value, "productionCapacityMinutes", "project");
  return value as unknown as StoryworldProject;
}

function projectStorageKey(workId: string | null, remixSourceWorkId: string | null): string {
  const scope = workId !== null
    ? `work:${workId}`
    : remixSourceWorkId !== null
      ? `remix:${remixSourceWorkId}`
      : "draft";
  return `toonspectrum:storyworld-lab:v1:${scope}`;
}

function editorHref(workId: string | null, remixSourceWorkId: string | null): string {
  if (workId !== null) return `/studio/work/${encodeURIComponent(workId)}/canvas`;
  if (remixSourceWorkId !== null) return `/studio/remix/${encodeURIComponent(remixSourceWorkId)}/canvas`;
  return "/studio";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatMinutes(value: number): string {
  if (value < 60) return `${formatNumber(value)}분`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}

function scoreTone(score: number): "good" | "warn" | "bad" {
  if (score >= 85) return "good";
  if (score >= 65) return "warn";
  return "bad";
}

function severityIcon(severity: StoryworldSeverity): typeof XCircle {
  if (severity === "error") return XCircle;
  if (severity === "warning") return AlertTriangle;
  return Info;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Panel({ title, description, children, action }: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <section className="storyworld-panel">
      <div className="storyworld-panel__heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="storyworld-panel__action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { readonly children: ReactNode }) {
  return (
    <div className="storyworld-empty">
      <BadgeCheck aria-hidden size={28} />
      <p>{children}</p>
    </div>
  );
}

function AxisCards({ result }: { readonly result: StoryworldAnalysisResult }) {
  return (
    <div className="storyworld-axis-grid">
      {result.axisScores.map((axis) => (
        <article className={`storyworld-axis-card storyworld-tone--${scoreTone(axis.score)}`} key={axis.axis}>
          <div className="storyworld-axis-card__topline">
            <span>{AXIS_LABELS[axis.axis]}</span>
            <strong>{axis.score}</strong>
          </div>
          <div
            aria-label={`${AXIS_LABELS[axis.axis]} 점수 ${axis.score}점`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={axis.score}
            className="storyworld-meter"
            role="meter"
          >
            <span style={{ width: `${axis.score}%` }} />
          </div>
          <p>오류 {axis.errorCount} · 경고 {axis.warningCount} · 확인 {axis.infoCount}</p>
        </article>
      ))}
    </div>
  );
}

function IssueList({ issues, limit }: {
  readonly issues: readonly StoryworldIssue[];
  readonly limit?: number;
}) {
  const visible = limit === undefined ? issues : issues.slice(0, limit);
  if (visible.length === 0) return <EmptyState>현재 필터에서 발견된 문제가 없습니다.</EmptyState>;
  return (
    <div className="storyworld-issue-list">
      {visible.map((issue) => {
        const Icon = severityIcon(issue.severity);
        return (
          <article className={`storyworld-issue storyworld-issue--${issue.severity}`} key={issue.id}>
            <Icon aria-hidden size={18} />
            <div>
              <div className="storyworld-issue__meta">
                <span>{SEVERITY_LABELS[issue.severity]}</span>
                <span>{AXIS_LABELS[issue.axis]}</span>
                {issue.sceneId ? <code>{issue.sceneId}</code> : null}
              </div>
              <p>{issue.message}</p>
              <small>{issue.code}</small>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function OverviewTab({ result, onOpenIssues }: {
  readonly result: StoryworldAnalysisResult;
  readonly onOpenIssues: () => void;
}) {
  const blockingIssues = result.issues.filter((issue) => issue.severity === "error").length;
  return (
    <div className="storyworld-tab-stack">
      <div className="storyworld-score-hero">
        <div className={`storyworld-score-orb storyworld-tone--${scoreTone(result.overallScore)}`}>
          <strong>{result.overallScore}</strong>
          <span>통합 건전성</span>
        </div>
        <div className="storyworld-score-copy">
          <span className="storyworld-eyebrow">NARRATIVE DIGITAL TWIN</span>
          <h2>원고를 읽는 대신, 원고가 성립하는지 실행했습니다.</h2>
          <p>
            {result.orderedSceneIds.length}개 장면과 {result.receipt.factCount}개 사실을 순서대로 적용해
            {" "}{result.issues.length}개 검토 신호와 {result.repairProposals.length}개 비파괴 수선 의도를 만들었습니다.
          </p>
          <button className="storyworld-button storyworld-button--primary" onClick={onOpenIssues} type="button">
            {blockingIssues > 0 ? `${blockingIssues}개 차단 오류 검토` : "전체 검토 신호 보기"}
            <ChevronRight aria-hidden size={16} />
          </button>
        </div>
      </div>

      <AxisCards result={result} />

      <div className="storyworld-summary-grid">
        <Panel title="캐논 실행 스냅샷" description="마지막 장면까지 실제로 성립한 세계 상태입니다.">
          <dl className="storyworld-stat-list">
            <div><dt>실행 장면</dt><dd>{result.orderedSceneIds.length}</dd></div>
            <div><dt>세계 프레임</dt><dd>{result.worldTimeline.length}</dd></div>
            <div><dt>열린 복선</dt><dd>{result.setupLedger.filter((row) => row.status === "open" || row.status === "overdue").length}</dd></div>
            <div><dt>독자 공개 사실</dt><dd>{result.worldTimeline.at(-1)?.readerFactIds.length ?? 0}</dd></div>
          </dl>
        </Panel>
        <Panel title="제작 디지털 트윈" description="품질 문제와 제작 비용을 같은 분기에서 비교합니다.">
          <dl className="storyworld-stat-list">
            <div><dt>예상 총 작업</dt><dd>{formatMinutes(result.production.totalMinutes)}</dd></div>
            <div><dt>가용량 사용</dt><dd>{result.production.utilizationPercent === null ? "미설정" : `${result.production.utilizationPercent}%`}</dd></div>
            <div><dt>고유 자산</dt><dd>{result.production.uniqueAssetCount}</dd></div>
            <div><dt>재사용 가능</dt><dd>{result.production.reusableAssetCount}</dd></div>
          </dl>
        </Panel>
        <Panel title="결정적 근거 영수증" description="같은 입력은 같은 지문과 문제 집합을 만듭니다.">
          <dl className="storyworld-receipt">
            <div><dt>프로젝트</dt><dd><code>{result.receipt.projectFingerprint}</code></dd></div>
            <div><dt>문제 집합</dt><dd><code>{result.receipt.issueFingerprint}</code></dd></div>
            <div><dt>스키마</dt><dd>v{result.receipt.version}</dd></div>
            <div><dt>결정적 실행</dt><dd>예</dd></div>
          </dl>
        </Panel>
      </div>

      <Panel
        title="우선 검토 신호"
        description="원고를 자동으로 고치지 않고 근거가 큰 순서대로 보여줍니다."
        action={<button className="storyworld-text-button" onClick={onOpenIssues} type="button">모두 보기 <ChevronRight aria-hidden size={14} /></button>}
      >
        <IssueList issues={result.issues} limit={5} />
      </Panel>
    </div>
  );
}

function IssuesTab({ result }: { readonly result: StoryworldAnalysisResult }) {
  const [severity, setSeverity] = useState<StoryworldSeverity | "all">("all");
  const [axis, setAxis] = useState<StoryworldAxisId | "all">("all");
  const filtered = result.issues.filter((issue) =>
    (severity === "all" || issue.severity === severity)
      && (axis === "all" || issue.axis === axis),
  );
  return (
    <div className="storyworld-tab-stack">
      <Panel title="모순·위험 탐색기" description="필터는 표시만 바꾸며 분석 결과와 영수증을 변경하지 않습니다.">
        <div className="storyworld-filter-row">
          <label>
            심각도
            <select onChange={(event) => setSeverity(event.target.value as StoryworldSeverity | "all")} value={severity}>
              <option value="all">전체</option>
              <option value="error">오류</option>
              <option value="warning">경고</option>
              <option value="info">확인</option>
            </select>
          </label>
          <label>
            품질 축
            <select onChange={(event) => setAxis(event.target.value as StoryworldAxisId | "all")} value={axis}>
              <option value="all">전체</option>
              {Object.entries(AXIS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <span aria-live="polite">{filtered.length}개 표시</span>
        </div>
        <IssueList issues={filtered} />
      </Panel>
      <Panel title="비파괴 수선 의도" description="각 제안은 설명 가능한 중립 명령이며 명시적 승인 전에는 원고를 바꾸지 않습니다.">
        <div className="storyworld-proposal-grid">
          {result.repairProposals.map((proposal) => (
            <article className="storyworld-proposal" key={proposal.id}>
              <div className="storyworld-proposal__topline">
                <WandSparkles aria-hidden size={17} />
                <strong>{proposal.title}</strong>
                <span data-risk={proposal.risk}>위험 {proposal.risk}</span>
              </div>
              <p>{proposal.rationale}</p>
              <code>{proposal.intent.kind}</code>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function MultiverseTab({ project, result }: {
  readonly project: StoryworldProject;
  readonly result: StoryworldAnalysisResult;
}) {
  const activeScenes = project.scenes.filter((scene) => !scene.disabled).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const [sceneId, setSceneId] = useState(activeScenes[0]?.id ?? "");
  const [branch, setBranch] = useState<ReturnType<typeof simulateStoryworldCounterfactual> | null>(null);
  useEffect(() => {
    if (activeScenes.some((scene) => scene.id === sceneId)) return;
    setSceneId(activeScenes[0]?.id ?? "");
  }, [activeScenes, sceneId]);

  const run = () => {
    if (!sceneId) return;
    const mutation: StoryworldBranchMutation = { kind: "disable-scene", sceneId };
    setBranch(simulateStoryworldCounterfactual(project, mutation));
  };
  const frontier = branch
    ? rankStoryworldParetoFrontier([
      { id: "baseline", label: "현재 캐논", result },
      { id: "branch", label: "장면 제외 분기", result: branch.branch },
    ])
    : [];

  return (
    <div className="storyworld-tab-stack">
      <Panel title="반사실 장면 제거 실험" description="원본을 바꾸지 않고 ‘이 장면이 없었다면’을 실행해 후속 파급을 계산합니다.">
        <div className="storyworld-branch-controls">
          <label>
            가상으로 제외할 장면
            <select onChange={(event) => setSceneId(event.target.value)} value={sceneId}>
              {activeScenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.order}. {scene.title}</option>)}
            </select>
          </label>
          <button className="storyworld-button storyworld-button--primary" disabled={!sceneId} onClick={run} type="button">
            <FlaskConical aria-hidden size={17} />
            분기 실행
          </button>
        </div>
      </Panel>

      {branch ? (
        <>
          <div className="storyworld-branch-comparison">
            <article>
              <span>현재 캐논</span>
              <strong>{branch.baseline.overallScore}</strong>
              <small>문제 {branch.baseline.issues.length}개</small>
            </article>
            <div className={`storyworld-delta storyworld-tone--${branch.scoreDelta >= 0 ? "good" : "bad"}`}>
              {branch.scoreDelta >= 0 ? "+" : ""}{branch.scoreDelta}
            </div>
            <article>
              <span>가상 분기</span>
              <strong>{branch.branch.overallScore}</strong>
              <small>문제 {branch.branch.issues.length}개</small>
            </article>
          </div>
          <div className="storyworld-summary-grid">
            <Panel title="영향 원뿔" description="직접 변경과 장면 의존성을 따라 영향을 받는 범위입니다.">
              <div className="storyworld-chip-list">
                {branch.impactedSceneIds.map((id) => <code key={id}>{id}</code>)}
              </div>
            </Panel>
            <Panel title="새로 생긴 문제">
              {branch.addedIssueIds.length > 0
                ? <div className="storyworld-code-list">{branch.addedIssueIds.map((id) => <code key={id}>{id}</code>)}</div>
                : <EmptyState>새 문제 없음</EmptyState>}
            </Panel>
            <Panel title="해결된 문제">
              {branch.resolvedIssueIds.length > 0
                ? <div className="storyworld-code-list">{branch.resolvedIssueIds.map((id) => <code key={id}>{id}</code>)}</div>
                : <EmptyState>해결된 문제 없음</EmptyState>}
            </Panel>
          </div>
          <Panel title="파레토 판정" description="숨은 가중치 없이 9개 품질 축을 모두 비교합니다.">
            <div className="storyworld-frontier-grid">
              {frontier.map((candidate) => (
                <article className={candidate.frontier ? "is-frontier" : ""} key={candidate.id}>
                  <CircleDot aria-hidden size={18} />
                  <div><strong>{candidate.label}</strong><span>{candidate.overallScore}점</span></div>
                  <em>{candidate.frontier ? "비지배 후보" : `${candidate.dominatedByIds.join(", ")}에 지배됨`}</em>
                </article>
              ))}
            </div>
          </Panel>
          <Panel title="분기 축별 점수">
            <AxisCards result={branch.branch} />
          </Panel>
        </>
      ) : (
        <EmptyState>장면을 선택해 원본을 건드리지 않는 반사실 실험을 실행하세요.</EmptyState>
      )}
    </div>
  );
}

function KnowledgeTab({ project, result }: {
  readonly project: StoryworldProject;
  readonly result: StoryworldAnalysisResult;
}) {
  const factById = new Map(project.facts.map((fact) => [fact.id, fact]));
  return (
    <div className="storyworld-tab-stack">
      <Panel title="인물별 믿음 행렬" description="작가가 아는 진실과 등장인물이 아는 사실을 분리합니다.">
        <div className="storyworld-knowledge-grid">
          {result.knowledgeMatrix.map((row) => (
            <article key={row.characterId}>
              <div className="storyworld-avatar" aria-hidden>{row.characterName.slice(0, 1)}</div>
              <div>
                <h3>{row.characterName}</h3>
                <code>{row.characterId}</code>
              </div>
              <dl>
                <div><dt>현재 아는 사실</dt><dd>{row.knownFactIds.length}</dd></div>
                <div><dt>비밀 계약</dt><dd>{row.secretFactIds.length}</dd></div>
              </dl>
              <div className="storyworld-fact-list">
                {row.knownFactIds.map((factId) => (
                  <span key={factId}><CheckCircle2 aria-hidden size={14} />{factById.get(factId)?.label ?? factId}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="지식 누출" description="획득 장면 없이 사용한 사실만 모았습니다.">
        <IssueList issues={result.issues.filter((issue) => issue.code === "knowledge-leak")} />
      </Panel>
      <Panel title="세계 상태 실행 로그" description="각 장면이 끝난 직후의 캐논 사실과 독자 공개 범위입니다.">
        <div className="storyworld-timeline">
          {result.worldTimeline.map((frame) => (
            <article key={frame.sceneId}>
              <div><span>{frame.order}</span><code>{frame.sceneId}</code></div>
              <p>성립 사실 {Object.keys(frame.facts).length} · 독자 공개 {frame.readerFactIds.length}</p>
              <details><summary>상태 보기</summary><pre>{JSON.stringify(frame.facts, null, 2)}</pre></details>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ContractsTab({ result }: { readonly result: StoryworldAnalysisResult }) {
  return (
    <div className="storyworld-tab-stack">
      <Panel title="체호프 원장" description="복선 설치와 회수를 하나의 계약으로 추적합니다.">
        <div className="storyworld-contract-grid">
          {result.setupLedger.map((row) => (
            <article data-status={row.status} key={row.setupId}>
              <div className="storyworld-contract-grid__topline">
                <BookOpenCheck aria-hidden size={18} />
                <strong>{row.label}</strong>
                <span>{row.status}</span>
              </div>
              <dl>
                <div><dt>설치</dt><dd>{row.setupSceneIds.length}회</dd></div>
                <div><dt>회수</dt><dd>{row.payoffSceneIds.length}회</dd></div>
                <div><dt>기한</dt><dd>{row.dueByOrder ?? "미설정"}</dd></div>
              </dl>
              <div className="storyworld-chip-list">
                {[...row.setupSceneIds, ...row.payoffSceneIds].map((id, index) => <code key={`${id}:${index}`}>{id}</code>)}
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="모티프 DNA" description="반복되는 시각·소리·소품 모티프의 빈도와 최대 공백입니다.">
        <div className="storyworld-motif-grid">
          {result.motifLedger.map((row) => (
            <article key={row.motifId}>
              <Sparkles aria-hidden size={20} />
              <div><strong>{row.label}</strong><code>{row.motifId}</code></div>
              <dl>
                <div><dt>등장</dt><dd>{row.occurrenceCount}</dd></div>
                <div><dt>최대 공백</dt><dd>{row.largestGapScenes}장면</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="스포일러 방화벽">
        <IssueList issues={result.issues.filter((issue) => issue.axis === "spoiler-safety")} />
      </Panel>
    </div>
  );
}

function CapabilitiesTab() {
  const [maturity, setMaturity] = useState<StoryworldCapabilityMaturity | "all">("all");
  const counts = storyworldCapabilityCounts();
  const groups = Object.keys(STORYWORLD_CAPABILITY_GROUPS) as StoryworldCapabilityGroup[];
  return (
    <div className="storyworld-tab-stack">
      <div className="storyworld-capability-intro">
        <div>
          <span className="storyworld-eyebrow">CREATIVE EXPANSION MAP</span>
          <h2>{STORYWORLD_CAPABILITIES.length}개 차별화 기능을 하나의 문서 모델로 묶었습니다.</h2>
          <p>버튼을 무작정 늘리지 않고 엔진 포함, 기존 기능 연계, 실험실 후보를 구분합니다.</p>
        </div>
        <dl>
          <div><dt>엔진 포함</dt><dd>{counts.engine}</dd></div>
          <div><dt>연계 설계</dt><dd>{counts.adapter}</dd></div>
          <div><dt>실험실</dt><dd>{counts.experimental}</dd></div>
        </dl>
      </div>
      <div className="storyworld-segmented" role="group" aria-label="기능 성숙도 필터">
        {(["all", "engine", "adapter", "experimental"] as const).map((value) => (
          <button aria-pressed={maturity === value} key={value} onClick={() => setMaturity(value)} type="button">
            {value === "all" ? "전체" : MATURITY_LABELS[value]}
          </button>
        ))}
      </div>
      {groups.map((group) => {
        const capabilities = storyworldCapabilitiesByGroup(group).filter((item) => maturity === "all" || item.maturity === maturity);
        if (capabilities.length === 0) return null;
        const groupMeta = STORYWORLD_CAPABILITY_GROUPS[group];
        return (
          <Panel key={group} title={groupMeta.label} description={groupMeta.purpose}>
            <div className="storyworld-capability-grid">
              {capabilities.map((capability) => (
                <article key={capability.id}>
                  <div className="storyworld-capability-grid__topline">
                    <BrainCircuit aria-hidden size={18} />
                    <span data-maturity={capability.maturity}>{MATURITY_LABELS[capability.maturity]}</span>
                  </div>
                  <h3>{capability.name}</h3>
                  <p>{capability.oneLine}</p>
                  <details>
                    <summary>증거와 안전 경계</summary>
                    <strong>안전 경계</strong>
                    <p>{capability.guardrail}</p>
                    <div className="storyworld-chip-list">{capability.evidence.map((item) => <code key={item}>{item}</code>)}</div>
                    {capability.composesWith ? <small>연계: {capability.composesWith.join(" · ")}</small> : null}
                  </details>
                </article>
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function JsonTab({ project, onApply }: {
  readonly project: StoryworldProject;
  readonly onApply: (project: StoryworldProject) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(project, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(project, null, 2)), [project]);
  const apply = () => {
    try {
      const next = parseStoryworldProject(text);
      onApply(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "JSON을 읽을 수 없습니다.");
    }
  };
  return (
    <Panel
      title="스토리월드 원본 데이터"
      description="자동 추론 대신 사실·공개·지식·제작 근거를 명시적으로 편집합니다."
      action={<button className="storyworld-button storyworld-button--primary" onClick={apply} type="button"><Save aria-hidden size={16} /> 적용 후 분석</button>}
    >
      <label className="storyworld-json-editor">
        <span className="sr-only">스토리월드 JSON</span>
        <textarea onChange={(event) => setText(event.target.value)} spellCheck={false} value={text} />
      </label>
      {error ? <p className="storyworld-inline-error" role="alert"><XCircle aria-hidden size={16} />{error}</p> : null}
    </Panel>
  );
}

export function StudioStoryworldLabPage(props: StudioStoryworldLabPageProps) {
  useDocumentTitle("스토리월드 인과관계 랩 · Studio");
  const key = projectStorageKey(props.workId, props.remixSourceWorkId);
  const [loaded, setLoaded] = useState<{ key: string; project: StoryworldProject } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setError(null);
    void storyworldDraftStore.load(key, parseStoryworldProject).then((project) => {
      if (active) setLoaded({ key, project: project ?? cloneDemoProject() });
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "저장소를 열 수 없습니다.");
    });
    return () => { active = false; };
  }, [key, attempt]);
  if (loaded === null || loaded.key !== key) {
    return (
      <main className="storyworld-main" aria-busy={error === null}>
        <h1>스토리월드 인과관계 랩</h1>
        <p role={error === null ? "status" : "alert"}>
          {error === null ? "SQLite/OPFS에서 스토리월드 초안을 복원하는 중입니다." : `복원 실패: ${error} 저장된 원본은 변경하지 않았습니다.`}
        </p>
        {error !== null ? <button className="storyworld-button" type="button" onClick={() => setAttempt((value) => value + 1)}>저장소 다시 열기</button> : null}
        <Link className="storyworld-button" href={editorHref(props.workId, props.remixSourceWorkId)}>Studio 편집기로 돌아가기</Link>
      </main>
    );
  }
  return <StudioStoryworldLabEditor key={key} {...props} initialProject={loaded.project} />;
}

function StudioStoryworldLabEditor({
  workId,
  remixSourceWorkId,
  initialProject,
}: StudioStoryworldLabPageProps & { readonly initialProject: StoryworldProject }) {
  const storageKey = useMemo(() => projectStorageKey(workId, remixSourceWorkId), [workId, remixSourceWorkId]);
  const [project, setProject] = useState<StoryworldProject>(initialProject);
  const [activeTab, setActiveTab] = useState<StoryworldTab>("overview");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusText, setStatusText] = useState("결정적 로컬 분석 준비됨");
  const importRef = useRef<HTMLInputElement>(null);
  const result = useMemo(() => analyzeStoryworldProject(project), [project]);
  const backHref = editorHref(workId, remixSourceWorkId);
  const documentScope = workId !== null ? `작품 ${workId}` : remixSourceWorkId !== null ? `리믹스 ${remixSourceWorkId}` : "로컬 초안";

  useEffect(() => {
    const previous = document.title;
    document.title = `${project.title} · 스토리월드 인과관계 랩`;
    return () => { document.title = previous; };
  }, [project.title]);

  useEffect(() => {
    let active = true;
    setSaveState("idle");
    // Complete JSON edits queue immediately; only obsolete UI receipts are cancelled.
    void storyworldDraftStore.save(storageKey, project).then(() => {
      if (!active) return;
      setSaveState("saved");
      setStatusText("SQLite/OPFS에 스토리월드 초안을 저장했습니다.");
    }).catch(() => {
      if (!active) return;
      setSaveState("error");
      setStatusText("SQLite/OPFS에 저장하지 못했습니다. 현재 편집은 이 탭에만 남아 있습니다. JSON으로 내보내 보관하세요.");
    });
    return () => { active = false; };
  }, [project, storageKey]);

  const reset = () => {
    setProject(cloneDemoProject());
    setStatusText("데모 스토리월드로 복원했습니다.");
  };
  const exportProject = () => {
    downloadJson(`${project.id}.storyworld.json`, project);
    setStatusText("스토리월드 JSON을 내보냈습니다.");
  };
  const exportReceipt = () => {
    downloadJson(`${project.id}.storyworld-receipt.json`, result.receipt);
    setStatusText("분석 근거 영수증을 내보냈습니다.");
  };
  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error("스토리월드 JSON은 1MB 이하여야 합니다.");
      const next = parseStoryworldProject(await file.text());
      setProject(next);
      setActiveTab("overview");
      setStatusText(`‘${next.title}’ 데이터를 가져와 분석했습니다.`);
    } catch (caught) {
      setStatusText(caught instanceof Error ? `가져오기 실패: ${caught.message}` : "가져오기 실패");
    }
  };

  return (
    <div className="storyworld-shell">
      <header className="storyworld-topbar">
        <div className="storyworld-topbar__brand">
          <Link aria-label="Studio 편집기로 돌아가기" className="storyworld-icon-button" href={backHref}>
            <ArrowLeft aria-hidden size={19} />
          </Link>
          <div className="storyworld-brand-mark" aria-hidden><Network size={20} /></div>
          <div>
            <span>TOONSPECTRUM STUDIO</span>
            <strong>스토리월드 인과관계 랩</strong>
          </div>
        </div>
        <div className="storyworld-topbar__actions">
          <span className={`storyworld-save-state storyworld-save-state--${saveState}`}>
            {saveState === "error" ? <AlertTriangle aria-hidden size={14} /> : <ShieldCheck aria-hidden size={14} />}
            {saveState === "error" ? "저장 실패" : saveState === "saved" ? "로컬 저장됨" : "분석 중"}
          </span>
          <button className="storyworld-button" onClick={() => importRef.current?.click()} type="button"><Import aria-hidden size={16} /> 가져오기</button>
          <button className="storyworld-button" onClick={exportProject} type="button"><Download aria-hidden size={16} /> JSON</button>
          <button className="storyworld-button" onClick={exportReceipt} type="button"><BadgeCheck aria-hidden size={16} /> 영수증</button>
          <input aria-label="스토리월드 JSON 가져오기" accept="application/json,.json" className="sr-only" onChange={importProject} ref={importRef} type="file" />
        </div>
      </header>

      <div className="storyworld-body">
        <aside className="storyworld-sidebar">
          <div className="storyworld-project-card">
            <span>{documentScope}</span>
            <strong>{project.title}</strong>
            <small>{project.id === STORYWORLD_DEMO_PROJECT.id ? "예시 데이터 · " : "로컬 실험 · "}{project.scenes.length}개 장면 · {project.characters.length}명 · {project.facts.length}개 사실</small>
          </div>
          <nav aria-label="스토리월드 랩 섹션">
            {TAB_ITEMS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button aria-current={activeTab === tab.id ? "page" : undefined} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">
                  <Icon aria-hidden size={17} />
                  <span>{tab.label}</span>
                  {tab.id === "issues" && result.issues.length > 0 ? <em>{result.issues.length}</em> : null}
                </button>
              );
            })}
          </nav>
          <div className="storyworld-sidebar__footer">
            <button onClick={reset} type="button"><RefreshCcw aria-hidden size={15} /> 데모 초기화</button>
            <p><TimerReset aria-hidden size={14} /> 분석은 네트워크 없이 이 탭에서 실행됩니다.</p>
          </div>
        </aside>

        <main className="storyworld-main">
          <div className="storyworld-page-heading">
            <div>
              <span className="storyworld-eyebrow">{documentScope} · 캔버스 원고와 자동 연결되지 않은 로컬 실험</span>
              <h1>{TAB_ITEMS.find((tab) => tab.id === activeTab)?.label}</h1>
            </div>
            <div className="storyworld-run-badge">
              <BrainCircuit aria-hidden size={18} />
              <span><strong>{result.receipt.issueFingerprint}</strong> 문제 지문</span>
            </div>
          </div>

          {activeTab === "overview" ? <OverviewTab onOpenIssues={() => setActiveTab("issues")} result={result} /> : null}
          {activeTab === "issues" ? <IssuesTab result={result} /> : null}
          {activeTab === "multiverse" ? <MultiverseTab project={project} result={result} /> : null}
          {activeTab === "knowledge" ? <KnowledgeTab project={project} result={result} /> : null}
          {activeTab === "contracts" ? <ContractsTab result={result} /> : null}
          {activeTab === "capabilities" ? <CapabilitiesTab /> : null}
          {activeTab === "json" ? <JsonTab onApply={(next) => { setProject(next); setStatusText("JSON 변경을 적용해 다시 분석했습니다."); }} project={project} /> : null}
        </main>
      </div>
      <div aria-live="polite" className="storyworld-statusbar">
        <CircleDot aria-hidden size={13} />
        <span>{statusText}</span>
        <code>schema v{STUDIO_STORYWORLD_SCHEMA_VERSION}</code>
      </div>
    </div>
  );
}
