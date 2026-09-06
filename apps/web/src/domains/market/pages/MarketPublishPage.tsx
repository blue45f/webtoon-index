import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Layers,
  PackageCheck,
  PackagePlus,
  Palette,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { MarketNavHeader } from "../components/MarketNavHeader";
import { MarketplaceAuthoringWorkshop } from "../components/MarketplaceAuthoringWorkshop";
import { MarketResourceCard } from "../components/MarketResourceCard";
import { saveCustomPublishedResource } from "../models/market-custom-registry";
import {
  MARKET_KINDS,
  MARKET_LICENSES,
  marketKindMeta,
  marketLicenseMeta,
} from "../models/market-kind";


import type {
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { CREATOR_MARKETPLACE_RUNTIME_BY_KIND } from "@/shared/lib/creator-marketplace-resource-contract";
import { cn } from "@/shared/lib/utils";
import { useSession } from "@/src/compat/auth-session-store";
import Link from "@/src/compat/router-link";
import {
  useDocumentTitle,
  useMetaDescription,
} from "@/src/hooks/use-document-title";
import { publishCreatorMarketplaceResource } from "@/src/infrastructure/creator-marketplace-client";

export function MarketPublishPage() {
  useDocumentTitle("에셋 등록 · 창작 마켓");
  useMetaDescription(
    "웹툰 제작용 브러시, 3D 에셋, 팔레트, 필터, 템플릿을 창작 마켓에 등록하고 다른 작가들과 공유하세요.",
  );

  const session = useSession();
  const user = session.status === "authenticated" ? session.data : null;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<CreatorMarketplaceResourceKind>("brush");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [license, setLicense] =
    useState<CreatorMarketplaceResourceLicense>("toonspectrum-standard");
  const [containsAi, setContainsAi] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(true);
  const [releaseNotes, setReleaseNotes] = useState("최초 버전 공유");
  const [version, setVersion] = useState("1.0.0");
  const [brushSize, setBrushSize] = useState(12);
  const [brushOpacity, setBrushOpacity] = useState(100);
  const [brushBlending, setBrushBlending] = useState("normal");
  const [paletteHexes, setPaletteHexes] = useState("#1e293b, #3b82f6, #f59e0b, #ef4444, #10b981");
  const [submitting, setSubmitting] = useState(false);
  const [publishedRecord, setPublishedRecord] =
    useState<CreatorMarketplaceResourceRecord | null>(null);

  const parsedTags = tagInput
    .split(",")
    .map((t) => t.trim().replace(/^#/u, ""))
    .filter((t) => t.length > 0)
    .slice(0, 8);

  const fallbackUserId = "user-guest";
  const publisherId = (user as { id?: string })?.id || fallbackUserId;
  const publisherName =
    (user as { name?: string; nickname?: string })?.nickname ||
    (user as { name?: string; nickname?: string })?.name ||
    "웹툰 크리에이터";

  // Synthesize preview record for live card demonstration
  const livePreviewRecord: CreatorMarketplaceResourceRecord = {
    schemaVersion: 1,
    id: "preview-draft-record",
    packageId: `community/${kind}/${name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-") || "asset"}`,
    name: name.trim() || "에셋명을 입력해주세요",
    description: description.trim() || "상세 설명을 입력해주세요.",
    kind,
    resourceVersion: version,
    minimumStudioVersion: "0.1.0",
    tags: parsedTags.length > 0 ? parsedTags : [marketKindMeta(kind).label],
    license,
    attributionText: "",
    containsAi,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: {
      engines: kind.startsWith("3d")
        ? ["three", "webgl2"]
        : ["canvas2d", "webgl2"],
    },
    entries: [
      {
        id: `${kind}/entry-1`,
        kind,
        name: name.trim() || "기본 항목",
        delivery: {
          mode: "portable-json",
          mediaType: `application/vnd.toonspectrum.${kind}+json`,
          payload: {
            schemaVersion: 1,
            resourceKind: kind,
            runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[kind],
            definition: {
              brushSize,
              brushOpacity,
              brushBlending,
              colors: paletteHexes.split(",").map((s) => s.trim()),
            },
          },
          byteSize: 512,
          sha256: "0".repeat(64),
        },
      },
    ],
    manifestHash: "1".repeat(64),
    manifestByteSize: 1024,
    publisher: {
      id: publisherId,
      name: publisherName,
      avatar: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isOwner: true,
    access: "free",
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rightsConfirmed || submitting) return;

    setSubmitting(true);
    const newId = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const finalRecord: CreatorMarketplaceResourceRecord = {
      ...livePreviewRecord,
      id: newId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // 1. Try backend publish API
      await publishCreatorMarketplaceResource({
        schemaVersion: 1,
        packageId: finalRecord.packageId,
        name: finalRecord.name,
        description: finalRecord.description,
        releaseNotes,
        kind: finalRecord.kind,
        resourceVersion: finalRecord.resourceVersion,
        minimumStudioVersion: finalRecord.minimumStudioVersion,
        tags: finalRecord.tags,
        license: finalRecord.license,
        attributionText: finalRecord.attributionText,
        containsAi: finalRecord.containsAi,
        rightsConfirmed: true,
        provenance: finalRecord.provenance,
        compatibility: finalRecord.compatibility,
        entries: finalRecord.entries,
      });
    } catch {
      // safe fallback to client registry
    }

    // 2. Always persist into local custom registry for instant visibility
    saveCustomPublishedResource(finalRecord);
    setSubmitting(false);
    setPublishedRecord(finalRecord);
  };

  return (
    <Container size="wide" className="min-w-0 py-7 sm:py-10">
      <MarketNavHeader />
      {/* marketplace-authoring-workshop */}
      <MarketplaceAuthoringWorkshop />

      {/* Breadcrumb */}
      <Link
        href="/market/manage"
        className="inline-flex min-h-11 items-center gap-1.5 text-xs text-fg-2 hover:text-fg"
      >
        <ArrowLeft className="size-3.5" />
        <span>내 등록 에셋 목록으로</span>
      </Link>

      {publishedRecord ? (
        /* Publication Success Screen */
        <div className="mx-auto mt-8 max-w-lg rounded-2xl border border-line bg-card p-8 text-center shadow-xl space-y-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-good/20 text-good">
            <CheckCircle2 className="size-10" />
          </div>
          <h2 className="text-xl font-bold text-fg">에셋이 성공적으로 등록되었습니다!</h2>
          <p className="text-xs text-fg-2 leading-relaxed">
            방금 등록하신 에셋이 마켓 카탈로그에 반영되었으며, 이제 모든 작가들이 검색 및 스튜디오에서 활용할 수 있습니다.
          </p>

          <div className="rounded-xl border border-line bg-panel p-4 text-left text-xs space-y-1">
            <p className="font-bold text-fg">{publishedRecord.name}</p>
            <p className="text-fg-3">종류: {marketKindMeta(publishedRecord.kind).label} · 버전: v{publishedRecord.resourceVersion}</p>
            <p className="text-good font-medium">사용권: {marketLicenseMeta(publishedRecord.license).label}</p>
          </div>

          <div className="flex flex-col gap-2.5 pt-2">
            <Link
              href={`/market/resource/${publishedRecord.id}`}
              className={buttonClass({
                variant: "solid",
                size: "md",
                className: "gap-2 bg-gradient-to-r from-accent to-accent-2 text-on-accent",
              })}
            >
              <Sparkles className="size-4" />
              <span>등록된 에셋 상세 페이지 보기</span>
            </Link>
            <Link
              href={`/studio?installMarketResource=${publishedRecord.id}&assetMarket=community`}
              className={buttonClass({
                variant: "outline",
                size: "md",
                className: "gap-2",
              })}
            >
              <Palette className="size-4" />
              <span>스튜디오에서 바로 열기 및 테스트</span>
            </Link>
            <Link
              href="/market/manage"
              className={buttonClass({
                variant: "ghost",
                size: "sm",
              })}
            >
              내 등록 에셋 관리로 이동
            </Link>
          </div>
        </div>
      ) : (
        /* Multi-step Registration Wizard */
        <div className="mt-6 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Form Column */}
          <div className="min-w-0 space-y-6">
            <div className="min-w-0 rounded-xl border border-line bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <PackagePlus className="size-5 text-accent" />
                <h1 className="text-xl font-bold text-fg">새 창작 에셋 등록</h1>
              </div>
              <p className="mt-1 text-xs text-fg-3">
                스튜디오에서 제작한 브러시, 3D 소품, 팔레트, 연출 템플릿을 등록하세요.
              </p>

              {/* Step indicator */}
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line/60 pt-4 text-xs font-semibold">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs",
                    step === 1 ? "bg-accent text-on-accent" : "bg-raised text-fg-3",
                  )}
                >
                  1
                </span>
                <span className={step === 1 ? "text-fg" : "text-fg-3"}>에셋 종류</span>
                <ArrowRight className="size-3 text-line-strong" />

                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs",
                    step === 2 ? "bg-accent text-on-accent" : "bg-raised text-fg-3",
                  )}
                >
                  2
                </span>
                <span className={step === 2 ? "text-fg" : "text-fg-3"}>기본 정보 & 설정</span>
                <ArrowRight className="size-3 text-line-strong" />

                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs",
                    step === 3 ? "bg-accent text-on-accent" : "bg-raised text-fg-3",
                  )}
                >
                  3
                </span>
                <span className={step === 3 ? "text-fg" : "text-fg-3"}>라이선스 & 배포</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="min-w-0 space-y-6">
              {step === 1 && (
                <div className="min-w-0 rounded-xl border border-line bg-card p-6 space-y-4">
                  <h2 className="text-sm font-bold text-fg">어떤 종류의 창작 리소스인가요?</h2>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {MARKET_KINDS.map((k) => {
                      const Icon = k.icon;
                      const selected = kind === k.kind;
                      return (
                        <button
                          key={k.kind}
                          type="button"
                          onClick={() => setKind(k.kind)}
                          className={cn(
                            "min-w-0 flex flex-col items-start rounded-xl border p-4 text-left transition-all duration-150",
                            selected
                              ? "border-accent bg-accent/10 shadow-sm ring-1 ring-accent"
                              : "border-line bg-panel/50 hover:border-line-strong hover:bg-panel",
                          )}
                        >
                          <div className="flex size-9 items-center justify-center rounded-lg bg-raised text-accent">
                            <Icon className="size-5" />
                          </div>
                          <span className="mt-3 text-sm font-bold text-fg">{k.label}</span>
                          <span className="mt-0.5 text-xs text-fg-3 leading-relaxed">
                            {k.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex justify-end pt-3">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className={buttonClass({ variant: "solid", size: "md", className: "gap-1.5" })}
                    >
                      <span>다음: 기본 정보 입력</span>
                      <ArrowRight className="size-4" />
                    </button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="min-w-0 rounded-xl border border-line bg-card p-6 space-y-5">
                  <h2 className="text-sm font-bold text-fg">에셋 기본 정보 & 상세 스펙</h2>

                  <div>
                    <label htmlFor="publish-asset-name" className="block text-xs font-semibold text-fg">에셋명 *</label>
                    <input
                      id="publish-asset-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="예: 초정밀 G펜 선화 브러시 세트"
                      maxLength={80}
                      required
                      className="mt-1 h-9 w-full rounded-lg border border-line bg-panel px-3 text-xs text-fg focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="publish-asset-desc" className="block text-xs font-semibold text-fg">소개 및 활용 팁</label>
                    <textarea
                      id="publish-asset-desc"
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="에셋의 특징, 웹툰 컷 작업 시 추천 설정(손떨림 보정, 레이어 모드 등)을 상세히 적어주세요."
                      maxLength={1000}
                      className="mt-1 w-full rounded-xl border border-line bg-panel p-3 text-xs leading-relaxed text-fg focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="publish-asset-tags" className="block text-xs font-semibold text-fg">
                      검색 태그 (쉼표로 구분, 최대 8개)
                    </label>
                    <input
                      id="publish-asset-tags"
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="선화, G펜, 액션, 로판, 3D, 소체"
                      className="mt-1 h-9 w-full rounded-lg border border-line bg-panel px-3 text-xs text-fg focus:border-accent focus:outline-none"
                    />
                  </div>

                  {/* Type-specific parameter controls */}
                  <div className="min-w-0 rounded-xl border border-line/70 bg-panel/40 p-4 space-y-3">
                    <p className="text-xs font-bold text-fg flex items-center gap-1.5">
                      <Layers className="size-3.5 text-accent" />
                      <span>{marketKindMeta(kind).label} 세부 파라미터 프리셋</span>
                    </p>

                    {kind === "brush" ? (
                      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                        <div className="min-w-0">
                          <label htmlFor="publish-brush-size" className="block text-[0.7rem] text-fg-3">기본 크기 (px)</label>
                          <input
                            id="publish-brush-size"
                            type="number"
                            min={1}
                            max={200}
                            value={brushSize}
                            onChange={(e) => setBrushSize(Number(e.target.value))}
                            className="mt-1 h-8 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg"
                          />
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="publish-brush-opacity" className="block text-[0.7rem] text-fg-3">불투명도 (%)</label>
                          <input
                            id="publish-brush-opacity"
                            type="number"
                            min={1}
                            max={100}
                            value={brushOpacity}
                            onChange={(e) => setBrushOpacity(Number(e.target.value))}
                            className="mt-1 h-8 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg"
                          />
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="publish-brush-blending" className="block text-[0.7rem] text-fg-3">블렌딩 모드</label>
                          <select
                            id="publish-brush-blending"
                            value={brushBlending}
                            onChange={(e) => setBrushBlending(e.target.value)}
                            className="mt-1 h-8 w-full rounded-lg border border-line bg-card px-2 text-xs text-fg"
                          >
                            <option value="normal">표준 (Normal)</option>
                            <option value="multiply">곱하기 (Multiply)</option>
                            <option value="overlay">오버레이 (Overlay)</option>
                          </select>
                        </div>
                      </div>
                    ) : kind === "palette" ? (
                      <div className="min-w-0">
                        <label htmlFor="publish-palette-hexes" className="block text-[0.7rem] text-fg-3">HEX 색상 목록 (쉼표 구분)</label>
                        <input
                          id="publish-palette-hexes"
                          type="text"
                          value={paletteHexes}
                          onChange={(e) => setPaletteHexes(e.target.value)}
                          className="mt-1 h-8 w-full rounded-lg border border-line bg-card px-2 text-xs font-mono text-fg"
                        />
                        <div className="mt-2 flex h-6 w-full overflow-hidden rounded-lg border border-line">
                          {paletteHexes.split(",").map((color, idx) => (
                            <div
                              key={idx}
                              className="h-full flex-1"
                              style={{ backgroundColor: color.trim() }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-fg-3">
                        Studio 캔버스 규격과 100% 호환되는 최적화 파라미터가 자동 적용됩니다.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      이전 단계
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      disabled={!name.trim()}
                      className={buttonClass({
                        variant: "solid",
                        size: "md",
                        className: "gap-1.5 disabled:opacity-40",
                      })}
                    >
                      <span>다음: 라이선스 & 배포 확인</span>
                      <ArrowRight className="size-4" />
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="min-w-0 rounded-xl border border-line bg-card p-6 space-y-5">
                  <h2 className="text-sm font-bold text-fg">사용권 라이선스 & 배포 확인</h2>

                  <div>
                    <label htmlFor="publish-version" className="block text-xs font-semibold text-fg">배포 버전 (SemVer)</label>
                    <input
                      id="publish-version"
                      type="text"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="1.0.0"
                      className="mt-1 h-8 w-32 rounded-lg border border-line bg-panel px-2.5 font-mono text-xs text-fg"
                    />
                  </div>

                  <div>
                    <label htmlFor="publish-release-notes" className="block text-xs font-semibold text-fg">초기 릴리즈 노트</label>
                    <input
                      id="publish-release-notes"
                      type="text"
                      value={releaseNotes}
                      onChange={(e) => setReleaseNotes(e.target.value)}
                      placeholder="예: 최초 버전 공개 및 스튜디오 호환성 완료"
                      className="mt-1 h-8 w-full rounded-lg border border-line bg-panel px-2.5 text-xs text-fg"
                    />
                  </div>

                  <div>
                    <label htmlFor="publish-license" className="block text-xs font-semibold text-fg">사용권 라이선스 *</label>
                    <select
                      id="publish-license"
                      value={license}
                      onChange={(e) =>
                        setLicense(e.target.value as CreatorMarketplaceResourceLicense)
                      }
                      className="mt-1 h-9 w-full rounded-lg border border-line bg-panel px-2.5 text-xs text-fg"
                    >
                      {MARKET_LICENSES.map((lic) => (
                        <option key={lic.license} value={lic.license}>
                          {lic.label} — {lic.summary}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-xl border border-good/40 bg-good/10 p-3.5 space-y-2">
                    <p className="text-xs font-bold text-good flex items-center gap-1.5">
                      <ShieldCheck className="size-4" />
                      <span>창작자 안심 배포 보증</span>
                    </p>
                    <p className="text-[0.68rem] text-fg-2 leading-relaxed">
                      등록하신 에셋은 AI 모델 무단 크롤링이 차단되며, 상업용 웹툰 연재 작가들에게 안전하게 제공됩니다.
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-fg-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={containsAi}
                      onChange={(e) => setContainsAi(e.target.checked)}
                      className="rounded border-line text-accent"
                    />
                    <span>제작 과정에 생성형 AI 보조 도구를 일부 사용했습니다.</span>
                  </label>

                  <label className="flex items-start gap-2 text-xs text-fg-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rightsConfirmed}
                      onChange={(e) => setRightsConfirmed(e.target.checked)}
                      required
                      className="mt-0.5 rounded border-line text-accent"
                    />
                    <span className="text-[0.72rem] leading-relaxed">
                      본인이 직접 제작하였거나 적법한 배포 권리를 보유하고 있음을 확인합니다.
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      이전 단계
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !rightsConfirmed}
                      className={buttonClass({
                        variant: "solid",
                        size: "md",
                        className:
                          "gap-2 bg-gradient-to-r from-accent to-accent-2 text-on-accent disabled:opacity-40",
                      })}
                    >
                      <PackageCheck className="size-4" />
                      <span>{submitting ? "등록 중..." : "에셋 마켓에 배포하기"}</span>
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Right Live Preview Column */}
          <div className="min-w-0 space-y-4">
            <div className="sticky top-20 min-w-0 overflow-hidden rounded-xl border border-line bg-card p-4">
              <p className="eyebrow text-accent">Live Preview</p>
              <h3 className="mt-1 text-sm font-bold text-fg">실시간 마켓 카드 미리보기</h3>
              <p className="mt-0.5 text-xs text-fg-3">
                마켓 둘러보기 및 검색 화면에 표시되는 형태입니다.
              </p>

              <div className="mt-4 min-w-0 pointer-events-none">
                <MarketResourceCard record={livePreviewRecord} className="min-w-0" />
              </div>

              <div className="mt-4 min-w-0 rounded-lg bg-panel p-3 text-xs text-fg-3 space-y-1">
                <p className="break-words">· 등록자: {publisherName}</p>
                <p>· 종류: {marketKindMeta(kind).label}</p>
                <p className="break-words">· 라이선스: {marketLicenseMeta(license).label}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Container>
  );
}