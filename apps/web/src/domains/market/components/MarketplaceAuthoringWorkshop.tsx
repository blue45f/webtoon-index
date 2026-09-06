import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  CREATOR_MARKETPLACE_AUTHORING_KINDS,
  CREATOR_MARKETPLACE_BRUSH_BLEND_OPERATORS,
  CREATOR_MARKETPLACE_BRUSH_CHANNELS,
  CREATOR_MARKETPLACE_BRUSH_ENGINES,
  CREATOR_MARKETPLACE_BRUSH_TARGETS,
  buildCreatorMarketplaceAuthoringManifest,
  consumeCreatorMarketplaceAuthoringHandoff,
  createCreatorMarketplaceAuthoringDraft,
  createCreatorMarketplaceBrushEngineNode,
  createCreatorMarketplaceDraftFromBrushStudio,
  creatorMarketplaceBrushCombinationCount,
  loadCreatorMarketplaceAuthoringDraft,
  normalizeCreatorMarketplaceAuthoringDraft,
  saveCreatorMarketplaceAuthoringDraft,
  stageCreatorMarketplaceAuthoringHandoff,
  validateCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDiagnostic,
  type CreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringKind,
  type CreatorMarketplaceBrushEngineKind,
} from "@/shared/lib/creator-marketplace-authoring-workshop";

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg outline-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 motion-reduce:transition-none";

const STEPS = [
  { id: "source", label: "제작 원본" },
  { id: "recipe", label: "엔진·구성" },
  { id: "preview", label: "미리보기" },
  { id: "bundle", label: "번들" },
  { id: "compatibility", label: "호환성" },
  { id: "rights", label: "권리" },
  { id: "release", label: "검수·배포" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

const KIND_LABELS: Readonly<Record<CreatorMarketplaceAuthoringKind, string>> = {
  brush: "브러시",
  tone: "톤·패턴",
  palette: "팔레트",
  pose: "포즈",
  "3d": "3D 에셋",
  background: "배경",
  bubble: "말풍선",
  template: "템플릿",
  material: "복합 소재",
};

const ENGINE_LABELS: Readonly<Record<CreatorMarketplaceBrushEngineKind, string>> = {
  "solid-path": "솔리드 경로",
  "vector-outline": "벡터 외곽선",
  "dab-stamp": "댑·스탬프",
  "image-tip": "이미지 팁",
  "procedural-sdf-tip": "절차형 SDF 팁",
  "dry-media": "연필·목탄·파스텔",
  "particle-scatter": "파티클·산포",
  "wet-media": "젖은 매체",
  "watercolor-diffusion": "수채 확산",
  "oil-impasto": "유화·임파스토",
  "living-ink": "리빙 잉크",
  "dual-brush": "듀얼 브러시",
  smudge: "스머지",
  eraser: "지우개",
  "texture-relief": "질감·릴리프",
  glow: "글로우",
  "post-process": "후처리",
};

const USE_SCENARIOS = [
  "가는 선·빠른 선",
  "느린 필압 변화",
  "짧은 탭·점",
  "교차선·급코너",
  "확대 400%",
  "마우스 입력",
  "터치 입력",
  "펜 기울기·회전",
  "어두운·밝은 배경",
  "긴 스트로크",
] as const;

function replaceItem<T extends { id: string }>(
  items: readonly T[],
  id: string,
  update: (item: T) => T,
): readonly T[] {
  return items.map((item) => item.id === id ? update(item) : item);
}

function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): readonly T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const result = [...items];
  const [item] = result.splice(index, 1);
  if (item === undefined) return items;
  result.splice(target, 0, item);
  return result;
}

function setNativeFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findLabeledControl(
  pattern: RegExp,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  for (const label of document.querySelectorAll("label")) {
    if (!pattern.test(label.textContent ?? "")) continue;
    const nested = label.querySelector("input, textarea, select");
    if (
      nested instanceof HTMLInputElement
      || nested instanceof HTMLTextAreaElement
      || nested instanceof HTMLSelectElement
    ) return nested;
    const linked = label.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (
      linked instanceof HTMLInputElement
      || linked instanceof HTMLTextAreaElement
      || linked instanceof HTMLSelectElement
    ) return linked;
  }
  return null;
}

function applyDraftToPublishForm(
  draft: CreatorMarketplaceAuthoringDraft,
): { applied: number; packageAttached: boolean } {
  const mappings: Array<[RegExp, string]> = [
    [/이름|제목|title/i, draft.title],
    [/요약|summary/i, draft.summary],
    [/설명|description|소개/i, draft.description],
    [/태그|tags/i, draft.tags.join(", ")],
    [/버전|version/i, draft.release.version],
    [/변경|changelog|릴리스 노트/i, draft.release.changelog],
  ];
  let applied = 0;
  for (const [pattern, value] of mappings) {
    if (!value) continue;
    const control = findLabeledControl(pattern);
    if (!control || control.closest('[data-marketplace-authoring-workshop="true"]')) continue;
    setNativeFieldValue(control, value);
    applied += 1;
  }

  const kindControl = findLabeledControl(/종류|유형|kind|category/i);
  if (kindControl instanceof HTMLSelectElement) {
    const option = Array.from(kindControl.options).find((candidate) =>
      candidate.value === draft.kind || candidate.textContent?.includes(KIND_LABELS[draft.kind]),
    );
    if (option) {
      setNativeFieldValue(kindControl, option.value);
      applied += 1;
    }
  }

  const manifest = buildCreatorMarketplaceAuthoringManifest(draft);
  const file = new File(
    [JSON.stringify(manifest, null, 2)],
    `${draft.title.trim().replace(/[^0-9A-Za-z가-힣._-]+/gu, "-") || "market-asset"}.toonmarket.json`,
    { type: "application/json" },
  );
  const fileInput = Array.from(document.querySelectorAll('input[type="file"]'))
    .find((element): element is HTMLInputElement =>
      element instanceof HTMLInputElement
      && !element.closest('[data-marketplace-authoring-workshop="true"]'),
    );
  if (!fileInput || typeof DataTransfer === "undefined") return { applied, packageAttached: false };
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  return { applied, packageAttached: true };
}

function downloadJson(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function diagnosticClass(diagnostic: CreatorMarketplaceAuthoringDiagnostic): string {
  if (diagnostic.severity === "error") return "border-danger/30 bg-danger/5 text-danger";
  if (diagnostic.severity === "warning") return "border-warning/30 bg-warning/5 text-fg";
  return "border-line bg-raised text-fg-2";
}

export function MarketplaceAuthoringWorkshop(): ReactElement {
  const [draft, setDraft] = useState<CreatorMarketplaceAuthoringDraft>(() =>
    loadCreatorMarketplaceAuthoringDraft()
      ?? createCreatorMarketplaceAuthoringDraft(),
  );
  const [step, setStep] = useState<StepId>("source");
  const [tagInput, setTagInput] = useState("");
  const [status, setStatus] = useState("자동 저장 준비됨");
  const [expandedEngine, setExpandedEngine] = useState<string | null>(null);
  const [selectedEngine, setSelectedEngine] =
    useState<CreatorMarketplaceBrushEngineKind>("dry-media");
  const [scenarios, setScenarios] = useState<readonly string[]>([
    "가는 선·빠른 선",
    "느린 필압 변화",
    "교차선·급코너",
  ]);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const handoff = consumeCreatorMarketplaceAuthoringHandoff();
    if (handoff) setDraft(handoff);
  }, []);

  const normalized = useMemo(
    () => normalizeCreatorMarketplaceAuthoringDraft(draft),
    [draft],
  );
  const diagnostics = useMemo(
    () => validateCreatorMarketplaceAuthoringDraft(normalized),
    [normalized],
  );
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const combinations = useMemo(
    () => creatorMarketplaceBrushCombinationCount(normalized),
    [normalized],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveCreatorMarketplaceAuthoringDraft(normalized);
      setStatus(`자동 저장 · ${new Date().toLocaleTimeString()}`);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [normalized]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || normalized.kind !== "brush") return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(320, canvas.clientWidth || 640);
    const height = 190;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#f7f5ef";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(22,24,29,.11)";
    context.lineWidth = 1;
    for (let x = 16; x < width; x += 24) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 16; y < height; y += 24) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const nodes = normalized.brush.engineNodes.filter((node) => node.enabled);
    nodes.forEach((node, index) => {
      const seed = normalized.brush.deterministicSeed + index * 97;
      const size = Number(node.parameters.size ?? 24);
      const opacity = Number(node.parameters.opacity ?? 1);
      context.save();
      context.globalAlpha = Math.min(1, Math.max(0.1, opacity));
      context.lineWidth = Math.max(1, Math.min(42, size * (0.2 + index * 0.08)));
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = index % 3 === 0 ? "#1d232d" : index % 3 === 1 ? "#405b72" : "#7c485c";
      context.beginPath();
      for (let sample = 0; sample <= 96; sample += 1) {
        const progress = sample / 96;
        const x = 24 + progress * (width - 48);
        const wobble = Math.sin(
          progress * Math.PI * (2.4 + index * 0.32) + seed * 0.01,
        ) * (18 + index * 5);
        const y = 52
          + index * Math.min(38, 108 / Math.max(1, nodes.length - 1))
          + wobble * (0.25 + progress * 0.75);
        if (sample === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      context.restore();
    });
  }, [normalized]);

  const updateDraft = useCallback((
    updater: (current: CreatorMarketplaceAuthoringDraft) => CreatorMarketplaceAuthoringDraft,
  ) => {
    setDraft((current) => normalizeCreatorMarketplaceAuthoringDraft(updater(current)));
  }, []);

  const setKind = (kind: CreatorMarketplaceAuthoringKind): void => {
    updateDraft((current) => ({ ...current, kind, updatedAt: new Date().toISOString() }));
    setStep("source");
  };

  const addEngine = (): void => {
    updateDraft((current) => ({
      ...current,
      brush: {
        ...current.brush,
        engineNodes: [
          ...current.brush.engineNodes,
          createCreatorMarketplaceBrushEngineNode(selectedEngine),
        ],
      },
    }));
  };

  const handleFile = async (file: File): Promise<void> => {
    if (file.size > 64 * 1024 * 1024) {
      setStatus("64MB 이하 원본을 선택하세요.");
      return;
    }
    if (/json|brush|toonmarket/iu.test(`${file.type} ${file.name}`)) {
      try {
        const parsed: unknown = JSON.parse(await file.text());
        const imported = normalized.kind === "brush"
          ? createCreatorMarketplaceDraftFromBrushStudio(parsed)
          : normalizeCreatorMarketplaceAuthoringDraft(parsed);
        setDraft({
          ...imported,
          kind: normalized.kind,
          source: {
            ...imported.source,
            mode: normalized.kind === "brush" ? "brush-studio" : "file",
            fileName: file.name,
            name: file.name,
          },
        });
        setStatus("원본과 엔진 프로그램을 가져왔습니다.");
        return;
      } catch {
        // Native binary formats remain package sources and are checked by the existing importer.
      }
    }
    updateDraft((current) => ({
      ...current,
      source: { mode: "file", name: file.name, fileName: file.name },
      technical: {
        ...current.technical,
        sourceFileBytes: file.size,
        sourceMimeType: file.type || "application/octet-stream",
      },
    }));
    setStatus("원본 파일을 연결했습니다. 게시 전 호환성 검사를 실행하세요.");
  };

  const launchBrushStudio = (): void => {
    const prepared = normalized.kind === "brush"
      ? normalized
      : { ...normalized, kind: "brush" as const };
    stageCreatorMarketplaceAuthoringHandoff(prepared);
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(
      `/studio?workspace=brush-studio&marketAuthoring=${encodeURIComponent(prepared.resumeToken)}&returnTo=${encodeURIComponent(returnTo)}`,
    );
  };

  const addTag = (): void => {
    const values = tagInput.split(/[,#\n]/u).map((value) => value.trim()).filter(Boolean);
    if (values.length === 0) return;
    updateDraft((current) => ({
      ...current,
      tags: [...new Set([...current.tags, ...values])].slice(0, 24),
    }));
    setTagInput("");
  };

  const applyToForm = (): void => {
    const result = applyDraftToPublishForm(normalized);
    setStatus(
      result.packageAttached
        ? `등록 폼 ${result.applied}개 항목과 제작 패키지를 연결했습니다.`
        : `등록 폼 ${result.applied}개 항목을 연결했습니다. 패키지는 내려받아 첨부하세요.`,
    );
  };

  return (
    <section
      data-marketplace-authoring-workshop="true"
      data-testid="marketplace-authoring-workshop"
      className="mb-8 overflow-hidden rounded-2xl border border-line bg-card shadow-sm"
      aria-labelledby="marketplace-authoring-heading"
    >
      <header className="border-b border-line bg-gradient-to-br from-raised via-card to-card p-5 sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Creator publishing workshop
            </p>
            <h2
              id="marketplace-authoring-heading"
              className="text-balance text-2xl font-bold text-fg sm:text-3xl"
            >
              제작부터 업데이트까지 이어지는 에셋 등록 워크숍
            </h2>
            <p className="mt-3 text-sm leading-6 text-fg-2">
              Brush Studio 원본, 엔진 조합, 실사용 미리보기, 호환성, 권리와 릴리스
              이력을 하나의 게시 초안으로 보존합니다.
            </p>
          </div>
          <div className="grid min-w-[260px] grid-cols-3 gap-2" aria-label="게시 준비 상태">
            <Metric label="오류" value={errors.length} tone={errors.length > 0 ? "danger" : "ok"} />
            <Metric label="권고" value={warnings.length} tone={warnings.length > 0 ? "warn" : "ok"} />
            <Metric
              label="조합"
              value={normalized.kind === "brush" ? combinations : normalized.bundle.length + 1}
              tone="neutral"
            />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {CREATOR_MARKETPLACE_AUTHORING_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={normalized.kind === kind}
              onClick={() => setKind(kind)}
              className={`min-h-10 rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none ${
                normalized.kind === kind
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
              }`}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      </header>

      <nav
        className="overflow-x-auto border-b border-line bg-card px-3 sm:px-5"
        aria-label="에셋 등록 단계"
      >
        <div className="flex min-w-max gap-1 py-2" role="tablist">
          {STEPS.map((item, index) => {
            const issueCount = diagnostics.filter((diagnostic) => diagnostic.step === item.id).length;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={step === item.id}
                aria-controls={`market-authoring-panel-${item.id}`}
                onClick={() => setStep(item.id)}
                className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors motion-reduce:transition-none ${
                  step === item.id
                    ? "bg-raised text-fg"
                    : "text-fg-2 hover:bg-raised/60 hover:text-fg"
                }`}
              >
                <span className="mr-2 text-xs opacity-60">{index + 1}</span>
                {item.label}
                {issueCount > 0 && (
                  <span className="ml-2 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px]">
                    {issueCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="p-4 sm:p-6 lg:p-7">
        {step === "source" && (
          <div id="market-authoring-panel-source" role="tabpanel" className="space-y-6">
            <SectionTitle
              title="제작 원본과 검색 정보"
              description="원본은 업데이트·재편집·설치 복구의 기준이 됩니다."
            />
            <div className="grid gap-3 lg:grid-cols-3">
              {normalized.kind === "brush" && (
                <SourceCard
                  title="Brush Studio에서 계속"
                  description="현재 게시 초안을 보존하고 전문 브러시 편집 화면으로 이동합니다."
                  action="Brush Studio 열기"
                  onClick={launchBrushStudio}
                  emphasized
                />
              )}
              <SourceCard
                title="원본 파일 가져오기"
                description="Brush Studio JSON, 브러시 세트, 이미지·3D·템플릿 패키지를 연결합니다."
                action="파일 선택"
                onClick={() => fileRef.current?.click()}
              />
              <SourceCard
                title="새 에셋으로 설계"
                description="빈 레시피에서 엔진·번들·호환성 계약을 직접 구성합니다."
                action="초기화"
                onClick={() => setDraft(createCreatorMarketplaceAuthoringDraft(normalized.kind))}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              data-testid="market-authoring-source-file"
              accept=".json,.toonmarket,.brush,.brushset,.sut,.abr,.png,.jpg,.jpeg,.webp,.svg,.glb,.gltf,.obj,.fbx,.zip"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void handleFile(file);
                event.currentTarget.value = "";
              }}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="에셋 이름" hint="검색 결과와 설치 화면에 표시됩니다.">
                <input
                  value={normalized.title}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))}
                  className={INPUT_CLASS}
                  data-testid="market-authoring-title"
                />
              </Field>
              <Field label="카드 요약" hint="용도와 차별점을 한 문장으로 작성하세요.">
                <input
                  value={normalized.summary}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    summary: event.target.value,
                  }))}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
            <Field
              label="상세 설명"
              hint="권장 크기·해상도·레이어·사용 순서와 제한 사항을 포함하세요."
            >
              <textarea
                rows={5}
                value={normalized.description}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))}
                className={`${INPUT_CLASS} resize-y`}
              />
            </Field>
            <Field label="검색 태그" hint="쉼표 또는 #으로 구분합니다.">
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  className={INPUT_CLASS}
                  placeholder="웹툰, 선화, 거친 연필"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="min-h-11 shrink-0 rounded-lg border border-line bg-raised px-4 text-sm font-semibold text-fg"
                >
                  추가
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {normalized.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => updateDraft((current) => ({
                      ...current,
                      tags: current.tags.filter((value) => value !== tag),
                    }))}
                    className="rounded-full border border-line bg-card px-3 py-1 text-xs text-fg-2"
                    aria-label={`${tag} 태그 삭제`}
                  >
                    #{tag} ×
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {step === "recipe" && (
          <div id="market-authoring-panel-recipe" role="tabpanel" className="space-y-6">
            <SectionTitle
              title={normalized.kind === "brush" ? "실제 브러시 엔진 조합" : `${KIND_LABELS[normalized.kind]} 구성`}
              description={
                normalized.kind === "brush"
                  ? "Brush Studio native enginePrograms와 정규화된 조합 그래프를 함께 보존합니다."
                  : "구성 요소와 기술 메타데이터를 패키지에 명시합니다."
              }
            />
            {normalized.kind === "brush" ? (
              <>
                <div className="flex flex-col gap-3 rounded-xl border border-line bg-raised/40 p-4 sm:flex-row sm:items-end">
                  <Field label="추가할 엔진" compact>
                    <select
                      value={selectedEngine}
                      onChange={(event) => setSelectedEngine(
                        event.target.value as CreatorMarketplaceBrushEngineKind,
                      )}
                      className={`${INPUT_CLASS} min-w-[220px]`}
                    >
                      {CREATOR_MARKETPLACE_BRUSH_ENGINES.map((engine) => (
                        <option key={engine} value={engine}>{ENGINE_LABELS[engine]}</option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    onClick={addEngine}
                    className="min-h-11 rounded-lg bg-accent px-5 text-sm font-bold text-accent-fg"
                    data-testid="market-authoring-add-engine"
                  >
                    엔진 패스 추가
                  </button>
                  <p className="text-xs leading-5 text-fg-2">
                    순서·블렌드·백엔드·입력 채널·팁 레이어를 조합합니다. 지원되지 않는
                    조합은 검수 전에 차단됩니다.
                  </p>
                </div>

                <div className="space-y-3" data-testid="market-authoring-engine-list">
                  {normalized.brush.engineNodes.map((node, index) => (
                    <article key={node.id} className="rounded-xl border border-line bg-card">
                      <div className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
                        <label className="flex min-h-10 items-center gap-2 px-1 text-sm font-semibold text-fg">
                          <input
                            type="checkbox"
                            checked={node.enabled}
                            onChange={(event) => updateDraft((current) => ({
                              ...current,
                              brush: {
                                ...current.brush,
                                engineNodes: replaceItem(
                                  current.brush.engineNodes,
                                  node.id,
                                  (item) => ({ ...item, enabled: event.target.checked }),
                                ),
                              },
                            }))}
                          />
                          <span className="rounded-md bg-raised px-2 py-1 text-xs tabular-nums">
                            {index + 1}
                          </span>
                          {ENGINE_LABELS[node.engine]}
                        </label>
                        {node.sourceProgram !== undefined && (
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-semibold text-success">
                            Studio 원본 보존
                          </span>
                        )}
                        <select
                          aria-label={`${ENGINE_LABELS[node.engine]} 블렌드`}
                          value={node.blend}
                          onChange={(event) => updateDraft((current) => ({
                            ...current,
                            brush: {
                              ...current.brush,
                              engineNodes: replaceItem(
                                current.brush.engineNodes,
                                node.id,
                                (item) => ({
                                  ...item,
                                  blend: event.target.value as typeof item.blend,
                                }),
                              ),
                            },
                          }))}
                          className="min-h-10 rounded-lg border border-line bg-card px-2 text-xs text-fg"
                        >
                          {CREATOR_MARKETPLACE_BRUSH_BLEND_OPERATORS.map((operator) => (
                            <option key={operator} value={operator}>{operator}</option>
                          ))}
                        </select>
                        <select
                          aria-label={`${ENGINE_LABELS[node.engine]} 백엔드`}
                          value={node.backend}
                          onChange={(event) => updateDraft((current) => ({
                            ...current,
                            brush: {
                              ...current.brush,
                              engineNodes: replaceItem(
                                current.brush.engineNodes,
                                node.id,
                                (item) => ({
                                  ...item,
                                  backend: event.target.value as typeof item.backend,
                                }),
                              ),
                            },
                          }))}
                          className="min-h-10 rounded-lg border border-line bg-card px-2 text-xs text-fg"
                        >
                          {(["portable", "canvas2d", "webgl2", "webgpu", "wasm"] as const)
                            .map((backend) => (
                              <option key={backend} value={backend}>{backend}</option>
                            ))}
                        </select>
                        <div className="ml-auto flex gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => updateDraft((current) => ({
                              ...current,
                              brush: {
                                ...current.brush,
                                engineNodes: moveItem(current.brush.engineNodes, index, -1),
                              },
                            }))}
                            className="size-10 rounded-lg border border-line text-fg-2 disabled:opacity-30"
                            aria-label="위로 이동"
                          >↑</button>
                          <button
                            type="button"
                            disabled={index === normalized.brush.engineNodes.length - 1}
                            onClick={() => updateDraft((current) => ({
                              ...current,
                              brush: {
                                ...current.brush,
                                engineNodes: moveItem(current.brush.engineNodes, index, 1),
                              },
                            }))}
                            className="size-10 rounded-lg border border-line text-fg-2 disabled:opacity-30"
                            aria-label="아래로 이동"
                          >↓</button>
                          <button
                            type="button"
                            onClick={() => setExpandedEngine(
                              expandedEngine === node.id ? null : node.id,
                            )}
                            className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold text-fg"
                          >
                            {expandedEngine === node.id ? "접기" : "세부 설정"}
                          </button>
                          <button
                            type="button"
                            disabled={normalized.brush.engineNodes.length === 1}
                            onClick={() => updateDraft((current) => ({
                              ...current,
                              brush: {
                                ...current.brush,
                                engineNodes: current.brush.engineNodes.filter(
                                  (item) => item.id !== node.id,
                                ),
                              },
                            }))}
                            className="size-10 rounded-lg border border-line text-danger disabled:opacity-30"
                            aria-label="엔진 삭제"
                          >×</button>
                        </div>
                      </div>

                      {expandedEngine === node.id && (
                        <div className="grid gap-5 border-t border-line p-4 lg:grid-cols-2">
                          <div>
                            <h4 className="text-sm font-bold text-fg">입력 채널 매핑</h4>
                            <div className="mt-3 space-y-2">
                              {node.mappings.map((mapping) => (
                                <div
                                  key={mapping.id}
                                  className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 rounded-lg border border-line bg-raised/30 p-2"
                                >
                                  <input
                                    type="checkbox"
                                    checked={mapping.enabled}
                                    onChange={(event) => updateDraft((current) => ({
                                      ...current,
                                      brush: {
                                        ...current.brush,
                                        engineNodes: replaceItem(
                                          current.brush.engineNodes,
                                          node.id,
                                          (engine) => ({
                                            ...engine,
                                            mappings: replaceItem(
                                              engine.mappings,
                                              mapping.id,
                                              (item) => ({
                                                ...item,
                                                enabled: event.target.checked,
                                              }),
                                            ),
                                          }),
                                        ),
                                      },
                                    }))}
                                    aria-label="매핑 활성화"
                                  />
                                  <select
                                    value={mapping.channel}
                                    onChange={(event) => updateDraft((current) => ({
                                      ...current,
                                      brush: {
                                        ...current.brush,
                                        engineNodes: replaceItem(
                                          current.brush.engineNodes,
                                          node.id,
                                          (engine) => ({
                                            ...engine,
                                            mappings: replaceItem(
                                              engine.mappings,
                                              mapping.id,
                                              (item) => ({
                                                ...item,
                                                channel: event.target.value as typeof item.channel,
                                              }),
                                            ),
                                          }),
                                        ),
                                      },
                                    }))}
                                    className="min-h-9 rounded-md border border-line bg-card px-2 text-xs text-fg"
                                  >
                                    {CREATOR_MARKETPLACE_BRUSH_CHANNELS.map((channel) => (
                                      <option key={channel} value={channel}>{channel}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={mapping.target}
                                    onChange={(event) => updateDraft((current) => ({
                                      ...current,
                                      brush: {
                                        ...current.brush,
                                        engineNodes: replaceItem(
                                          current.brush.engineNodes,
                                          node.id,
                                          (engine) => ({
                                            ...engine,
                                            mappings: replaceItem(
                                              engine.mappings,
                                              mapping.id,
                                              (item) => ({
                                                ...item,
                                                target: event.target.value as typeof item.target,
                                              }),
                                            ),
                                          }),
                                        ),
                                      },
                                    }))}
                                    className="min-h-9 rounded-md border border-line bg-card px-2 text-xs text-fg"
                                  >
                                    {CREATOR_MARKETPLACE_BRUSH_TARGETS.map((target) => (
                                      <option key={target} value={target}>{target}</option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-fg">팁·그레인 레이어</h4>
                            <div className="mt-3 space-y-2">
                              {node.tipLayers.map((tip, tipIndex) => (
                                <div
                                  key={tip.id}
                                  className="rounded-lg border border-line bg-raised/30 p-3 text-xs text-fg-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <strong className="text-fg">{tipIndex + 1}. {tip.name}</strong>
                                    <span>{tip.source} · {tip.blend}</span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-3 gap-2">
                                    <span>간격 {tip.spacing.toFixed(2)}</span>
                                    <span>산포 {tip.scatter.toFixed(2)}</span>
                                    <span>회전 {tip.rotationDeg}°</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="결정적 시드" compact>
                    <input
                      type="number"
                      value={normalized.brush.deterministicSeed}
                      onChange={(event) => updateDraft((current) => ({
                        ...current,
                        brush: {
                          ...current.brush,
                          deterministicSeed: Number(event.target.value) || 0,
                        },
                      }))}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <Field label="프리셋 계열" compact>
                    <input
                      value={normalized.brush.presetFamily}
                      onChange={(event) => updateDraft((current) => ({
                        ...current,
                        brush: { ...current.brush, presetFamily: event.target.value },
                      }))}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <div className="rounded-xl border border-line bg-raised/40 p-4">
                    <p className="text-xs text-fg-2">가능한 테스트 조합</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-fg">
                      {combinations.toLocaleString()}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <KindSpecificEditor draft={normalized} updateDraft={updateDraft} />
            )}
          </div>
        )}

        {step === "preview" && (
          <div id="market-authoring-panel-preview" role="tabpanel" className="space-y-6">
            <SectionTitle
              title="실사용 미리보기와 검증 시나리오"
              description="장식용 썸네일뿐 아니라 실제 사용 조건을 설명하는 미디어를 구성합니다."
            />
            {normalized.kind === "brush" && (
              <canvas
                ref={canvasRef}
                className="h-[190px] w-full rounded-xl border border-line"
                aria-label="브러시 레시피 결정적 미리보기"
                data-testid="market-authoring-brush-preview"
              />
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {USE_SCENARIOS.map((scenario) => (
                <label
                  key={scenario}
                  className="flex min-h-12 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs text-fg"
                >
                  <input
                    type="checkbox"
                    checked={scenarios.includes(scenario)}
                    onChange={(event) => setScenarios((current) =>
                      event.target.checked
                        ? [...current, scenario]
                        : current.filter((item) => item !== scenario),
                    )}
                  />
                  {scenario}
                </label>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {(["cover", "stroke-sheet", normalized.kind === "3d" ? "turntable" : "before-after"] as const)
                .map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => updateDraft((current) => ({
                      ...current,
                      media: [
                        ...current.media,
                        {
                          id: `media_${Date.now()}_${kind}`,
                          kind,
                          name: `${kind} preview`,
                          alt: `${current.title || KIND_LABELS[current.kind]} ${kind} 미리보기`,
                          scenario: scenarios.join(", "),
                        },
                      ],
                    }))}
                    className="min-h-24 rounded-xl border border-dashed border-line bg-raised/30 p-4 text-left hover:border-accent"
                  >
                    <strong className="block text-sm text-fg">{kind}</strong>
                    <span className="mt-1 block text-xs leading-5 text-fg-2">
                      미디어 슬롯 추가 · 대체 텍스트와 시나리오 포함
                    </span>
                  </button>
                ))}
            </div>
            {normalized.media.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {normalized.media.map((media) => (
                  <div key={media.id} className="rounded-lg border border-line bg-card p-3">
                    <div className="flex justify-between gap-2">
                      <strong className="text-sm text-fg">{media.kind}</strong>
                      <button
                        type="button"
                        onClick={() => updateDraft((current) => ({
                          ...current,
                          media: current.media.filter((item) => item.id !== media.id),
                        }))}
                        className="text-xs text-danger"
                      >삭제</button>
                    </div>
                    <p className="mt-2 text-xs text-fg-2">{media.alt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "bundle" && (
          <div id="market-authoring-panel-bundle" role="tabpanel" className="space-y-6">
            <SectionTitle
              title="패키지 구성·종속 에셋"
              description="설치 시 함께 필요한 팁·그레인·텍스처·폰트·포즈·3D 모델을 명시합니다."
            />
            <div className="grid gap-3 md:grid-cols-3">
              {(["texture", "palette", "reference"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => updateDraft((current) => ({
                    ...current,
                    bundle: [
                      ...current.bundle,
                      {
                        id: `bundle_${Date.now()}_${kind}`,
                        kind,
                        name: `새 ${kind}`,
                        required: kind !== "reference",
                        role: kind === "texture" ? "브러시 팁·그레인" : "보조 리소스",
                      },
                    ],
                  }))}
                  className="min-h-20 rounded-xl border border-dashed border-line bg-raised/30 p-4 text-left text-sm font-semibold text-fg hover:border-accent"
                >
                  + {kind} 추가
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {normalized.bundle.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-xl border border-line bg-card p-4 md:grid-cols-[1fr_140px_140px_auto] md:items-center"
                >
                  <input
                    aria-label="번들 항목 이름"
                    value={item.name}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      bundle: replaceItem(current.bundle, item.id, (entry) => ({
                        ...entry,
                        name: event.target.value,
                      })),
                    }))}
                    className={INPUT_CLASS}
                  />
                  <input
                    aria-label="버전 범위"
                    value={item.versionRange ?? ""}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      bundle: replaceItem(current.bundle, item.id, (entry) => ({
                        ...entry,
                        versionRange: event.target.value || undefined,
                      })),
                    }))}
                    placeholder="^1.0.0"
                    className={INPUT_CLASS}
                  />
                  <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      checked={item.required}
                      onChange={(event) => updateDraft((current) => ({
                        ...current,
                        bundle: replaceItem(current.bundle, item.id, (entry) => ({
                          ...entry,
                          required: event.target.checked,
                        })),
                      }))}
                    />
                    필수 설치
                  </label>
                  <button
                    type="button"
                    onClick={() => updateDraft((current) => ({
                      ...current,
                      bundle: current.bundle.filter((entry) => entry.id !== item.id),
                    }))}
                    className="min-h-10 rounded-lg border border-line px-3 text-xs text-danger"
                  >삭제</button>
                </div>
              ))}
              {normalized.bundle.length === 0 && (
                <EmptyState text="단독 설치 에셋입니다. 필요한 종속 에셋이 있으면 추가하세요." />
              )}
            </div>
          </div>
        )}

        {step === "compatibility" && (
          <div id="market-authoring-panel-compatibility" role="tabpanel" className="space-y-6">
            <SectionTitle
              title="런타임·입력·버전 호환성"
              description="지원하지 않는 환경을 숨기지 않고 설치 전에 명확히 안내합니다."
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(["canvas2d", "webgl2", "webgpu", "wasm"] as const).map((backend) => (
                <ToggleCard
                  key={backend}
                  label={backend}
                  checked={normalized.compatibility[backend]}
                  onChange={(checked) => updateDraft((current) => ({
                    ...current,
                    compatibility: { ...current.compatibility, [backend]: checked },
                  }))}
                />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["mouse", "touch", "stylus"] as const).map((device) => (
                <ToggleCard
                  key={device}
                  label={device}
                  checked={normalized.compatibility[device]}
                  onChange={(checked) => updateDraft((current) => ({
                    ...current,
                    compatibility: { ...current.compatibility, [device]: checked },
                  }))}
                />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="최소 앱 버전">
                <input
                  value={normalized.compatibility.minAppVersion}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    compatibility: {
                      ...current.compatibility,
                      minAppVersion: event.target.value,
                    },
                  }))}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="검증 브라우저">
                <input
                  value={normalized.compatibility.testedBrowsers.join(", ")}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    compatibility: {
                      ...current.compatibility,
                      testedBrowsers: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    },
                  }))}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
            <Field label="호환성 참고">
              <textarea
                rows={4}
                value={normalized.compatibility.notes}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  compatibility: { ...current.compatibility, notes: event.target.value },
                }))}
                className={`${INPUT_CLASS} resize-y`}
              />
            </Field>
          </div>
        )}

        {step === "rights" && (
          <div id="market-authoring-panel-rights" role="tabpanel" className="space-y-6">
            <SectionTitle
              title="라이선스와 권리 확인"
              description="구매·설치 전에 사용 범위를 구조화하고, 검수 시 원본 권리를 확인합니다."
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="라이선스">
                <select
                  value={normalized.rights.license}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    rights: { ...current.rights, license: event.target.value },
                  }))}
                  className={INPUT_CLASS}
                >
                  <option value="free">무료 사용</option>
                  <option value="personal">개인 사용</option>
                  <option value="commercial">상업 사용</option>
                  <option value="custom">사용자 정의</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                {(["commercialUse", "redistribution", "aiTrainingAllowed", "containsThirdPartyContent"] as const)
                  .map((key) => (
                    <ToggleCard
                      key={key}
                      label={key}
                      checked={normalized.rights[key]}
                      onChange={(checked) => updateDraft((current) => ({
                        ...current,
                        rights: { ...current.rights, [key]: checked },
                      }))}
                    />
                  ))}
              </div>
            </div>
            {normalized.rights.containsThirdPartyContent && (
              <Field label="제3자 콘텐츠 출처·허가">
                <textarea
                  rows={4}
                  value={normalized.rights.thirdPartyAttribution}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    rights: {
                      ...current.rights,
                      thirdPartyAttribution: event.target.value,
                    },
                  }))}
                  className={`${INPUT_CLASS} resize-y`}
                />
              </Field>
            )}
            <div className="space-y-2 rounded-xl border border-line bg-raised/30 p-4">
              <CheckRow
                label="이 에셋을 게시할 권리를 보유하고 있습니다."
                checked={normalized.rights.originalWorkAttested}
                onChange={(checked) => updateDraft((current) => ({
                  ...current,
                  rights: { ...current.rights, originalWorkAttested: checked },
                }))}
              />
              <CheckRow
                label="미리보기 이미지·영상의 게시 권리를 보유하고 있습니다."
                checked={normalized.rights.previewRightsAttested}
                onChange={(checked) => updateDraft((current) => ({
                  ...current,
                  rights: { ...current.rights, previewRightsAttested: checked },
                }))}
              />
            </div>
          </div>
        )}

        {step === "release" && (
          <div id="market-authoring-panel-release" role="tabpanel" className="space-y-6">
            <SectionTitle
              title="버전·검수·배포"
              description="신규 공개와 업데이트를 같은 초안 수명주기로 관리합니다."
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <Field label="배포 방식">
                <select
                  value={normalized.release.mode}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    release: {
                      ...current.release,
                      mode: event.target.value as "new" | "update",
                    },
                  }))}
                  className={INPUT_CLASS}
                >
                  <option value="new">새 리소스</option>
                  <option value="update">기존 리소스 업데이트</option>
                </select>
              </Field>
              <Field label="버전">
                <input
                  value={normalized.release.version}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    release: { ...current.release, version: event.target.value },
                  }))}
                  className={INPUT_CLASS}
                />
              </Field>
              {normalized.release.mode === "update" && (
                <Field label="기존 리소스 ID">
                  <input
                    value={normalized.release.previousResourceId ?? ""}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      release: {
                        ...current.release,
                        previousResourceId: event.target.value || undefined,
                      },
                    }))}
                    className={INPUT_CLASS}
                  />
                </Field>
              )}
            </div>
            <Field label="변경 이력">
              <textarea
                rows={4}
                value={normalized.release.changelog}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  release: { ...current.release, changelog: event.target.value },
                }))}
                className={`${INPUT_CLASS} resize-y`}
              />
            </Field>
            <Field label="이전 버전 마이그레이션 안내">
              <textarea
                rows={3}
                value={normalized.release.migrationNotes}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  release: { ...current.release, migrationNotes: event.target.value },
                }))}
                className={`${INPUT_CLASS} resize-y`}
              />
            </Field>
            <Field label="검수자 참고">
              <textarea
                rows={3}
                value={normalized.reviewNotes}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  reviewNotes: event.target.value,
                }))}
                className={`${INPUT_CLASS} resize-y`}
              />
            </Field>
            <div className="space-y-2" data-testid="market-authoring-diagnostics">
              {diagnostics.length === 0 ? (
                <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm font-semibold text-success">
                  필수 사전 검사를 통과했습니다.
                </div>
              ) : diagnostics.map((diagnostic) => (
                <div
                  key={diagnostic.id}
                  className={`rounded-xl border p-4 ${diagnosticClass(diagnostic)}`}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <strong className="text-sm">{diagnostic.message}</strong>
                    <span className="text-[10px] uppercase tracking-wider">
                      {diagnostic.severity} · {diagnostic.step}
                    </span>
                  </div>
                  <p className="mt-1 text-xs opacity-80">{diagnostic.action}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t border-line bg-raised/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-xs font-medium text-fg-2">{status}</p>
          <p className="mt-1 text-[10px] text-fg-3">
            초안 {normalized.resumeToken.slice(-8)} · 원본 {normalized.source.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadJson(`${normalized.title || "marketplace-draft"}.draft.json`, normalized)}
            className="min-h-11 rounded-lg border border-line bg-card px-4 text-sm font-semibold text-fg"
          >초안 내보내기</button>
          <button
            type="button"
            onClick={() => downloadJson(
              `${normalized.title || "marketplace-asset"}.toonmarket.json`,
              buildCreatorMarketplaceAuthoringManifest(normalized),
            )}
            className="min-h-11 rounded-lg border border-line bg-card px-4 text-sm font-semibold text-fg"
          >패키지 내려받기</button>
          <button
            type="button"
            onClick={applyToForm}
            className="min-h-11 rounded-lg bg-accent px-5 text-sm font-bold text-accent-fg disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="market-authoring-apply"
            disabled={errors.length > 0}
          >등록 폼에 적용</button>
        </div>
      </footer>
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warn" | "ok" | "neutral";
}): ReactElement {
  const toneClass = tone === "danger"
    ? "border-danger/30 bg-danger/5"
    : tone === "warn"
      ? "border-warning/30 bg-warning/5"
      : tone === "ok"
        ? "border-success/30 bg-success/5"
        : "border-line bg-card";
  return (
    <div className={`rounded-xl border p-3 text-center ${toneClass}`}>
      <div className="text-xl font-bold tabular-nums text-fg">{value.toLocaleString()}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-2">
        {label}
      </div>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }): ReactElement {
  return (
    <div>
      <h3 className="text-xl font-bold text-fg">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-fg-2">{description}</p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  compact = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  compact?: boolean;
}): ReactElement {
  return (
    <label className={`block ${compact ? "flex-1" : ""}`}>
      <span className="mb-1.5 block text-sm font-semibold text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-5 text-fg-3">{hint}</span>}
    </label>
  );
}

function SourceCard({
  title,
  description,
  action,
  onClick,
  emphasized = false,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  emphasized?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-36 rounded-xl border p-4 text-left transition-colors motion-reduce:transition-none ${
        emphasized
          ? "border-accent/50 bg-accent/5 hover:bg-accent/10"
          : "border-line bg-card hover:bg-raised"
      }`}
    >
      <strong className="block text-base text-fg">{title}</strong>
      <span className="mt-2 block text-xs leading-5 text-fg-2">{description}</span>
      <span className="mt-4 inline-block text-sm font-bold text-accent">{action} →</span>
    </button>
  );
}

function ToggleCard({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border p-3 text-sm font-semibold ${
      checked ? "border-accent/40 bg-accent/5 text-fg" : "border-line bg-card text-fg-2"
    }`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function EmptyState({ text }: { text: string }): ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-line bg-raised/20 p-8 text-center text-sm text-fg-2">
      {text}
    </div>
  );
}

function KindSpecificEditor({
  draft,
  updateDraft,
}: {
  draft: CreatorMarketplaceAuthoringDraft;
  updateDraft: (
    updater: (current: CreatorMarketplaceAuthoringDraft) => CreatorMarketplaceAuthoringDraft,
  ) => void;
}): ReactElement {
  const fieldsByKind: Readonly<
    Record<Exclude<CreatorMarketplaceAuthoringKind, "brush">, readonly string[]>
  > = {
    tone: ["repeatMode", "dpi", "lineFrequency", "angle", "seamless"],
    palette: ["colorSpace", "swatchCount", "contrastChecked", "printSafe"],
    pose: ["rig", "boneStandard", "cameraPreset", "mirrored"],
    "3d": ["format", "polygonCount", "textureResolution", "unit", "rigged", "lodCount"],
    background: ["width", "height", "dpi", "perspective", "layered"],
    bubble: ["tailVariants", "textInsets", "verticalText", "autoFit"],
    template: ["pageCount", "canvasPreset", "requiredFonts", "guideSet"],
    material: ["contents", "installationTarget", "authoringApp", "portable"],
  };
  const fields = fieldsByKind[
    draft.kind as Exclude<CreatorMarketplaceAuthoringKind, "brush">
  ] ?? [];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => (
        <Field key={field} label={field}>
          <input
            value={String(draft.technical[field] ?? "")}
            onChange={(event) => updateDraft((current) => ({
              ...current,
              technical: { ...current.technical, [field]: event.target.value },
            }))}
            className={INPUT_CLASS}
          />
        </Field>
      ))}
    </div>
  );
}
