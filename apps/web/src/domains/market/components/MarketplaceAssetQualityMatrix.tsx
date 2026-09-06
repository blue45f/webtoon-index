import { useMemo, type ReactElement } from "react";

import {
  normalizeCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringKind,
} from "@/shared/lib/creator-marketplace-authoring-workshop";

interface QualityScenario {
  id: string;
  label: string;
  description: string;
  required: boolean;
}

const QUALITY_SCENARIOS: Readonly<Record<CreatorMarketplaceAuthoringKind, readonly QualityScenario[]>> = {
  brush: [
    { id: "brush-fast-slow", label: "빠른·느린 선", description: "속도 변화에서 간격·불투명도·형태 유지", required: true },
    { id: "brush-pressure", label: "필압 전 구간", description: "최소·중간·최대 필압 곡선", required: true },
    { id: "brush-crossing", label: "교차·급코너", description: "겹침과 방향 반전에서 끊김 확인", required: true },
    { id: "brush-input", label: "마우스·터치·펜", description: "지원 입력 장치별 결과", required: false },
    { id: "brush-zoom", label: "25–400% 확대", description: "미리보기와 커밋 결과 일치", required: false },
  ],
  tone: [
    { id: "tone-seam", label: "반복 이음새", description: "가로·세로·대각선 타일 경계", required: true },
    { id: "tone-dpi", label: "DPI·선수", description: "웹툰·인쇄 해상도별 모아레", required: true },
    { id: "tone-transform", label: "회전·스케일", description: "확대·회전 후 반복 주기", required: false },
    { id: "tone-alpha", label: "투명도·마스크", description: "알파 경계와 합성 모드", required: false },
  ],
  palette: [
    { id: "palette-space", label: "색공간", description: "sRGB·Display-P3·CMYK 변환 정보", required: true },
    { id: "palette-contrast", label: "명도·대비", description: "전경·배경 조합의 읽기성", required: true },
    { id: "palette-vision", label: "색각 다양성", description: "주요 색각 조건에서 구분성", required: false },
    { id: "palette-print", label: "인쇄 안전", description: "잉크 한계와 색역 경고", required: false },
  ],
  pose: [
    { id: "pose-rig", label: "리그 표준", description: "본 이름·축·계층·휴머노이드 매핑", required: true },
    { id: "pose-mirror", label: "좌우 반전", description: "비대칭 포즈와 손·발 방향", required: true },
    { id: "pose-camera", label: "카메라 각도", description: "정면·측면·로우·하이 앵글", required: false },
    { id: "pose-limits", label: "관절 한계", description: "과신전·자기 관통 확인", required: false },
  ],
  "3d": [
    { id: "3d-scale", label: "단위·실제 스케일", description: "m·cm·mm와 Studio 장면 크기", required: true },
    { id: "3d-material", label: "재질·텍스처", description: "누락 맵·색공간·알파·압축", required: true },
    { id: "3d-lod", label: "LOD·폴리곤", description: "단계별 실루엣과 메모리 예산", required: true },
    { id: "3d-turntable", label: "턴테이블", description: "전 방향 형상·노멀·그림자", required: false },
    { id: "3d-rig", label: "리그·애니메이션", description: "본·스킨·클립·루트 모션", required: false },
    { id: "3d-webgpu", label: "WebGL2·WebGPU", description: "렌더 백엔드별 시각 결과", required: false },
  ],
  background: [
    { id: "background-scroll", label: "세로 스크롤", description: "긴 웹툰 캔버스에서 이음새·메모리", required: true },
    { id: "background-perspective", label: "원근·카메라", description: "소실점과 캐릭터 스케일", required: true },
    { id: "background-layers", label: "레이어 구조", description: "전경·중경·후경·선화 분리", required: false },
    { id: "background-night", label: "시간·조명 변형", description: "낮·밤·색조 변경 가능성", required: false },
  ],
  bubble: [
    { id: "bubble-fit", label: "자동 텍스트 맞춤", description: "짧은·긴 문장과 줄바꿈", required: true },
    { id: "bubble-vertical", label: "세로쓰기·루비", description: "한·일 세로 문장과 보조 발음", required: true },
    { id: "bubble-tail", label: "꼬리 변형", description: "방향·길이·다중 화자", required: false },
    { id: "bubble-scale", label: "확대·왜곡", description: "테두리 두께와 텍스트 인셋", required: false },
  ],
  template: [
    { id: "template-pages", label: "페이지·컷 구조", description: "페이지 수·마스터·컷 순서", required: true },
    { id: "template-fonts", label: "폰트 종속성", description: "누락 폰트와 대체 규칙", required: true },
    { id: "template-guides", label: "가이드·재단선", description: "웹툰·인쇄 프리셋 안전 영역", required: false },
    { id: "template-assets", label: "연결 에셋", description: "톤·말풍선·팔레트·3D 의존성", required: false },
  ],
  material: [
    { id: "material-install", label: "설치 위치", description: "브러시·톤·팔레트·템플릿별 대상", required: true },
    { id: "material-dependencies", label: "종속성", description: "필수·선택 패키지와 버전 범위", required: true },
    { id: "material-conflict", label: "이름·ID 충돌", description: "기존 설치와 안전한 병합", required: false },
    { id: "material-uninstall", label: "제거·복구", description: "삭제 후 문서와 참조 동작", required: false },
  ],
};

function selectedChecks(draft: CreatorMarketplaceAuthoringDraft): readonly string[] {
  const value = draft.technical.qualityScenarios;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function MarketplaceAssetQualityMatrix({
  draft: draftInput,
  onChange,
}: {
  draft: CreatorMarketplaceAuthoringDraft;
  onChange: (draft: CreatorMarketplaceAuthoringDraft) => void;
}): ReactElement {
  const draft = useMemo(
    () => normalizeCreatorMarketplaceAuthoringDraft(draftInput),
    [draftInput],
  );
  const scenarios = QUALITY_SCENARIOS[draft.kind];
  const selected = selectedChecks(draft);
  const required = scenarios.filter((scenario) => scenario.required);
  const requiredSelected = required.filter((scenario) => selected.includes(scenario.id)).length;
  const completion = required.length === 0
    ? 100
    : Math.round((requiredSelected / required.length) * 100);

  const toggle = (scenario: QualityScenario): void => {
    const next = selected.includes(scenario.id)
      ? selected.filter((id) => id !== scenario.id)
      : [...selected, scenario.id];
    onChange(normalizeCreatorMarketplaceAuthoringDraft({
      ...draft,
      technical: {
        ...draft.technical,
        qualityScenarios: next,
      },
    }));
  };

  return (
    <section
      data-testid="market-asset-quality-matrix"
      className="rounded-2xl border border-line bg-raised/25 p-4 sm:p-5"
      aria-labelledby="market-asset-quality-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 id="market-asset-quality-heading" className="text-base font-bold text-fg">
            {draft.kind === "brush" ? "브러시" : "에셋"} 품질 시나리오
          </h4>
          <p className="mt-1 text-xs leading-5 text-fg-2">
            완료로 선택한 항목은 미리보기와 검수 계획에 포함됩니다. 실제 자동 검증 결과와 혼동하지 않습니다.
          </p>
        </div>
        <div className="min-w-28 rounded-xl border border-line bg-card px-3 py-2 text-right">
          <span className="block text-[10px] uppercase tracking-wider text-fg-3">필수 계획</span>
          <strong className="text-xl tabular-nums text-fg">{completion}%</strong>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((scenario) => {
          const active = selected.includes(scenario.id);
          return (
            <button
              key={scenario.id}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(scenario)}
              className={`min-h-24 rounded-xl border p-3 text-left transition-colors motion-reduce:transition-none ${
                active
                  ? "border-accent/50 bg-accent/5"
                  : "border-line bg-card hover:bg-raised"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <strong className="text-sm text-fg">{scenario.label}</strong>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                  scenario.required ? "bg-warning/15 text-fg" : "bg-raised text-fg-2"
                }`}>
                  {scenario.required ? "필수" : "권장"}
                </span>
              </span>
              <span className="mt-2 block text-[11px] leading-4 text-fg-2">
                {scenario.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
