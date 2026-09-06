/**
 * Studio Bulk Create & Data Merge Engine — 템플릿 컷/컴포넌트에 데이터셋
 * (CSV·JSON 표 데이터)을 일괄 주입하여 대량 컷·대사·에피소드 인스턴스를 자동 생성하는 코어.
 *
 * 마스터플랜 8.8 (Bulk Create·Data Merge) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 템플릿 슬롯(Text, ImageRef, Dialogue, Visibility, Badge Color) 정의
 * - 표 형태 데이터셋(Data Records) 매핑 및 변수 치환 (`{characterName}`, `{dialogue}`)
 * - 조건부 표시(Conditional Visibility) 및 다국어/배리언트 일괄 생성
 * - 누락된 슬롯 및 유효성 진단(Diagnostics)
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_DATA_MERGE_VERSION = 1 as const;

export const STUDIO_DATA_MERGE_LIMITS = Object.freeze({
  maxRecords: 10_000,
  maxSlotsPerTemplate: 128,
  maxGeneratedPanels: 10_000,
  maxIdLength: 128,
  maxDiagnostics: 256,
});

export const MERGE_SLOT_TYPES = [
  "text",
  "image-ref",
  "character-avatar",
  "dialogue-bubble",
  "visibility-toggle",
  "badge-color",
] as const;
export type MergeSlotType = (typeof MERGE_SLOT_TYPES)[number];

export interface MergeTemplateSlot {
  readonly slotId: string;
  readonly slotType: MergeSlotType;
  readonly targetElementId: string;
  readonly fieldName: string; // 데이터셋 컬럼명
  readonly defaultValue?: string | boolean;
  readonly required?: boolean;
}

export interface MergeTemplatePanel {
  readonly templateId: string;
  readonly templateName: string;
  readonly slots: readonly MergeTemplateSlot[];
  readonly rawTemplateText?: string;
}

export type DataRecordRow = Readonly<Record<string, string | number | boolean>>;

export interface MergedPanelInstance {
  readonly instanceId: string;
  readonly templateId: string;
  readonly rowIndex: number;
  readonly boundValues: Readonly<Record<string, string | boolean>>;
  readonly resolvedText?: string;
}

export interface DataMergeExecutionResult {
  readonly version: typeof STUDIO_DATA_MERGE_VERSION;
  readonly templateId: string;
  readonly totalGenerated: number;
  readonly instances: readonly MergedPanelInstance[];
  readonly diagnostics: readonly string[];
}

export function createMergeTemplate(params: {
  templateId: string;
  templateName: string;
  slots: readonly MergeTemplateSlot[];
  rawTemplateText?: string;
}): MergeTemplatePanel {
  return Object.freeze({
    templateId: params.templateId.trim(),
    templateName: params.templateName.trim(),
    slots: Object.freeze([...params.slots]),
    rawTemplateText: params.rawTemplateText,
  });
}

/**
 * 텍스트 템플릿 내의 `{field}` 플레이스홀더를 레코드 값으로 치환한다.
 */
export function substituteTemplateTokens(
  templateText: string,
  record: DataRecordRow,
): string {
  return templateText.replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, fieldName) => {
    const val = record[fieldName];
    return val !== undefined ? String(val) : match;
  });
}

/**
 * 템플릿과 데이터셋을 병합하여 인스턴스 목록을 일괄 생성한다.
 */
export function executeDataMerge(
  template: MergeTemplatePanel,
  records: readonly DataRecordRow[],
  options: { idPrefix?: string } = {},
): DataMergeExecutionResult {
  const prefix = options.idPrefix ?? "gen_panel";
  const diagnostics: string[] = [];
  const instances: MergedPanelInstance[] = [];

  if (records.length === 0) {
    diagnostics.push("병합할 데이터 레코드가 비어 있습니다.");
  }

  for (let rIdx = 0; rIdx < records.length; rIdx += 1) {
    const row = records[rIdx];
    const boundValues: Record<string, string | boolean> = {};

    for (const slot of template.slots) {
      const rawVal = row[slot.fieldName];
      if (rawVal === undefined || rawVal === "") {
        if (slot.required) {
          diagnostics.push(
            `레코드 #${rIdx + 1}: 필수 슬롯 '${slot.fieldName}'(slot: ${slot.slotId})의 값이 누락되었습니다.`,
          );
        }
        boundValues[slot.slotId] = slot.defaultValue ?? "";
      } else if (slot.slotType === "visibility-toggle") {
        boundValues[slot.slotId] = Boolean(rawVal);
      } else {
        boundValues[slot.slotId] = String(rawVal);
      }
    }

    const resolvedText = template.rawTemplateText
      ? substituteTemplateTokens(template.rawTemplateText, row)
      : undefined;

    instances.push(
      Object.freeze({
        instanceId: `${prefix}_${rIdx + 1}`,
        templateId: template.templateId,
        rowIndex: rIdx,
        boundValues: Object.freeze(boundValues),
        resolvedText,
      }),
    );
  }

  return Object.freeze({
    version: STUDIO_DATA_MERGE_VERSION,
    templateId: template.templateId,
    totalGenerated: instances.length,
    instances: Object.freeze(instances),
    diagnostics: Object.freeze(diagnostics),
  });
}
