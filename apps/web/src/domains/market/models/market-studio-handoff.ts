import type {
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

export type MarketStudioHandoffMode =
  | "insert-current-canvas"
  | "open-template-catalog"
  | "open-3d-background-catalog"
  | "open-3d-asset-library"
  | "install-tool-pack";

export interface MarketStudioHandoff {
  readonly href: string;
  readonly mode: MarketStudioHandoffMode;
  readonly actionLabel: string;
  readonly destinationLabel: string;
  readonly summary: string;
  readonly completionEvidence: string;
}

const HANDOFF_BY_KIND: Readonly<
  Record<CreatorMarketplaceResourceKind, Omit<MarketStudioHandoff, "href">>
> = {
  asset: {
    mode: "insert-current-canvas",
    actionLabel: "스튜디오 캔버스에 에셋 삽입",
    destinationLabel: "현재 캔버스 · 에셋 레이어",
    summary:
      "Studio 커뮤니티 마켓에서 이 릴리스를 확인한 뒤 지원되는 첫 에셋을 현재 캔버스에 삽입합니다.",
    completionEvidence:
      "캔버스 레이어 생성과 에셋 배치가 성공해야 완료로 표시됩니다.",
  },
  brush: {
    mode: "install-tool-pack",
    actionLabel: "스튜디오에 브러시 팩 설치",
    destinationLabel: "브러시 도구 라이브러리",
    summary:
      "이 릴리스의 브러시 정의를 검증해 로컬 도구 라이브러리에 설치하거나 최신 버전으로 갱신합니다.",
    completionEvidence:
      "Studio 설치 영수증이 같은 패키지·버전·매니페스트 해시로 기록되어야 완료됩니다.",
  },
  filter: {
    mode: "install-tool-pack",
    actionLabel: "스튜디오에 필터 팩 설치",
    destinationLabel: "필터 도구 라이브러리",
    summary:
      "이 릴리스의 필터 정의를 검증해 로컬 필터 라이브러리에 설치하거나 최신 버전으로 갱신합니다.",
    completionEvidence:
      "Studio 설치 영수증이 같은 패키지·버전·매니페스트 해시로 기록되어야 완료됩니다.",
  },
  palette: {
    mode: "install-tool-pack",
    actionLabel: "스튜디오에 팔레트 팩 설치",
    destinationLabel: "색상 팔레트 라이브러리",
    summary:
      "이 릴리스의 팔레트를 검증해 Studio 색상 라이브러리에 설치하거나 최신 버전으로 갱신합니다.",
    completionEvidence:
      "Studio 설치 영수증이 같은 패키지·버전·매니페스트 해시로 기록되어야 완료됩니다.",
  },
  template: {
    mode: "open-template-catalog",
    actionLabel: "장면 템플릿 카탈로그 열기",
    destinationLabel: "장면 템플릿 카탈로그",
    summary:
      "Studio의 장면 템플릿 카탈로그를 이 패키지 계열로 열며, 사용자가 장면 카드를 선택해야 현재 컷에 적용됩니다.",
    completionEvidence:
      "카탈로그를 연 것과 컷에 템플릿을 적용한 것은 별도 상태로 처리됩니다.",
  },
  "3d-preset": {
    mode: "open-3d-background-catalog",
    actionLabel: "3D 배경 카탈로그 열기",
    destinationLabel: "3D 배경·절차형 장면 카탈로그",
    summary:
      "Studio 3D 배경 카탈로그를 이 패키지 계열로 열며, 항목을 선택해야 현재 장면에 추가됩니다.",
    completionEvidence:
      "카탈로그를 연 것과 3D 장면 노드를 추가한 것은 별도 상태로 처리됩니다.",
  },
  "3d-asset": {
    mode: "open-3d-asset-library",
    actionLabel: "3D 에셋 라이브러리 열기",
    destinationLabel: "3D 모델·소품 라이브러리",
    summary:
      "Studio 3D 에셋 라이브러리를 이 릴리스로 열어 모델이나 소품을 현재 장면에 직접 배치할 수 있습니다.",
    completionEvidence:
      "라이브러리를 연 것과 3D 오브젝트를 장면에 배치한 것은 별도 상태로 처리됩니다.",
  },
};

export function marketStudioResourceHref(resourceId: string): string {
  return `/studio?installMarketResource=${encodeURIComponent(
    resourceId,
  )}&assetMarket=community`;
}

export function marketStudioHandoff(
  record: Pick<CreatorMarketplaceResourceRecord, "id" | "kind">,
): MarketStudioHandoff {
  return {
    href: marketStudioResourceHref(record.id),
    ...HANDOFF_BY_KIND[record.kind],
  };
}
