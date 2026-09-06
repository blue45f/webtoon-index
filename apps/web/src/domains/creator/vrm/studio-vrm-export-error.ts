/**
 * Single error vocabulary for the VRM 내보내기(export) boundary.
 *
 * Keep this module free of Three.js / DOM imports: the export core must stay headless-testable and
 * usable from a worker. Messages are stable Korean UI copy and never interpolate caller data;
 * machine-readable specifics travel in `details` so a panel can list missing bones without the
 * message itself becoming a data sink.
 */

export type StudioVrmExportErrorCode =
  // 스냅샷/입력
  | "invalid-snapshot"
  | "node-tree-invalid"
  | "node-cycle"
  | "scene-root-invalid"
  | "mesh-invalid"
  | "accessor-empty"
  | "accessor-length-mismatch"
  | "material-invalid"
  | "texture-invalid"
  | "image-invalid"
  | "skin-invalid"
  // VRM 메타/휴머노이드
  | "meta-name-missing"
  | "meta-authors-missing"
  | "meta-license-url-invalid"
  | "meta-field-invalid"
  | "meta-thumbnail-invalid"
  | "humanoid-bone-missing"
  | "humanoid-node-invalid"
  | "humanoid-node-duplicate"
  | "expression-invalid"
  | "spring-bone-invalid"
  | "mtoon-invalid"
  // 직렬화
  | "json-not-serializable"
  | "json-too-large"
  | "output-too-large"
  // 컨테이너 재파싱(라운드트립)
  | "glb-truncated"
  | "glb-magic-mismatch"
  | "glb-version-unsupported"
  | "glb-length-mismatch"
  | "glb-chunk-alignment"
  | "glb-chunk-bounds"
  | "glb-json-chunk-missing"
  | "glb-json-chunk-duplicate"
  | "glb-bin-chunk-duplicate"
  | "glb-chunk-type-unsupported"
  | "glb-json-encoding-invalid"
  | "glb-json-parse-failed"
  | "glb-vrm-extension-missing";

const MESSAGES: Readonly<Record<StudioVrmExportErrorCode, string>> = Object.freeze({
  "invalid-snapshot": "내보낼 캐릭터 데이터를 읽을 수 없습니다. 작업공간을 새로고침해 주세요.",
  "node-tree-invalid": "캐릭터 뼈대 계층 구조가 올바르지 않습니다. 캐릭터를 다시 불러와 주세요.",
  "node-cycle": "캐릭터 뼈대 계층에 순환 참조가 있습니다. 캐릭터를 다시 불러와 주세요.",
  "scene-root-invalid": "캐릭터 장면의 최상위 노드를 확인할 수 없습니다. 캐릭터를 다시 불러와 주세요.",
  "mesh-invalid": "캐릭터 메시 구조가 올바르지 않아 VRM으로 내보낼 수 없습니다.",
  "accessor-empty": "정점이 하나도 없는 메시는 VRM으로 내보낼 수 없습니다.",
  "accessor-length-mismatch": "메시 속성의 정점 개수가 서로 맞지 않습니다. 캐릭터를 다시 불러와 주세요.",
  "material-invalid": "캐릭터 재질 정보가 올바르지 않아 VRM으로 내보낼 수 없습니다.",
  "texture-invalid": "캐릭터 텍스처 참조가 올바르지 않아 VRM으로 내보낼 수 없습니다.",
  "image-invalid": "VRM에 내장할 수 있는 이미지 형식은 PNG·JPEG·WebP입니다. 텍스처를 변환해 주세요.",
  "skin-invalid": "캐릭터 스킨(리깅) 정보가 올바르지 않아 VRM으로 내보낼 수 없습니다.",
  "meta-name-missing": "VRM 라이선스 정보의 모델 이름은 필수입니다. 이름을 입력해 주세요.",
  "meta-authors-missing": "VRM 라이선스 정보의 제작자는 최소 한 명 이상 필요합니다.",
  "meta-license-url-invalid":
    "VRM 1.0 라이선스 URL은 https://vrm.dev/licenses/1.0/ 이어야 합니다. 다른 조건은 기타 라이선스 URL에 적어 주세요.",
  "meta-field-invalid": "VRM 라이선스 항목의 값이 허용 범위를 벗어났습니다. 사용 허가 설정을 확인해 주세요.",
  "meta-thumbnail-invalid": "VRM 썸네일로 지정한 이미지를 찾을 수 없습니다. 썸네일을 다시 선택해 주세요.",
  "humanoid-bone-missing": "VRM 필수 휴머노이드 본이 빠져 있습니다. 리깅을 완료한 뒤 다시 내보내 주세요.",
  "humanoid-node-invalid": "휴머노이드 본이 존재하지 않는 노드를 가리킵니다. 리깅을 다시 확인해 주세요.",
  "humanoid-node-duplicate": "하나의 노드를 여러 휴머노이드 본에 배정할 수 없습니다. 리깅을 정리해 주세요.",
  "expression-invalid": "표정(익스프레션) 설정이 올바르지 않아 VRM으로 내보낼 수 없습니다.",
  "spring-bone-invalid": "흔들림(스프링 본) 설정이 올바르지 않아 VRM으로 내보낼 수 없습니다.",
  "mtoon-invalid": "MToon 툰 셰이딩 설정값이 허용 범위를 벗어났습니다. 재질 설정을 확인해 주세요.",
  "json-not-serializable": "캐릭터 정보를 VRM 장면 정보로 변환할 수 없습니다. 작업공간을 새로고침해 주세요.",
  "json-too-large": "VRM 장면 정보가 안전 처리 한도를 초과했습니다. 캐릭터를 단순화해 주세요.",
  "output-too-large": "내보낼 VRM 파일이 최대 용량을 초과했습니다. 텍스처와 메시를 최적화해 주세요.",
  "glb-truncated": "생성된 VRM 파일이 완전하지 않습니다. 다시 내보내 주세요.",
  "glb-magic-mismatch": "생성된 파일이 GLB 2.0 컨테이너가 아닙니다. 다시 내보내 주세요.",
  "glb-version-unsupported": "GLB 2.0 컨테이너만 지원합니다. 다시 내보내 주세요.",
  "glb-length-mismatch": "VRM 컨테이너 길이 정보가 실제 바이트 길이와 다릅니다. 다시 내보내 주세요.",
  "glb-chunk-alignment": "VRM 내부 블록이 4바이트 경계에 맞지 않습니다. 다시 내보내 주세요.",
  "glb-chunk-bounds": "VRM 내부 블록이 파일 범위를 벗어납니다. 다시 내보내 주세요.",
  "glb-json-chunk-missing": "VRM 파일에 장면 정보 블록이 없습니다. 다시 내보내 주세요.",
  "glb-json-chunk-duplicate": "VRM 파일에 장면 정보 블록이 중복되어 있습니다. 다시 내보내 주세요.",
  "glb-bin-chunk-duplicate": "VRM 파일에 이진 리소스 블록이 중복되어 있습니다. 다시 내보내 주세요.",
  "glb-chunk-type-unsupported": "지원하지 않는 내부 블록이 포함되어 있습니다. 다시 내보내 주세요.",
  "glb-json-encoding-invalid": "VRM 장면 정보의 문자 인코딩이 올바르지 않습니다. 다시 내보내 주세요.",
  "glb-json-parse-failed": "VRM 장면 정보를 해석할 수 없습니다. 다시 내보내 주세요.",
  "glb-vrm-extension-missing": "생성된 파일에 VRMC_vrm 확장이 없습니다. 다시 내보내 주세요.",
});

export class StudioVrmExportError extends Error {
  readonly code: StudioVrmExportErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: StudioVrmExportErrorCode,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(MESSAGES[code], options);
    this.name = "StudioVrmExportError";
    this.code = code;
    if (details !== undefined) this.details = Object.freeze({ ...details });
  }
}

export function studioVrmExportError(
  code: StudioVrmExportErrorCode,
  details?: Readonly<Record<string, unknown>>,
): StudioVrmExportError {
  return new StudioVrmExportError(code, details);
}

/** Exposed so a panel can pre-render copy without constructing throwaway Error objects. */
export function studioVrmExportErrorMessage(code: StudioVrmExportErrorCode): string {
  return MESSAGES[code];
}

export const STUDIO_VRM_EXPORT_ERROR_CODES = Object.freeze(
  Object.keys(MESSAGES) as readonly StudioVrmExportErrorCode[],
);
