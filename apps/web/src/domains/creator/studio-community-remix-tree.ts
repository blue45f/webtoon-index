/**
 * Studio Community Remix Tree & Official IP Sandbox — 원작-2차창작 계보 DAG 트리,
 * 공식 IP 샌드박스 라이선스 제약, 원작자 자동 크레딧 및 수익 분배(Revenue Split) 코어.
 *
 * 마스터플랜 13.7 (Community Remix Tree·Official IP Sandbox), 21장 생태계 & 997개 기능 갭:
 * - 원작 → 리믹스 2차/N차 파생 작품 계보(Genealogy Tree DAG)
 * - 공식 IP 샌드박스 (허용 캐릭터/의상/소품, 금지된 조합, 자동 워터마크 규칙)
 * - 상업/비상업 라이선스 범위, 동일조건 변경허락(Share-Alike)
 * - 원작자·리믹서·번역가 간 자동 수익 분배(Revenue Split Calculator)
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_REMIX_TREE_VERSION = 1 as const;

export type RemixDerivativeType =
  | "fan-derivative"
  | "official-spin-off"
  | "localization"
  | "parody"
  | "remake";

export interface RevenueShareParticipant {
  readonly recipientUserId: string;
  readonly role: "original-creator" | "remixer" | "translator" | "publisher";
  readonly shareRatio: number; // 0..1 (합계 1.0)
}

export interface RemixWorkNode {
  readonly workId: string;
  readonly title: string;
  readonly authorUserId: string;
  readonly parentWorkId?: string;
  readonly depthLevel: number;
  readonly derivativeType: RemixDerivativeType;
  readonly attributionCredit: string;
  readonly isCommercialAllowed: boolean;
  readonly revenueShares: readonly RevenueShareParticipant[];
  readonly createdAtMs: number;
}

export interface OfficialIpSandboxRule {
  readonly officialIpId: string;
  readonly ipName: string;
  readonly allowedCharacterIds: readonly string[];
  readonly allowedCostumeIds: readonly string[];
  readonly prohibitedKeywords: readonly string[];
  readonly mandatoryWatermark: string;
}

export interface StudioCommunityRemixTree {
  readonly version: typeof STUDIO_REMIX_TREE_VERSION;
  readonly id: string;
  readonly rootWorkId: string;
  readonly nodes: readonly RemixWorkNode[];
  readonly sandboxRules?: readonly OfficialIpSandboxRule[];
}

export interface IpConstraintViolation {
  readonly code: "PROHIBITED_COMBINATION" | "UNAUTHORIZED_CHARACTER" | "MISSING_WATERMARK";
  readonly message: string;
}

export function createCommunityRemixTree(params: {
  id: string;
  rootWork: Omit<RemixWorkNode, "depthLevel" | "parentWorkId">;
  sandboxRules?: readonly OfficialIpSandboxRule[];
}): StudioCommunityRemixTree {
  const rootNode: RemixWorkNode = Object.freeze({
    ...params.rootWork,
    depthLevel: 0,
    parentWorkId: undefined,
  });

  return Object.freeze({
    version: STUDIO_REMIX_TREE_VERSION,
    id: params.id.trim(),
    rootWorkId: rootNode.workId,
    nodes: Object.freeze([rootNode]),
    sandboxRules: params.sandboxRules ? Object.freeze([...params.sandboxRules]) : undefined,
  });
}

export function addRemixDerivative(
  tree: StudioCommunityRemixTree,
  parentWorkId: string,
  derivative: Omit<RemixWorkNode, "depthLevel" | "parentWorkId">,
): StudioCommunityRemixTree {
  const parent = tree.nodes.find((n) => n.workId === parentWorkId);
  if (!parent) {
    throw new Error(`Parent work ${parentWorkId} not found in remix tree`);
  }
  if (tree.nodes.some((n) => n.workId === derivative.workId)) {
    throw new Error(`Work ${derivative.workId} already exists in tree`);
  }

  const newNode: RemixWorkNode = Object.freeze({
    ...derivative,
    parentWorkId,
    depthLevel: parent.depthLevel + 1,
  });

  return {
    ...tree,
    nodes: Object.freeze([...tree.nodes, newNode]),
  };
}

/**
 * 공식 IP 샌드박스 규약 위반 여부를 검사한다.
 */
export function validateIpSandboxRules(
  work: { charactersUsed: readonly string[]; synopsis: string; watermark?: string },
  rule: OfficialIpSandboxRule,
): readonly IpConstraintViolation[] {
  const violations: IpConstraintViolation[] = [];

  // 1. 허용되지 않은 캐릭터 사용 검사
  for (const charId of work.charactersUsed) {
    if (!rule.allowedCharacterIds.includes(charId)) {
      violations.push({
        code: "UNAUTHORIZED_CHARACTER",
        message: `공식 IP '${rule.ipName}'에서 2차 창작이 허용되지 않은 캐릭터(${charId})가 사용되었습니다.`,
      });
    }
  }

  // 2. 금지된 키워드/조합 검사
  const lowerSynopsis = work.synopsis.toLowerCase();
  for (const kw of rule.prohibitedKeywords) {
    if (lowerSynopsis.includes(kw.toLowerCase())) {
      violations.push({
        code: "PROHIBITED_COMBINATION",
        message: `공식 IP 가이드라인에 의해 금지된 키워드/소재('${kw}')가 감지되었습니다.`,
      });
    }
  }

  return Object.freeze(violations);
}

/**
 * 총 매출액에 대해 원작자, 리믹서 등의 수익 분배 정산액을 계산한다.
 */
export function calculateRevenueDistribution(
  node: RemixWorkNode,
  grossRevenueKrw: number,
): readonly { readonly recipientUserId: string; readonly role: string; readonly amountKrw: number }[] {
  return Object.freeze(
    node.revenueShares.map((share) =>
      Object.freeze({
        recipientUserId: share.recipientUserId,
        role: share.role,
        amountKrw: Math.round(grossRevenueKrw * share.shareRatio),
      }),
    ),
  );
}
