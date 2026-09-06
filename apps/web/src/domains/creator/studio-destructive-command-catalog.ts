/**
 * 파괴적 명령 카탈로그 — creator 도메인의 네이티브 `confirm()` 전부를 대체하는 요청 기술.
 *
 * 각 항목의 `reversibility` 는 실측 판단이다(ux-audit-v5 §2.12 후속 조사).
 * 판정 기준은 **문서 히스토리(⌘Z)에 실제로 들어가는가** 하나다.
 *  - `undoable` — `commit`/`commitPages`/`updateActivePage`/`patchEl` 을 지나 `pagesHistory`
 *    에 스냅샷이 쌓이는 명령. 페이지·요소·페이지 사이드카(animTimeline 등)가 여기 속한다.
 *    캐릭터 바이블·작가의 방도 `pagesHistory` 스냅샷에는 안 들어가지만, 통합 실행취소
 *    저널(`studio-history-journal`)이 편집 전 문서를 들고 있어 ⌘Z 로 돌아온다.
 *  - `irreversible` — 히스토리도 저널도 지나지 않는 명령. 서버 삭제(작품·시리즈·공유 포즈),
 *    브라우저 저장소 레코드 삭제(복구 지점·커스텀 포즈·포즈 소재), 그리고 자체 저장소를 쓰는
 *    사이드카(프로덕션 바이블·약속/회수 원장) — 이 사실을 preview 에 명시한다.
 *  - `document-untouched` — 그림 문서를 아예 건드리지 않는 명령(내보내기 분할 선택, 공유 동의,
 *    기기 포즈 라이브러리 가져오기). 되돌림을 약속하지도, 영구 소실을 경고하지도 않는다.
 *
 * 되돌림 범위가 문서 일부에 그치는 경우(`checkpointRestore`)는 `undoNote` 로 한계를 명시한다 —
 * "되돌릴 수 있다"는 말만 하고 일부가 안 돌아오면 숨은 실패다.
 *
 * 문구는 여기 한 곳에만 있다. 호출부는 값만 넘긴다.
 */

import { recordStudioDestructiveOutcome } from "./studio-destructive-action-preview";

import type { StudioDestructiveActionRequest } from "./studio-destructive-action-preview";
import type { StudioVrmRenderedPoseUseContextInput } from "./vrm/studio-vrm-license-product-gate";

const PAGE_ELEMENTS_LABEL = "현재 페이지의 요소";

/** ① 빠른 웹툰 결과로 현재 페이지 교체 — commit() 경유, ⌘Z 가능. */
export function studioQuickComicReplaceRequest(
  elementCount: number,
): StudioDestructiveActionRequest {
  return {
    id: "studio.quick-comic.replace-page",
    title: "빠른 웹툰 결과로 현재 페이지 교체",
    losses: [{ label: PAGE_ELEMENTS_LABEL, count: elementCount }],
    gains: ["빠른 웹툰이 조립한 컷과 말풍선"],
    reversibility: "undoable",
  };
}

/** ② 장면 스냅샷으로 페이지 교체 — commitPages() 경유, ⌘Z 가능. */
export function studioSceneSnapshotReplaceRequest(input: {
  readonly pageName: string;
  readonly sceneName: string;
  readonly currentElementCount: number;
  readonly incomingElementCount: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.scene-snapshot.replace-page",
    title: `${input.pageName}을(를) “${input.sceneName}” 장면으로 교체`,
    losses: [
      { label: `${input.pageName}의 요소`, count: input.currentElementCount },
    ],
    gains: [`“${input.sceneName}” 장면 레이어 ${input.incomingElementCount}개`],
    reversibility: "undoable",
  };
}

/** ③ 예시 작품 불러오기 — commit() 경유, ⌘Z 가능. */
export function studioStartFromExampleRequest(
  elementCount: number,
): StudioDestructiveActionRequest {
  return {
    id: "studio.example.replace-page",
    title: "예시 작품 불러오기",
    losses: [{ label: PAGE_ELEMENTS_LABEL, count: elementCount }],
    gains: ["예시 웹툰 한 페이지"],
    reversibility: "undoable",
  };
}

/** ④ 이메레스 밑그림 일괄 삭제 — commit() 경유, ⌘Z 가능. */
export function studioRemoveEmeresUnderlaysRequest(
  underlayCount: number,
): StudioDestructiveActionRequest {
  return {
    id: "studio.emeres.remove-underlays",
    title: "이메레스 밑그림 전부 지우기",
    losses: [
      {
        label: "이메레스 밑그림",
        count: underlayCount,
        note: "그 위에 그린 펜 선은 지워지지 않아요",
      },
    ],
    reversibility: "undoable",
  };
}

/** ⑤ 템플릿 적용 — commit() 경유, ⌘Z 가능. */
export function studioApplyTemplateRequest(input: {
  readonly elementCount: number;
  readonly frameCount: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.template.apply",
    title: "템플릿 적용",
    losses: [{ label: PAGE_ELEMENTS_LABEL, count: input.elementCount }],
    gains: [`템플릿 컷 ${input.frameCount}개`],
    reversibility: "undoable",
  };
}

/** ⑥ 컷 레이아웃 프리셋 적용 — commit() 경유, ⌘Z 가능. */
export function studioApplyPanelLayoutRequest(input: {
  readonly layoutName: string;
  readonly elementCount: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.panel-layout.apply",
    title: `컷 템플릿 “${input.layoutName}” 적용`,
    losses: [{ label: PAGE_ELEMENTS_LABEL, count: input.elementCount }],
    gains: ["선택한 컷 배치"],
    reversibility: "undoable",
  };
}

/** ⑦ 콜라주 적용(교체 모드) — commit() 경유, ⌘Z 가능. */
export function studioApplyCollageRequest(input: {
  readonly elementCount: number;
  readonly frameCount: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.collage.apply",
    title: "콜라주로 현재 페이지 교체",
    losses: [{ label: PAGE_ELEMENTS_LABEL, count: input.elementCount }],
    gains: [`콜라주 컷 ${input.frameCount}개와 배치한 사진`],
    reversibility: "undoable",
  };
}

/**
 * ⑧ 명명 체크포인트로 문서 복원 — 페이지는 히스토리 스냅샷으로 되돌아오지만
 * 제목·설명·마스터·캐릭터 바이블·댓글 등 사이드 문서는 히스토리에 들어가지 않는다.
 * 그래서 `undoNote` 로 되돌림 범위를 정확히 밝힌다.
 */
export function studioRestoreCheckpointRequest(input: {
  readonly checkpointName: string;
  readonly currentPageCount: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.checkpoint.restore",
    title: `'${input.checkpointName}' 시점으로 문서 복원`,
    losses: [
      { label: "현재 페이지", count: input.currentPageCount },
      {
        label: "현재 제목·설명·마스터·캐릭터 설정",
        note: "체크포인트에 담긴 값으로 덮어써져요",
      },
    ],
    gains: [`'${input.checkpointName}' 시점의 문서 전체`],
    reversibility: "undoable",
    undoNote:
      "다만 실행 취소는 페이지에만 적용됩니다. 제목·설명·마스터 같은 문서 정보는 되돌아오지 않아요.",
  };
}

/**
 * ⑨ 복구 지점 삭제 — **되돌릴 수 없다.** 브라우저 저장소의 스냅샷 레코드를 지우며
 * 히스토리 커밋이 전혀 없다. confirm 을 유지하되 무엇이 영구히 사라지는지 명시한다.
 */
export function studioDeleteCheckpointRequest(input: {
  readonly checkpointName: string;
  readonly savedAtLabel?: string;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.checkpoint.delete",
    title: `'${input.checkpointName}' 복구 지점 삭제`,
    losses: [
      {
        label: `복구 지점 '${input.checkpointName}'`,
        ...(input.savedAtLabel ? { note: `${input.savedAtLabel}에 저장된 스냅샷` } : {}),
      },
    ],
    reversibility: "irreversible",
  };
}

/** ⑩ 페이지 전체의 수채 번짐 레이어 지우기 — commit() 경유, ⌘Z 가능. */
export function studioClearLivingInkRequest(): StudioDestructiveActionRequest {
  return {
    id: "studio.living-ink.clear-page",
    title: "현재 페이지의 수채 번짐 레이어 지우기",
    losses: [
      {
        label: "이 페이지의 수채 번짐 레이어",
        note: "펜 선과 다른 레이어는 그대로 남아요",
      },
    ],
    reversibility: "undoable",
  };
}

/* ------------------------------------------------------------------ */
/* Wave E 잔여 — 패널·페이지·라이브러리 명령                             */
/* ------------------------------------------------------------------ */

/**
 * ⑪ 페이지 1개 삭제(페이지 목록·스토리보드 격자 공용) — `deletePage` 가 `commitPages` 를
 * 지나므로 ⌘Z 로 되돌아온다.
 */
export function studioDeletePageRequest(input: {
  readonly pageNumber: number;
  readonly elementCount?: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.page.delete",
    title: `${input.pageNumber}페이지 삭제`,
    losses: [
      {
        label: `${input.pageNumber}페이지`,
        ...(typeof input.elementCount === "number"
          ? { note: `요소 ${input.elementCount}개가 함께 사라져요` }
          : {}),
      },
    ],
    reversibility: "undoable",
  };
}

/** ⑫ 선택한 페이지 일괄 삭제 — `deletePagesBulk` 가 `commitPages` 를 지난다. */
export function studioDeletePagesBulkRequest(
  pageCount: number,
): StudioDestructiveActionRequest {
  return {
    id: "studio.page.delete-bulk",
    title: "선택한 페이지 삭제",
    losses: [
      {
        label: "선택한 페이지",
        count: pageCount,
        note: "각 페이지의 요소가 함께 사라져요",
      },
    ],
    reversibility: "undoable",
  };
}

/**
 * ⑬ 서버 원고 다시 불러오기(로컬 미저장 변경 폐기) — **되돌릴 수 없다.**
 * 재수화는 히스토리 커밋이 아니라 문서 전체 교체이므로 ⌘Z 로 돌아오지 않는다.
 */
export function studioDiscardLocalChangesRequest(): StudioDestructiveActionRequest {
  return {
    id: "studio.work.discard-local-changes",
    title: "로컬 변경 버리고 서버 원고 다시 불러오기",
    losses: [
      {
        label: "화면에 남아 있는 미저장 변경 전부",
        note: "서버에 저장된 원고로 교체돼요",
      },
    ],
    gains: ["서버에 저장된 최신 원고"],
    reversibility: "irreversible",
    // 삭제가 아니라 폐기라 기본 라벨("영구 삭제")이 사실과 어긋난다.
    confirmLabel: "로컬 변경 버리기",
  };
}

/**
 * SQLite 권위를 읽지 못한 데생 인형 패널 닫기. 현재 탭의 포즈·체형은 문서 히스토리나
 * durable repository에 들어가지 않았으므로 닫는 즉시 복구할 수 없다.
 */
export function studioDiscardUnpersistedMannequinStateRequest(): StudioDestructiveActionRequest {
  return {
    id: "studio.mannequin.discard-unpersisted-state",
    title: "저장되지 않은 3D 데생 인형 변경 닫기",
    losses: [
      {
        label: "현재 탭의 저장되지 않은 체형·포즈 변경",
        note: "SQLite 상태를 확인하지 못했으며 닫은 뒤에는 복구할 수 없어요",
      },
    ],
    gains: ["3D 데생 인형 패널 닫기"],
    reversibility: "irreversible",
    confirmLabel: "저장하지 않고 닫기",
  };
}

/** ⑭ 레이어 타임라인 트랙 삭제 — `updateActivePage` 경유, ⌘Z 가능. */
export function studioRemoveTimelineTrackRequest(
  layerLabel: string,
): StudioDestructiveActionRequest {
  return {
    id: "studio.timeline.remove-track",
    title: `“${layerLabel}” 레이어 트랙 삭제`,
    losses: [
      {
        label: `“${layerLabel}” 레이어의 키프레임 전부`,
        note: "레이어 자체와 그림은 남아요",
      },
    ],
    reversibility: "undoable",
  };
}

/** ⑮ 프레임 애니메이션 해제 — `patchEl` 경유, ⌘Z 가능. */
export function studioRemoveFrameAnimationRequest(
  frameCount?: number,
): StudioDestructiveActionRequest {
  return {
    id: "studio.frame-animation.remove",
    title: "애니메이션 해제",
    losses: [
      {
        label: "이 요소의 애니메이션 프레임",
        ...(typeof frameCount === "number" ? { count: frameCount } : {}),
        note: "현재 보이는 한 장은 정지 이미지로 남아요",
      },
    ],
    gains: ["정지 이미지 한 장"],
    reversibility: "undoable",
  };
}

/**
 * 아직 히스토리 밖인 문서 사이드카(프로덕션 바이블·약속/회수 원장)의 공통 요청.
 * 이 둘은 자체 저장소를 쓰고 통합 실행취소 저널을 지나지 않아 ⌘Z 로 돌아오지 않는다.
 */
function sidecarDeleteRequest(input: {
  readonly id: string;
  readonly title: string;
  readonly lossLabel: string;
  readonly note: string;
}): StudioDestructiveActionRequest {
  return {
    id: input.id,
    title: input.title,
    losses: [{ label: input.lossLabel, note: input.note }],
    reversibility: "irreversible",
  };
}

/**
 * 통합 실행취소 저널(`studio-history-journal`)을 지나는 사이드카(캐릭터 바이블·작가의 방)의
 * 공통 요청. `pagesHistory` 스냅샷에는 안 들어가지만 저널이 이전 문서를 들고 있어 ⌘Z 로 돌아온다.
 */
function journaledSidecarDeleteRequest(input: {
  readonly id: string;
  readonly title: string;
  readonly lossLabel: string;
  readonly note?: string;
}): StudioDestructiveActionRequest {
  return {
    id: input.id,
    title: input.title,
    losses: [{ label: input.lossLabel, ...(input.note ? { note: input.note } : {}) }],
    reversibility: "undoable",
  };
}

/** ⑯ 캐릭터 설정 삭제 — 캐릭터 바이블은 통합 저널을 지나므로 ⌘Z 로 돌아온다. */
export function studioDeleteCharacterBibleEntryRequest(
  characterLabel: string,
): StudioDestructiveActionRequest {
  return journaledSidecarDeleteRequest({
    id: "studio.character-bible.delete-entry",
    title: `${characterLabel} 설정 삭제`,
    lossLabel: `${characterLabel}의 캐릭터 설정 전부`,
  });
}

/** ⑰ 작가의 방 항목 삭제 — 저널로 ⌘Z 가능. 다만 연결된 참조는 자동 정리되지 않는다. */
export function studioDeleteWriterRoomItemRequest(
  itemLabel: string,
): StudioDestructiveActionRequest {
  return journaledSidecarDeleteRequest({
    id: "studio.writer-room.delete-item",
    title: `${itemLabel} 삭제`,
    lossLabel: `${itemLabel}`,
    note: "연결된 참조는 직접 다시 확인해야 해요",
  });
}

/** ⑱ 프로덕션 바이블 항목 삭제 — 히스토리 밖. 장면의 내부 참조가 함께 정리된다. */
export function studioDeleteProductionBibleEntryRequest(
  entryLabel: string,
): StudioDestructiveActionRequest {
  return sidecarDeleteRequest({
    id: "studio.production-bible.delete-entry",
    title: `${entryLabel} 삭제`,
    lossLabel: `${entryLabel} 항목과 장면의 내부 참조`,
    note: "프로덕션 바이블은 실행 취소 대상이 아니에요",
  });
}

/** ⑲ 약속/회수 원장 항목 삭제 — 히스토리 밖. 연결된 단서가 함께 사라진다. */
export function studioDeletePromisePayoffEntryRequest(
  entryLabel: string,
): StudioDestructiveActionRequest {
  return sidecarDeleteRequest({
    id: "studio.promise-payoff.delete-entry",
    title: `“${entryLabel}” 약속 삭제`,
    lossLabel: `“${entryLabel}” 약속과 연결된 단서`,
    note: "약속/회수 원장은 실행 취소 대상이 아니에요",
  });
}

/** ⑳ 포즈 소재 삭제(이 기기) — 브라우저 저장소 레코드 삭제, 되돌릴 수 없다. */
export function studioDeletePoseMaterialRequest(
  materialName: string,
): StudioDestructiveActionRequest {
  return {
    id: "studio.pose-material.delete",
    title: `“${materialName}” 포즈 소재 삭제`,
    losses: [
      {
        label: `이 기기에 저장된 “${materialName}” 포즈 소재`,
        note: "이미 적용된 캐릭터 자세는 그대로 유지돼요",
      },
    ],
    reversibility: "irreversible",
  };
}

/** ㉑ 커스텀 포즈 삭제 — 브라우저 저장소 레코드 삭제, 되돌릴 수 없다. */
export function studioDeleteCustomPoseRequest(
  poseLabel?: string,
): StudioDestructiveActionRequest {
  return {
    id: "studio.vrm-pose.delete-custom",
    title: poseLabel ? `커스텀 포즈 “${poseLabel}” 삭제` : "커스텀 포즈 삭제",
    losses: [
      {
        label: poseLabel
          ? `이 기기에 저장된 커스텀 포즈 “${poseLabel}”`
          : "이 기기에 저장된 커스텀 포즈 1개",
      },
    ],
    reversibility: "irreversible",
  };
}

/** ㉒ 공유 포즈 삭제(서버) — 다른 사용자에게서도 사라진다. 되돌릴 수 없다. */
export function studioDeleteSharedPoseRequest(
  poseName: string,
): StudioDestructiveActionRequest {
  return {
    id: "studio.vrm-pose.delete-shared",
    title: `공유 포즈 '${poseName}' 서버에서 삭제`,
    losses: [
      {
        label: `서버에 공유된 포즈 '${poseName}'`,
        note: "다른 사용자의 공유 목록에서도 사라져요",
      },
    ],
    reversibility: "irreversible",
  };
}

/**
 * ㉓ 포즈 파일 가져오기 — 문서를 건드리지 않고 이 기기의 포즈 목록에만 추가한다.
 * 사라지는 것이 없으므로 손실 목록 대신 `intro` 로 무슨 일이 일어나는지 말한다.
 */
export function studioImportPosesRequest(
  poseCount: number,
): StudioDestructiveActionRequest {
  return {
    id: "studio.vrm-pose.import",
    title: "포즈 파일 가져오기",
    intro: "기존 포즈는 그대로 두고 이 기기의 포즈 목록 끝에 추가합니다.",
    losses: [],
    gains: [`가져온 포즈 ${poseCount}개`],
    reversibility: "document-untouched",
    confirmLabel: `${poseCount}개 가져오기`,
  };
}

/** ㉔ 포즈 공유 권한 확인 — 파괴가 아니라 게시 전 동의 게이트다. */
function boundedStudioShareConsentText(value: string, maxCharacters: number): string {
  const plain = value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(plain).slice(0, maxCharacters).join("");
}

export type StudioVrmPoseShareUseContextDisclosure = Omit<
  StudioVrmRenderedPoseUseContextInput,
  "confirmedByUser"
>;

function studioVrmPoseShareActorStatement(
  basis: StudioVrmPoseShareUseContextDisclosure["avatarPermissionBasis"],
): string {
  if (basis === "author") return "나는 이 아바타의 저작자입니다.";
  if (basis === "separately-licensed-person") {
    return "나는 이 아바타를 사용할 별도 이용 허락을 받은 사람입니다.";
  }
  if (basis === "other") {
    return "나는 이 아바타의 저작자도, 별도 이용 허락을 받은 사람도 아닙니다.";
  }
  return "이 아바타와 나의 이용 권한 관계는 확인되지 않았습니다.";
}

function studioVrmPoseSharePublisherStatement(
  publisherKind: StudioVrmPoseShareUseContextDisclosure["publisherKind"],
): string {
  if (publisherKind === "corporation") {
    return "이 공유는 ToonSpectrum 플랫폼 게시이며 게시 주체는 법인(corporation)으로 평가됩니다.";
  }
  if (publisherKind === "individual") return "이 공유의 게시 주체는 개인(individual)입니다.";
  return "이 공유의 개인·법인 게시 주체는 확인되지 않았습니다.";
}

function studioVrmPoseShareContentStatement(
  label: string,
  value: StudioVrmPoseShareUseContextDisclosure["excessivelyViolent"],
): string {
  const classification = value === "absent"
    ? "해당하지 않음"
    : value === "present"
      ? "포함함"
      : "확인되지 않음";
  return `${label}: ${classification}`;
}

function studioVrmPoseShareAlikeStatement(
  shareAlike: StudioVrmPoseShareUseContextDisclosure["shareAlike"],
): string {
  if (shareAlike === "satisfied") {
    return "필요한 동일조건변경허락(share-alike)을 호환되는 조건으로 이행합니다.";
  }
  if (shareAlike === "not-satisfied") {
    return "별도의 동일조건변경허락(share-alike) 이행을 주장하지 않습니다.";
  }
  return "동일조건변경허락(share-alike) 이행 여부는 확인되지 않았습니다.";
}

/** 공유 플래너의 정확한 크레딧·사용 맥락을 확인한 뒤만 typed receipt를 만든다. */
export function studioVrmPoseShareUseContextConsentRequest(
  input: StudioVrmPoseShareUseContextDisclosure,
): StudioDestructiveActionRequest {
  const attributionText = boundedStudioShareConsentText(input.confirmedAttributionText, 160);
  const attributionStatement = attributionText
    ? `게시할 크레딧(변경 없이 게시): ${attributionText}`
    : "이 모델은 현재 렌더 포즈 게시에 별도 크레딧을 요구하지 않습니다.";
  const modifiedModelStatement = input.containsModifiedModel
    ? "현재 렌더에는 개조된 모델 표현이 포함됩니다."
    : "현재 렌더에는 개조된 모델 표현이 포함되지 않습니다.";
  const contentStatement = [
    studioVrmPoseShareContentStatement("과도한 폭력", input.excessivelyViolent),
    studioVrmPoseShareContentStatement("과도한 성적 표현", input.excessivelySexual),
    studioVrmPoseShareContentStatement("정치·종교적 이용", input.politicalOrReligious),
    studioVrmPoseShareContentStatement("반사회적·혐오 이용", input.antisocialOrHate),
  ].join(", ");
  return {
    id: "studio.vrm-pose.share-use-context",
    title: "VRM 포즈 공유 이용 맥락 확인",
    intro:
      `${studioVrmPoseShareActorStatement(input.avatarPermissionBasis)} `
      + `${studioVrmPoseSharePublisherStatement(input.publisherKind)} `
      + `${modifiedModelStatement} 콘텐츠 분류 — ${contentStatement}. `
      + `${studioVrmPoseShareAlikeStatement(input.shareAlike)} ${attributionStatement}`,
    losses: [],
    gains: ["현재 공유 시도에만 사용하는 이용 맥락 확인"],
    reversibility: "document-untouched",
    undoNote: "취소하면 이용 맥락 receipt를 만들지 않고 공유를 중단합니다.",
    confirmLabel: "위 내용을 확인하고 계속",
  };
}

export function studioSharePoseConsentRequest(
  input: Readonly<{
    poseTitle: string;
    licenseLabel: string;
    attributionText: string;
  }>,
): StudioDestructiveActionRequest {
  const poseTitle = boundedStudioShareConsentText(input.poseTitle, 30);
  const licenseLabel = boundedStudioShareConsentText(input.licenseLabel, 80);
  const attributionText = boundedStudioShareConsentText(input.attributionText, 160);
  const attributionStatement = attributionText
    ? `필수 크레딧 “${attributionText}”을 변경하지 않고 게시 정보에 함께 싣습니다.`
    : "이 사용권은 이 포즈 게시에 별도 출처 표시를 요구하지 않습니다.";
  return {
    id: "studio.vrm-pose.share-consent",
    title: `'${poseTitle}' 포즈를 서버에 공유`,
    intro:
      `방금 확인한 이용 맥락을 기준으로 이 개조된 VRM 렌더 포즈의 ${licenseLabel} 조건을 검토했습니다. `
      + `${attributionStatement} `
      + "이 포즈 이미지와 모델·의상·소품 표현을 공유할 권리가 있고 타인의 권리를 침해하지 않음을 확인합니다.",
    losses: [],
    gains: ["다른 사용자가 쓸 수 있는 공유 포즈 1개"],
    reversibility: "document-untouched",
    undoNote: "공유 뒤에도 내 공유 목록에서 직접 삭제할 수 있어요.",
    confirmLabel: "확인하고 공유",
  };
}

/**
 * ㉕ 내보내기 분할 선택 — 취소가 "아무 일도 안 함"이 아니라 **두 번째 저장 방식**이다.
 * 그래서 두 버튼 라벨을 모두 채운다. 예전 네이티브 confirm 은 "확인/취소"만 보여줘서
 * 취소가 무엇을 하는지 본문을 읽어야만 알 수 있었다.
 */
export function studioExportSplitChoiceRequest(input: {
  readonly scale: number;
  readonly maxCanvasDimLabel: string;
  readonly partCount: number;
  readonly fittingScale: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.export.split-choice",
    title: "한 장으로 합치면 캔버스 한계를 넘어요",
    intro:
      `${input.scale}×로 모든 페이지를 한 장에 합치면 브라우저 캔버스 한계`
      + `(약 ${input.maxCanvasDimLabel}px)를 넘습니다. 저장 방식을 골라 주세요.`,
    losses: [],
    gains: [
      `나눠 저장: ${input.scale}× 화질 그대로 ${input.partCount}개 파일`,
      `한 파일로 저장: ${input.fittingScale}×로 배율을 낮춰 1개 파일`,
    ],
    reversibility: "document-untouched",
    confirmLabel: `${input.partCount}개 파일로 나눠 저장`,
    cancelLabel: `${input.fittingScale}×로 낮춰 한 파일`,
  };
}

/** ㉖ 분할 외에 방법이 없는 내보내기 — 취소는 저장 중단이다. */
export function studioExportSplitRequiredRequest(input: {
  readonly scale: number;
  readonly partCount: number;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.export.split-required",
    title: "나눠 저장해야 해요",
    intro:
      `페이지가 길어 ${input.scale}× 한 파일로는 저장할 수 없습니다. `
      + `${input.partCount}개 파일로 나눠 저장할까요?`,
    losses: [],
    reversibility: "document-untouched",
    confirmLabel: `${input.partCount}개 파일로 저장`,
    cancelLabel: "저장 취소",
  };
}

/** ㉗ 시리즈 삭제(서버) — 되돌릴 수 없다. 회차 작품은 삭제되지 않는다. */
export function studioDeleteSeriesRequest(
  seriesTitle: string,
): StudioDestructiveActionRequest {
  return {
    id: "studio.series.delete",
    title: `시리즈 '${seriesTitle}' 삭제`,
    losses: [
      {
        label: `시리즈 '${seriesTitle}'와 회차 묶음 정보`,
        note: "회차 작품 자체는 시리즈에서 분리될 뿐 삭제되지 않아요",
      },
    ],
    reversibility: "irreversible",
  };
}

/** ㉘ 창작물 삭제(서버) — 되돌릴 수 없다. */
export function studioDeleteWorkRequest(
  workTitle: string,
): StudioDestructiveActionRequest {
  return {
    id: "studio.work.delete",
    title: `창작물 '${workTitle}' 삭제`,
    losses: [
      {
        label: `서버에 저장된 '${workTitle}'의 원고·페이지·공개 링크`,
      },
    ],
    reversibility: "irreversible",
  };
}

/**
 * ㉙ 앱 설정 전체 초기화 — 그림 문서는 유지되지만, 기기별 단축키·입력·도구막대·격자
 * 개인화는 즉시 기본값으로 덮어써지고 문서 히스토리로 되돌릴 수 없다.
 */
export function studioResetApplicationSettingsRequest(): StudioDestructiveActionRequest {
  return {
    id: "studio.settings.reset-all",
    title: "앱 설정 전체 초기화",
    losses: [
      {
        label: "이 기기의 Studio 개인 설정",
        note: "단축키·마우스·터치·도구막대·격자 설정이 기본값으로 돌아가요",
      },
    ],
    gains: ["ToonStudio 기본 설정"],
    reversibility: "irreversible",
    confirmLabel: "전체 설정 초기화",
  };
}

/**
 * ㉚ 복구 배너의 "비우기" — **되돌릴 수 없다.** 이 명령이 지우는 임시저장본은 브라우저가
 * 죽었을 때 남은 **유일한 사본**이고, `localStorage`/OPFS/SQLite 레코드를 직접 지우므로
 * 히스토리 커밋이 전혀 없다(⌘Z 로도 돌아오지 않는다). 같은 앱의 페이지 삭제(⌘Z 가능)보다
 * 훨씬 위험한데 확인이 없던 자리다 — 무엇이 몇 개 사라지는지 preview 에 명시한다.
 */
export function studioClearAutosaveRequest(input: {
  readonly pageCount: number;
  readonly elementCount: number;
  readonly savedAtLabel?: string;
}): StudioDestructiveActionRequest {
  return {
    id: "studio.autosave.clear",
    title: "임시저장본 비우기",
    intro:
      "브라우저가 꺼졌을 때 남은 마지막 작업본이에요. 지우기 전에 '복구하기'로 되살리거나"
      + " 'JSON 백업'으로 내려받아 둘 수 있어요.",
    losses: [
      {
        label: "임시저장본",
        note:
          `페이지 ${input.pageCount}개 · 요소 ${input.elementCount}개`
          + (input.savedAtLabel ? ` (${input.savedAtLabel} 저장)` : ""),
      },
    ],
    reversibility: "irreversible",
    confirmLabel: "임시저장본 영구 삭제",
    cancelLabel: "그대로 두기",
  };
}

/**
 * 커밋 결과를 원장에 남기고 그대로 돌려준다.
 *
 * 감사가 찾아낸 조용한 실패: 파괴 승인 뒤의 `commit(...)` 다섯 곳이 반환값을 버려서,
 * 문서 잠금·저장 중 거절이 **아무 표시 없이** 사라졌다. 승인은 했는데 아무 일도 일어나지
 * 않는 것은 사용자에게 가장 나쁜 실패다. 이 함수를 지나면 성공도 거절도 반드시 남는다.
 */
export function settleStudioDestructiveCommit(
  request: StudioDestructiveActionRequest,
  committed: boolean,
  undo?: () => void,
): boolean {
  recordStudioDestructiveOutcome({
    request,
    outcome: committed ? "committed" : "refused",
    ...(committed && undo ? { undo } : {}),
  });
  return committed;
}
