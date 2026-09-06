/**
 * AI execution preflight — a truthful, local-only description of what would
 * happen when the active assist tool runs.
 *
 * This module deliberately performs no provider lookup, network request,
 * credential access, or model execution. Keep it safe to call during render.
 */
import { STUDIO_AI_ASSIST_TOOLS, type StudioAiAssistToolId } from "./studio-ai-assist-ux";

export const STUDIO_AI_EXECUTION_COST_CATEGORIES = [
  "로컬 0원",
  "제공자 과금 가능",
  "서버 쿼터",
] as const;

export type StudioAiExecutionCostCategory =
  (typeof STUDIO_AI_EXECUTION_COST_CATEGORIES)[number];

export type StudioAiExecutionTimeCategory = "짧음" | "보통" | "길 수 있음";

export interface StudioAiExecutionPreflightInput {
  activeTool: StudioAiAssistToolId;
  imageConfigured: boolean;
  textConfigured: boolean;
  connectionLabel: string;
  connectionOk: boolean;
}

export interface StudioAiExecutionPreflight {
  toolId: StudioAiAssistToolId;
  toolLabel: string;
  available: boolean;
  unavailableReason: string | null;
  processingRoute: string;
  externalTransfer: boolean;
  externalTransferLabel: string;
  costCategory: StudioAiExecutionCostCategory;
  estimatedTimeCategory: StudioAiExecutionTimeCategory;
  estimatedTimeLabel: string;
  outputCount: number;
  outputCountLabel: string;
  fallbackRetryPolicy: string;
  sourceNonDestructivePolicy: string;
  connectionLabel: string;
}

type RequiredConnection = "image" | "text";

interface StudioAiExecutionToolSpec {
  requiredConnection: RequiredConnection;
  processingRoute: string;
  externalTransferLabel: string;
  estimatedTimeCategory: StudioAiExecutionTimeCategory;
  estimatedTimeLabel: string;
  outputCount: number;
  outputCountLabel: string;
  sourceNonDestructivePolicy: string;
}

const TOOL_SPECS: Readonly<Record<StudioAiAssistToolId, StudioAiExecutionToolSpec>> = {
  background: {
    requiredConnection: "image",
    processingRoute: "프롬프트 → 연결된 외부 이미지 모델 → 새 배경 이미지 요소",
    externalTransferLabel: "실행 시 배경 프롬프트를 연결된 이미지 제공자에 전송",
    estimatedTimeCategory: "보통",
    estimatedTimeLabel: "이미지 생성",
    outputCount: 1,
    outputCountLabel: "배경 이미지 1개",
    sourceNonDestructivePolicy: "원본 캔버스를 덮어쓰지 않고 새 이미지 요소로 추가",
  },
  character: {
    requiredConnection: "image",
    processingRoute: "프롬프트·선택 참고 이미지 → 연결된 외부 이미지 모델 → 새 캐릭터 이미지 요소",
    externalTransferLabel: "실행 시 프롬프트와 선택한 참고 이미지를 이미지 제공자에 전송",
    estimatedTimeCategory: "보통",
    estimatedTimeLabel: "참고 이미지 기반 생성",
    outputCount: 1,
    outputCountLabel: "캐릭터 이미지 1개",
    sourceNonDestructivePolicy: "참고 이미지와 원본 캔버스를 바꾸지 않고 새 이미지 요소로 추가",
  },
  composition: {
    requiredConnection: "text",
    processingRoute: "콘티 문장 → 연결된 외부 텍스트 모델 → 구도 제안",
    externalTransferLabel: "실행 시 입력한 콘티 문장을 연결된 텍스트 제공자에 전송",
    estimatedTimeCategory: "짧음",
    estimatedTimeLabel: "텍스트 제안",
    outputCount: 1,
    outputCountLabel: "구도 제안 1세트",
    sourceNonDestructivePolicy: "캔버스를 자동 변경하지 않고 적용 전 검토할 제안만 제공",
  },
  dialogue: {
    requiredConnection: "text",
    processingRoute: "상황 설명 → 연결된 외부 텍스트 모델 → 대사 제안",
    externalTransferLabel: "실행 시 입력한 상황 설명을 연결된 텍스트 제공자에 전송",
    estimatedTimeCategory: "짧음",
    estimatedTimeLabel: "텍스트 제안",
    outputCount: 1,
    outputCountLabel: "대사 제안 1세트",
    sourceNonDestructivePolicy: "기존 대사를 자동 변경하지 않고 적용 전 검토할 제안만 제공",
  },
  palette: {
    requiredConnection: "text",
    processingRoute: "분위기 문장 → 연결된 외부 텍스트 모델 → 팔레트 제안",
    externalTransferLabel: "실행 시 입력한 분위기 문장을 연결된 텍스트 제공자에 전송",
    estimatedTimeCategory: "짧음",
    estimatedTimeLabel: "색 조합 제안",
    outputCount: 1,
    outputCountLabel: "팔레트 제안 1세트",
    sourceNonDestructivePolicy: "작품 색상을 자동 변경하지 않고 적용 전 검토할 팔레트만 제공",
  },
};

const FALLBACK_RETRY_POLICY =
  "자동 fallback·자동 재시도 없음 · 실패 내용을 확인한 뒤 수동 재시도";

const IMAGE_UNAVAILABLE_REASON =
  "이미지 API가 연결되지 않아 실행할 수 없습니다. AI 어시스트 설정에서 키를 등록해 주세요.";

const TEXT_UNAVAILABLE_REASON =
  "텍스트 AI가 연결되지 않아 실행할 수 없습니다. 로그인으로 서버 AI를 사용하거나 API 키를 등록해 주세요.";

function normalizeConnectionLabel(connectionLabel: string): string {
  const normalized = connectionLabel.replace(/\s+/g, " ").trim().slice(0, 120);
  return normalized || "연결 상태 미확인";
}

function isPersonalProviderConnection(connectionLabel: string): boolean {
  return /(?:내|개인|직접|BYOK)\s*(?:API|키)|BYOK/i.test(connectionLabel);
}

function costCategoryFor(
  requiredConnection: RequiredConnection,
  connectionLabel: string
): StudioAiExecutionCostCategory {
  if (requiredConnection === "image") {
    return "제공자 과금 가능";
  }
  return isPersonalProviderConnection(connectionLabel)
    ? "제공자 과금 가능"
    : "서버 쿼터";
}

export function planStudioAiExecutionPreflight(
  input: StudioAiExecutionPreflightInput
): StudioAiExecutionPreflight {
  const spec = TOOL_SPECS[input.activeTool];
  const toolLabel =
    STUDIO_AI_ASSIST_TOOLS.find((tool) => tool.id === input.activeTool)?.label ??
    input.activeTool;
  const connectionLabel = normalizeConnectionLabel(input.connectionLabel);
  const requiredConfigured =
    spec.requiredConnection === "image" ? input.imageConfigured : input.textConfigured;

  let unavailableReason: string | null = null;
  if (!requiredConfigured) {
    unavailableReason =
      spec.requiredConnection === "image"
        ? IMAGE_UNAVAILABLE_REASON
        : TEXT_UNAVAILABLE_REASON;
  } else if (!input.connectionOk) {
    unavailableReason = `연결 상태가 정상으로 확인되지 않았습니다 (${connectionLabel}). AI 어시스트 설정에서 다시 확인해 주세요.`;
  }

  return {
    toolId: input.activeTool,
    toolLabel,
    available: unavailableReason === null,
    unavailableReason,
    processingRoute: spec.processingRoute,
    externalTransfer: true,
    externalTransferLabel: spec.externalTransferLabel,
    costCategory: costCategoryFor(spec.requiredConnection, connectionLabel),
    estimatedTimeCategory: spec.estimatedTimeCategory,
    estimatedTimeLabel: spec.estimatedTimeLabel,
    outputCount: spec.outputCount,
    outputCountLabel: spec.outputCountLabel,
    fallbackRetryPolicy: FALLBACK_RETRY_POLICY,
    sourceNonDestructivePolicy: spec.sourceNonDestructivePolicy,
    connectionLabel,
  };
}
