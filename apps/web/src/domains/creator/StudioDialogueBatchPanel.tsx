// 배치된 대사 일괄 편집 패널(코미포식) — 캔버스의 말풍선·텍스트 요소를 목록으로 보고
// (1) 요소별 인라인 수정, (2) 전체/현재 페이지 찾아바꾸기, (3) 클릭으로 캔버스 선택을 제공한다.
// 순수 계산은 studio-dialogue-batch, 상태 커밋(히스토리)은 StudioPage(메인 루프)가 담당한다.
// 자체완결 플로팅 패널: 캔버스 컨테이너(relative) 안에서 우측에 떠 있고 Esc 로 닫힌다.
import {
  ArrowRight,
  ChevronDown,
  Combine,
  Copy,
  Download,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Replace,
  Search,
  Scissors,
  Square,
  Type as TypeIcon,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { downloadBlob } from "./export/studio-export";
import {
  adjacentEditableDialogueItem,
  collectDialogueItems,
  dialogueExcerpt,
  dialogueItemTypeLabel,
  filterDialogueItems,
  planDialogueReplace,
  type DialogueBatchItem,
  type DialoguePageLike,
  type DialogueReplacePlan,
  type DialogueReplaceScope,
} from "./lettering/studio-dialogue-batch";
import {
  parseStudioDialogueInterchange,
  serializeStudioDialogueInterchange,
  studioDialogueItemsToInterchange,
  type StudioDialogueImportApplyResult,
  type StudioDialogueImportMatchMode,
  type StudioDialogueInterchangeDocument,
  type StudioDialogueInterchangeFormat,
  type StudioDialogueInterchangeResult,
} from "./lettering/studio-dialogue-interchange";
import {
  buildDialogueReadAloudQueue,
  choosePreferredDialogueVoice,
  createBrowserDialogueSpeechAdapter,
  createDialogueReadAloudController,
  dialogueSpeechVoiceKey,
  isConfirmedLocalDialogueVoice,
  listDialogueSpeechVoices,
  type DialogueReadAloudPlaybackState,
  type DialogueSpeechAdapter,
} from "./lettering/studio-dialogue-read-aloud";
import {
  formatDialogueTextWithRubyPreview,
  type DialogueRubySpan,
} from "./lettering/studio-dialogue-ruby";

import { cx } from "@/shared/lib/cx";

export type StudioDialogueBatchPanelProps = {
  /** 전체 페이지(요소·그룹 포함) — StudioPage 의 pages 를 그대로 받는다. */
  pages: readonly DialoguePageLike[];
  /** 현재 편집 중인 페이지 id(스코프 "현재 페이지"·현재 배지 기준). */
  currentPageId: string;
  /** 캔버스에서 선택된 요소 id(목록 하이라이트). */
  selectedId: string | null;
  /**
   * 마퀴/다중 선택 id — formatScope "selected" 에 우선 사용.
   * 비어 있거나 미전달이면 selectedId 단일 선택으로 폴백한다.
   */
  selectedIds?: readonly string[] | null;
  onClose: () => void;
  /** 목록 행 클릭 → 해당 요소 선택(다른 페이지면 페이지 전환 포함). */
  onSelectElement: (pageId: string, elId: string) => void;
  /** 인라인 수정 확정(포커스 아웃/⌘Enter) — 텍스트가 실제로 바뀐 경우에만 호출된다. */
  onPatchText: (pageId: string, elId: string, text: string) => void;
  /** 찾아바꾸기 일괄 적용 — 메인 루프가 applyReplacePlanToPages 로 단일 커밋한다. */
  onApplyReplace: (plan: DialogueReplacePlan) => void;
  /** 현재 커서 위치에서 한 대사를 두 블록으로 나눈다. */
  onSplitText?: (pageId: string, elId: string, text: string, offset: number) => void;
  /** 현재 대사와 같은 페이지의 다음 대사를 한 블록으로 합친다. */
  onMergeWithNext?: (pageId: string, elId: string, text: string) => void;
  /** 최신 임시본을 보존해 다른 페이지로 이동하거나 복사한다. */
  onTransferElement?: (
    pageId: string,
    elId: string,
    targetPageId: string,
    mode: "move" | "copy",
    text: string
  ) => void;
  /** 선택한 자유 텍스트를 말풍선으로 변환(단일 undo). */
  onConvertTextToBubble?: (pageId: string, elId: string) => void;
  /** 여러 텍스트를 한 번의 문서 커밋으로 말풍선 변환. */
  onConvertTextsToBubbles?: (requests: readonly { pageId: string; elementId: string }[]) => void;
  /** 현재 목록에서 선택된 대사(또는 필터 결과)에 서식을 한 번에 적용. */
  onApplyFormat?: (
    elementIds: readonly string[],
    patch: {
      fontSize?: number;
      fontStyle?: "normal" | "bold" | "italic" | "bold italic";
      textColor?: string;
      align?: "left" | "center" | "right";
    }
  ) => void;
  /** 선택 구간에 루비(후리가나)를 단다 — 메인 루프가 단일 히스토리 커밋한다. */
  onApplyDialogueRuby?: (
    pageId: string,
    elId: string,
    text: string,
    start: number,
    end: number,
    ruby: string
  ) => void;
  /** 선택 구간과 겹치는 루비 주석을 지운다. */
  onClearDialogueRuby?: (
    pageId: string,
    elId: string,
    text: string,
    start: number,
    end: number
  ) => void;
  /** 번역/대본 파일의 cue를 기존 말풍선에 한 번의 문서 커밋으로 반영한다. */
  onImportInterchange?: (
    document: StudioDialogueInterchangeDocument,
    mode: StudioDialogueImportMatchMode
  ) => Promise<StudioDialogueImportApplyResult> | StudioDialogueImportApplyResult;
  /** Web Speech API 테스트·점진 향상 경계. 운영에서는 브라우저 어댑터를 자동 생성한다. */
  readAloudAdapter?: DialogueSpeechAdapter;
  /** 모바일 소프트 키보드가 가린 높이. 스튜디오 도크와 함께 패널도 같은 만큼 올린다. */
  mobileKeyboardInset?: number;
};

const SCOPES: { id: DialogueReplaceScope; label: string }[] = [
  { id: "all", label: "전체 페이지" },
  { id: "current", label: "현재 페이지" },
];

const inputClass =
  "min-h-11 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-[0.7rem] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

const READ_ALOUD_RATES = [0.6, 0.8, 1, 1.2, 1.4, 1.6] as const;

const INTERCHANGE_FORMATS: readonly {
  id: StudioDialogueInterchangeFormat;
  label: string;
}[] = [
  { id: "csv", label: "CSV 번역표" },
  { id: "tsv", label: "TSV 번역표" },
  { id: "json", label: "JSON 무손실" },
  { id: "fountain", label: "Fountain 대본" },
  { id: "fdx", label: "Final Draft FDX" },
  { id: "srt", label: "SRT 자막" },
  { id: "vtt", label: "WebVTT 자막" },
  { id: "markdown", label: "Markdown" },
  { id: "txt", label: "TXT" },
] as const;

interface PendingFdxInterchangeImport {
  readonly fileName: string;
  readonly parsed: StudioDialogueInterchangeResult;
}

function dialogueFormatFromFileName(fileName: string): StudioDialogueInterchangeFormat | null {
  const extension = fileName.toLocaleLowerCase("en-US").split(".").pop();
  if (extension === "md") return "markdown";
  return INTERCHANGE_FORMATS.some((format) => format.id === extension)
    ? extension as StudioDialogueInterchangeFormat
    : null;
}

function playbackStatusText(
  playback: DialogueReadAloudPlaybackState,
  queueSize: number
): string {
  const progress =
    playback.currentIndex >= 0 && playback.total > 0
      ? `${playback.currentIndex + 1}/${playback.total}`
      : null;
  switch (playback.status) {
    case "unsupported":
      return "이 브라우저는 대사 낭독을 지원하지 않아요.";
    case "playing":
      return `낭독 중 · ${progress ?? "준비"}`;
    case "paused":
      return `일시 정지 · ${progress ?? "준비"}`;
    case "completed":
      return `낭독 검수 완료 · ${playback.total}개`;
    case "stopped":
      return "낭독을 중지했어요.";
    case "error":
      return "낭독을 시작하지 못했어요. 시스템 음성을 확인해 주세요.";
    default:
      return queueSize > 0 ? `검수할 대사 ${queueSize}개` : "낭독할 대사가 없어요.";
  }
}

function readRubySpansFromPages(
  pages: readonly DialoguePageLike[],
  pageId: string,
  elementId: string
): readonly DialogueRubySpan[] | undefined {
  const page = pages.find((candidate) => candidate.id === pageId);
  const element = page?.elements.find((candidate) => candidate.id === elementId) as
    | (DialoguePageLike["elements"][number] & { rubySpans?: readonly DialogueRubySpan[] })
    | undefined;
  return element?.rubySpans;
}

export function StudioDialogueBatchPanel({
  pages,
  currentPageId,
  selectedId,
  selectedIds,
  onClose,
  onSelectElement,
  onPatchText,
  onApplyReplace,
  onSplitText,
  onMergeWithNext,
  onTransferElement,
  onConvertTextToBubble,
  onConvertTextsToBubbles,
  onApplyFormat,
  onApplyDialogueRuby,
  onClearDialogueRuby,
  onImportInterchange,
  readAloudAdapter,
  mobileKeyboardInset = 0,
}: StudioDialogueBatchPanelProps) {
  // 찾아바꾸기 입력 — 찾기는 공백도 의미가 있어 trim 하지 않는다.
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [scope, setScope] = useState<DialogueReplaceScope>("all");
  const [caseSensitive, setCaseSensitive] = useState(false);
  // 목록 검색어(찾아바꾸기와 독립).
  const [listQuery, setListQuery] = useState("");
  // 인라인 수정 임시본 — 포커스 아웃/⌘Enter 에만 확정해 히스토리를 키 입력마다 만들지 않는다.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 구조 작업은 한 행만 펼쳐 목록 밀도를 유지한다.
  const [structureMenuId, setStructureMenuId] = useState<string | null>(null);
  const [transferTargetByItem, setTransferTargetByItem] = useState<Record<string, string>>({});
  /** 구조 메뉴 루비 읽기 입력(행별). */
  const [rubyReadingByItem, setRubyReadingByItem] = useState<Record<string, string>>({});
  /** textarea 선택 구간 — 선택 있을 때만 루비 컨트롤을 노출한다. */
  const [selectionByItem, setSelectionByItem] = useState<
    Record<string, { start: number; end: number } | null>
  >({});
  const [interchangeOpen, setInterchangeOpen] = useState(false);
  const [interchangeFormat, setInterchangeFormat] = useState<StudioDialogueInterchangeFormat>("csv");
  const [interchangeMatchMode, setInterchangeMatchMode] = useState<StudioDialogueImportMatchMode>("auto");
  const [interchangeStatus, setInterchangeStatus] = useState<{
    tone: "good" | "warn" | "bad";
    text: string;
  } | null>(null);
  const [interchangeBusy, setInterchangeBusy] = useState(false);
  const [pendingFdxImport, setPendingFdxImport] =
    useState<PendingFdxInterchangeImport | null>(null);
  /** Ephemeral action feedback for format / convert (not interchange). */
  const [formatStatus, setFormatStatus] = useState<{
    tone: "good" | "warn";
    text: string;
  } | null>(null);
  /** Format target: listed unlocked rows vs current selection only. */
  const [formatScope, setFormatScope] = useState<"visible" | "selected">("visible");

  const [speechAdapter] = useState<DialogueSpeechAdapter>(
    () => readAloudAdapter ?? createBrowserDialogueSpeechAdapter()
  );
  const locale = typeof navigator === "undefined" ? "ko-KR" : navigator.language || "ko-KR";
  const [voices, setVoices] = useState(() => listDialogueSpeechVoices(speechAdapter));
  const [allowOnlineVoices, setAllowOnlineVoices] = useState(false);
  const [selectedVoiceKey, setSelectedVoiceKey] = useState(() => {
    const confirmedLocalVoices = listDialogueSpeechVoices(speechAdapter).filter(
      isConfirmedLocalDialogueVoice
    );
    const preferred = choosePreferredDialogueVoice(
      confirmedLocalVoices,
      { lang: "ko-KR" },
      locale
    );
    return preferred ? dialogueSpeechVoiceKey(preferred) : "";
  });
  const [readAloudRate, setReadAloudRate] = useState(1);
  const [playback, setPlayback] = useState<DialogueReadAloudPlaybackState>(() => ({
    status: speechAdapter.supported ? "idle" : "unsupported",
    currentIndex: -1,
    total: 0,
    currentItemId: null,
    currentPageId: null,
    currentPageIndex: null,
  }));
  const [readAloudController] = useState(() =>
    createDialogueReadAloudController(speechAdapter, setPlayback)
  );

  const findInputRef = useRef<HTMLInputElement>(null);
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const composingIdsRef = useRef(new Set<string>());
  const skipBlurCommitIdRef = useRef<string | null>(null);
  const initialFocusDoneRef = useRef(false);
  const readAloudHeadingId = useId();
  const interchangePanelId = useId();
  const fdxPreviewHeadingId = useId();

  // 캔버스에서 대사를 선택한 뒤 열면 바로 편집하고, 그 외에는 기존 찾아바꾸기 진입점을 유지한다.
  useEffect(() => {
    if (initialFocusDoneRef.current) return;
    initialFocusDoneRef.current = true;
    const selectedItem = selectedId
      ? collectDialogueItems(pages).find((item) => item.id === selectedId && !item.locked)
      : null;
    const textarea = selectedItem ? textareaRefs.current.get(selectedItem.id) : null;
    if (textarea) {
      textarea.focus();
      textarea.select();
    } else {
      findInputRef.current?.focus();
    }
  }, [pages, selectedId]);

  // 시스템 음성 목록은 일부 브라우저에서 비동기로 준비된다.
  useEffect(() => {
    const refreshVoices = () => {
      const next = listDialogueSpeechVoices(speechAdapter);
      setVoices(next);
      setSelectedVoiceKey((previous) => {
        if (next.some((voice) => dialogueSpeechVoiceKey(voice) === previous)) return previous;
        const preferred = choosePreferredDialogueVoice(next, { lang: "ko-KR" }, locale);
        return preferred ? dialogueSpeechVoiceKey(preferred) : "";
      });
    };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = speechAdapter.subscribeVoices?.(refreshVoices);
    } catch {
      unsubscribe = undefined;
    }
    // 일부 Chromium/WebKit은 패널 구독 전에 음성 목록을 채우고 voiceschanged를 다시 보내지 않는다.
    // 즉시/짧은 지연 재조회로 그 경합을 복구하되 네트워크 요청이나 원문 접근은 하지 않는다.
    const refreshTimers = [0, 250, 1_000].map((delay) => window.setTimeout(refreshVoices, delay));
    return () => {
      refreshTimers.forEach((timer) => window.clearTimeout(timer));
      try {
        unsubscribe?.();
      } catch {
        // 브라우저 음성 기능이 사라졌어도 패널 정리는 계속한다.
      }
      // React StrictMode는 개발 중 effect를 setup→cleanup→setup으로 재생한다. 영구 dispose 대신
      // 현재 브라우저 큐만 해제해 두 번째 setup 이후에도 같은 controller를 안전하게 재사용한다.
      readAloudController.release();
    };
  }, [locale, readAloudController, speechAdapter]);

  // Esc 로 닫기 — 입력 필드 안의 Esc 는 임시본 되돌리기에 쓰므로 제외한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      readAloudController.stop();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, readAloudController]);

  const items = collectDialogueItems(pages);
  const shown = filterDialogueItems(items, listQuery);
  // 서식 "선택만" 범위: 마퀴 다중 id 우선, 없으면 selectedId 단일 폴백.
  const formatSelectedIds =
    selectedIds && selectedIds.length > 0
      ? selectedIds
      : selectedId
        ? [selectedId]
        : [];
  const formatSelectedIdSet = new Set(formatSelectedIds);
  const selectedDialogueAmongItems = items.filter((item) => formatSelectedIdSet.has(item.id));
  const hasFormatSelection = selectedDialogueAmongItems.length > 0;
  const formatSelectionCount = selectedDialogueAmongItems.length;
  const applyFormatToVisible = (
    patch: {
      fontSize?: number;
      fontStyle?: "normal" | "bold" | "italic" | "bold italic";
      textColor?: string;
      align?: "left" | "center" | "right";
    },
    label?: string
  ) => {
    if (!onApplyFormat) return;
    const pool =
      formatScope === "selected" && formatSelectedIds.length > 0
        ? shown.filter((item) => formatSelectedIdSet.has(item.id) && !item.locked)
        : shown.filter((item) => !item.locked);
    const ids = pool.map((item) => item.id);
    if (ids.length === 0) {
      setFormatStatus({
        tone: "warn",
        text: formatScope === "selected"
          ? "선택된 잠기지 않은 대사가 없어요. 목록에서 대사를 고르거나 범위를 ‘목록 전체’로 바꿔 주세요."
          : "목록에 적용할 잠기지 않은 대사가 없어요.",
      });
      return;
    }
    onApplyFormat(ids, patch);
    setFormatStatus({
      tone: "good",
      text: `${label ?? "서식"}을(를) 대사 ${ids.length}개에 적용했어요. ⌘/Ctrl+Z로 한 번에 되돌릴 수 있어요.`,
    });
  };

  const convertAllVisibleTextToBubble = () => {
    const targets = shown.filter((item) => item.elType === "text" && !item.locked);
    if (targets.length === 0) {
      setFormatStatus({
        tone: "warn",
        text: "말풍선으로 바꿀 자유 텍스트가 목록에 없어요.",
      });
      return;
    }
    if (onConvertTextsToBubbles) {
      onConvertTextsToBubbles(
        targets.map((item) => ({ pageId: item.pageId, elementId: item.id }))
      );
    } else if (onConvertTextToBubble) {
      // Fallback: one commit per row (legacy). Prefer bulk prop for single undo.
      for (const item of targets) {
        onConvertTextToBubble(item.pageId, item.id);
      }
    } else {
      return;
    }
    setFormatStatus({
      tone: "good",
      text: `자유 텍스트 ${targets.length}개를 말풍선으로 바꿨어요. 실행 취소 1회로 되돌릴 수 있어요.`,
    });
  };
  const readAloudQueue = buildDialogueReadAloudQueue(shown, drafts);
  const confirmedLocalVoices = voices.filter(isConfirmedLocalDialogueVoice);
  const onlineOrUnknownVoiceCount = voices.length - confirmedLocalVoices.length;
  const selectableVoices = allowOnlineVoices ? voices : confirmedLocalVoices;
  const selectedVoice =
    selectableVoices.find((voice) => dialogueSpeechVoiceKey(voice) === selectedVoiceKey) ??
    choosePreferredDialogueVoice(selectableVoices, { lang: "ko-KR" }, locale);
  // 페이지 순서대로 묶어 페이지 헤더를 붙인다(목록은 collect 가 페이지순으로 보장).
  const grouped: { pageId: string; pageIndex: number; items: DialogueBatchItem[] }[] = [];
  for (const item of shown) {
    const last = grouped[grouped.length - 1];
    if (last && last.pageId === item.pageId) last.items.push(item);
    else grouped.push({ pageId: item.pageId, pageIndex: item.pageIndex, items: [item] });
  }
  const nextDialogueById = new Map<string, DialogueBatchItem>();
  for (const page of pages) {
    const pageItems = collectDialogueItems([page]);
    pageItems.forEach((item, index) => {
      const next = pageItems[index + 1];
      if (next) nextDialogueById.set(item.id, next);
    });
  }

  const plan = planDialogueReplace(pages, find, replaceWith, {
    caseSensitive,
    scope,
    currentPageId,
  });

  const commitDraft = (item: DialogueBatchItem) => {
    const draft = drafts[item.id];
    if (draft == null) return;
    setDrafts((prev) => {
      const { [item.id]: _omit, ...rest } = prev;
      return rest;
    });
    if (draft !== item.text) onPatchText(item.pageId, item.id, draft);
  };

  const revertDraft = (id: string) => {
    setDrafts((prev) => {
      const { [id]: _omit, ...rest } = prev;
      return rest;
    });
  };

  const focusDialogueEditor = (item: DialogueBatchItem) => {
    if (item.locked) {
      onSelectElement(item.pageId, item.id);
      return;
    }
    const textarea = textareaRefs.current.get(item.id);
    if (!textarea) {
      onSelectElement(item.pageId, item.id);
      return;
    }
    textarea.focus();
    textarea.select();
  };

  const commitAndMove = (
    item: DialogueBatchItem,
    direction: "next" | "previous"
  ) => {
    const target = adjacentEditableDialogueItem(shown, item.id, direction);
    commitDraft(item);
    if (!target) return;
    // focus()가 현재 textarea의 blur를 동기로 발생시키므로 이미 저장한 초안을 한 번 더 쓰지 않는다.
    skipBlurCommitIdRef.current = item.id;
    focusDialogueEditor(target);
  };

  const applyReplace = () => {
    if (plan.totalCount === 0) return;
    // 확정 전 임시본은 치환 결과를 가리므로 함께 비운다(예측 가능성).
    setDrafts({});
    onApplyReplace(plan);
  };

  const playShownDialogue = () => {
    if (!selectedVoice) return;
    // 임시본을 읽되 commitDraft/onPatchText 는 호출하지 않는다.
    readAloudController.play(readAloudQueue, {
      rate: readAloudRate,
      voice: selectedVoice,
    });
  };

  const playSingleDialogue = (item: DialogueBatchItem) => {
    if (!selectedVoice) return;
    // 낭독과 캔버스 점프는 별도 형제 버튼의 독립 동작이며 텍스트는 수정하지 않는다.
    onSelectElement(item.pageId, item.id);
    readAloudController.play(buildDialogueReadAloudQueue([item], drafts), {
      rate: readAloudRate,
      voice: selectedVoice,
    });
  };

  const togglePause = () => {
    if (playback.status === "paused") readAloudController.resume();
    else readAloudController.pause();
  };

  const clearDraft = (id: string) => {
    setDrafts((previous) => {
      const { [id]: _omit, ...rest } = previous;
      return rest;
    });
  };

  const splitAtCaret = (item: DialogueBatchItem) => {
    const editor = textareaRefs.current.get(item.id);
    const text = drafts[item.id] ?? item.text;
    const offset = editor?.selectionStart ?? -1;
    if (!onSplitText || offset <= 0 || offset >= text.length) return;
    clearDraft(item.id);
    setStructureMenuId(null);
    onSplitText(item.pageId, item.id, text, offset);
  };

  const mergeWithNext = (item: DialogueBatchItem) => {
    if (!onMergeWithNext) return;
    const next = nextDialogueById.get(item.id);
    if (!next || next.locked) return;
    const text = drafts[item.id] ?? item.text;
    clearDraft(item.id);
    setStructureMenuId(null);
    onMergeWithNext(item.pageId, item.id, text);
  };

  const transferElement = (item: DialogueBatchItem, mode: "move" | "copy") => {
    if (!onTransferElement) return;
    const fallbackTarget = pages.find((page) => page.id !== item.pageId)?.id;
    const targetPageId = transferTargetByItem[item.id] ?? fallbackTarget;
    if (!targetPageId) return;
    const text = drafts[item.id] ?? item.text;
    clearDraft(item.id);
    setStructureMenuId(null);
    onTransferElement(item.pageId, item.id, targetPageId, mode, text);
  };

  const convertTextToBubble = (item: DialogueBatchItem) => {
    if (!onConvertTextToBubble || item.elType !== "text" || item.locked) return;
    clearDraft(item.id);
    setStructureMenuId(null);
    onConvertTextToBubble(item.pageId, item.id);
    setFormatStatus({
      tone: "good",
      text: "텍스트를 말풍선으로 바꿨어요. 내용·위치는 그대로이고 실행 취소로 되돌릴 수 있어요.",
    });
  };

  const captureTextareaSelection = (itemId: string) => {
    const editor = textareaRefs.current.get(itemId);
    if (!editor) {
      setSelectionByItem((current) => ({ ...current, [itemId]: null }));
      return null;
    }
    const start = Math.min(editor.selectionStart, editor.selectionEnd);
    const end = Math.max(editor.selectionStart, editor.selectionEnd);
    const range = start < end ? { start, end } : null;
    setSelectionByItem((current) => ({ ...current, [itemId]: range }));
    return range;
  };

  const applyRubyAtSelection = (item: DialogueBatchItem) => {
    if (!onApplyDialogueRuby || item.locked) return;
    const range =
      captureTextareaSelection(item.id) ?? selectionByItem[item.id] ?? null;
    if (!range) return;
    const text = drafts[item.id] ?? item.text;
    const ruby = (rubyReadingByItem[item.id] ?? "").trim();
    if (!ruby) return;
    // 임시본 text와 루비를 한 커밋으로 반영한다(메인 루프 applyDialogueRubySpan이 text도 쓴다).
    clearDraft(item.id);
    setRubyReadingByItem((current) => {
      const { [item.id]: _omit, ...rest } = current;
      return rest;
    });
    onApplyDialogueRuby(item.pageId, item.id, text, range.start, range.end, ruby);
  };

  const clearRubyAtSelection = (item: DialogueBatchItem) => {
    if (!onClearDialogueRuby || item.locked) return;
    const range =
      captureTextareaSelection(item.id) ?? selectionByItem[item.id] ?? null;
    if (!range) return;
    const text = drafts[item.id] ?? item.text;
    clearDraft(item.id);
    onClearDialogueRuby(item.pageId, item.id, text, range.start, range.end);
  };

  const exportInterchange = () => {
    const draftItems = items.map((item) => ({ ...item, text: drafts[item.id] ?? item.text }));
    try {
      const file = serializeStudioDialogueInterchange(
        interchangeFormat,
        studioDialogueItemsToInterchange(draftItems, { language: "ko-KR" })
      );
      downloadBlob(
        new Blob([file.text], { type: file.mimeType }),
        `toonspectrum-dialogue${file.extension}`
      );
      setInterchangeStatus({
        tone: file.lossy ? "warn" : "good",
        text: [
          `${draftItems.length}개 대사를 ${file.extension} 파일로 내보냈어요.`,
          ...file.warnings,
        ].join(" "),
      });
    } catch (error) {
      setInterchangeStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "대사 파일을 만들지 못했습니다.",
      });
    }
  };

  const applyParsedInterchange = async (
    parsed: StudioDialogueInterchangeResult
  ): Promise<void> => {
    if (!onImportInterchange) {
      throw new Error("현재 문서에서는 대사 가져오기를 사용할 수 없습니다.");
    }
    const applied = await onImportInterchange(parsed.document, interchangeMatchMode);
    setDrafts({});
    const details = [
      `${applied.changed}개 대사를 한 번에 반영했어요.`,
      applied.locked > 0 ? `잠긴 대사 ${applied.locked}개 제외.` : "",
      applied.missing > 0 ? `연결하지 못한 대사 ${applied.missing}개.` : "",
      applied.droppedMetadata > 0
        ? `화자·시간 메타데이터 ${applied.droppedMetadata}개는 캔버스에 쓰지 않았어요.`
        : "",
      ...parsed.warnings,
    ].filter(Boolean);
    setInterchangeStatus({
      tone: applied.missing > 0 || applied.locked > 0 || parsed.lossy ? "warn" : "good",
      text: details.join(" "),
    });
  };

  const importInterchange = async (file: File) => {
    const format = dialogueFormatFromFileName(file.name);
    if (!format) {
      setInterchangeStatus({ tone: "bad", text: "지원하는 대사 파일 확장자가 아닙니다." });
      return;
    }
    if (!onImportInterchange) {
      setInterchangeStatus({ tone: "bad", text: "현재 문서에서는 대사 가져오기를 사용할 수 없습니다." });
      return;
    }
    setInterchangeBusy(true);
    setPendingFdxImport(null);
    setInterchangeStatus(null);
    try {
      const parsed = parseStudioDialogueInterchange(format, await file.arrayBuffer());
      if (format === "fdx") {
        if (!parsed.lossPreview) {
          throw new Error("FDX 손실 미리보기를 만들지 못해 적용을 중단했습니다.");
        }
        setPendingFdxImport({ fileName: file.name, parsed });
        setInterchangeStatus({
          tone: "warn",
          text: "FDX는 장면·액션 구조를 페이지와 컷으로 바꿉니다. 아래 손실 미리보기를 확인한 뒤 적용해 주세요.",
        });
      } else {
        await applyParsedInterchange(parsed);
      }
    } catch (error) {
      setInterchangeStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "대사 파일을 가져오지 못했습니다.",
      });
    } finally {
      setInterchangeBusy(false);
    }
  };

  const confirmPendingFdxImport = async () => {
    if (!pendingFdxImport || interchangeBusy) return;
    setInterchangeBusy(true);
    setInterchangeStatus(null);
    try {
      await applyParsedInterchange(pendingFdxImport.parsed);
      setPendingFdxImport(null);
    } catch (error) {
      setInterchangeStatus({
        tone: "bad",
        text: error instanceof Error ? error.message : "FDX 대사를 반영하지 못했습니다.",
      });
    } finally {
      setInterchangeBusy(false);
    }
  };

  const cancelPendingFdxImport = () => {
    if (interchangeBusy) return;
    setPendingFdxImport(null);
    setInterchangeStatus({
      tone: "good",
      text: "FDX 가져오기를 취소했어요. 문서는 변경되지 않았습니다.",
    });
  };

  const canPause = playback.status === "playing" || playback.status === "paused";
  const isActive = playback.status === "playing" || playback.status === "paused";
  const statusText = selectedVoice
    ? playbackStatusText(playback, readAloudQueue.length)
    : voices.length === 0
      ? "사용 가능한 시스템 음성을 불러오는 중이에요."
      : "확인된 기기 내 음성이 없어요. 온라인 음성을 사용하려면 아래에서 명시적으로 허용하세요.";
  const safeMobileKeyboardInset = Number.isFinite(mobileKeyboardInset)
    ? Math.max(0, Math.round(mobileKeyboardInset))
    : 0;

  return (
    <section
      aria-label="대사 일괄 편집"
      data-studio-shortcut-boundary="true"
      className="fixed inset-x-2 bottom-[calc(7rem+env(safe-area-inset-bottom)+var(--studio-mobile-keyboard-inset))] top-[calc(4.25rem+env(safe-area-inset-top))] z-[54] flex w-auto flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-3 lg:top-3 lg:z-40 lg:max-h-[calc(100%-5rem)] lg:w-[min(21rem,calc(100%-1.5rem))]"
      style={{
        "--studio-mobile-keyboard-inset": `${safeMobileKeyboardInset}px`,
      } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <p className="text-xs font-bold text-fg">
          대사 일괄 편집
          <span className="ml-1.5 font-medium text-fg-4">{items.length}개</span>
        </p>
        <button
          type="button"
          onClick={() => {
            readAloudController.stop();
            onClose();
          }}
          aria-label="대사 일괄 편집 닫기"
          className="grid size-11 shrink-0 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <section className="border-b border-line/60 px-3 py-2.5" aria-label="대사 파일 입출력">
        <button
          type="button"
          onClick={() => setInterchangeOpen((open) => !open)}
          aria-expanded={interchangeOpen}
          aria-controls={interchangePanelId}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left text-[0.7rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <FileText size={14} aria-hidden />
          번역·대본 파일
          <span className="ml-auto text-[0.6rem] font-medium text-fg-4">9종</span>
          <ChevronDown
            size={14}
            aria-hidden
            className={cx("transition-transform", interchangeOpen && "rotate-180")}
          />
        </button>
        {interchangeOpen && (
          <div
            id={interchangePanelId}
            className="mt-1.5 space-y-2 rounded-xl border border-line bg-card/55 p-2"
          >
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[0.6rem] font-medium text-fg-3">
                내보내기 형식
                <select
                  value={interchangeFormat}
                  onChange={(event) => setInterchangeFormat(event.target.value as StudioDialogueInterchangeFormat)}
                  aria-label="대사 내보내기 형식"
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-[0.66rem] text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {INTERCHANGE_FORMATS.map((format) => (
                    <option key={format.id} value={format.id}>{format.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-[0.6rem] font-medium text-fg-3">
                가져오기 연결
                <select
                  value={interchangeMatchMode}
                  onChange={(event) => setInterchangeMatchMode(event.target.value as StudioDialogueImportMatchMode)}
                  aria-label="가져온 대사 연결 방식"
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-[0.66rem] text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <option value="auto">ID→페이지→순서</option>
                  <option value="id">ID만</option>
                  <option value="page-order">페이지·컷 순서</option>
                  <option value="document-order">문서 읽기 순서</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={exportInterchange}
                disabled={items.length === 0 || interchangeBusy}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel text-[0.66rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={13} aria-hidden /> 내보내기
              </button>
              <label className={cx(
                "flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-accent text-[0.66rem] font-semibold text-on-accent transition-opacity hover:opacity-90 focus-within:outline focus-within:outline-2 focus-within:outline-accent",
                interchangeBusy && "cursor-wait opacity-50"
              )}>
                <Upload size={13} aria-hidden /> {interchangeBusy ? "읽는 중" : "가져오기"}
                <input
                  type="file"
                  accept=".csv,.tsv,.json,.fountain,.fdx,.srt,.vtt,.md,.txt,text/plain,text/csv,text/vtt,application/json,application/xml,text/xml"
                  className="sr-only"
                  disabled={interchangeBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void importInterchange(file);
                  }}
                />
              </label>
            </div>
            <p className="text-[0.6rem] leading-relaxed text-fg-4">
              ID가 있는 JSON/CSV는 가장 정확합니다. FDX는 적용 전 구조 손실을 확인하며,
              SRT·VTT는 캔버스 좌표가 없어 순서로 연결합니다.
            </p>
            {pendingFdxImport?.parsed.lossPreview ? (
              <section
                aria-labelledby={fdxPreviewHeadingId}
                className="space-y-2 rounded-xl border border-warn/40 bg-warn/10 p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3
                      id={fdxPreviewHeadingId}
                      className="text-[0.68rem] font-bold text-fg"
                    >
                      FDX 손실 미리보기
                    </h3>
                    <p
                      className="mt-0.5 truncate text-[0.58rem] text-fg-3"
                      title={pendingFdxImport.fileName}
                    >
                      {pendingFdxImport.fileName}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-warn/45 bg-panel/70 px-2 py-0.5 text-[0.56rem] font-semibold text-fg-2">
                    적용 전 확인
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-1 text-[0.59rem] sm:grid-cols-4">
                  {[
                    ["원본 문단", pendingFdxImport.parsed.lossPreview.sourceParagraphs],
                    ["가져올 대사", pendingFdxImport.parsed.lossPreview.emittedCues],
                    ["문맥만 사용", pendingFdxImport.parsed.lossPreview.contextOnlyElements],
                    ["제외", pendingFdxImport.parsed.lossPreview.droppedElements],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-lg border border-line/70 bg-panel/65 px-2 py-1.5"
                    >
                      <dt className="text-fg-4">{label}</dt>
                      <dd className="mt-0.5 font-bold tabular-nums text-fg">{value}</dd>
                    </div>
                  ))}
                </dl>

                {pendingFdxImport.parsed.lossPreview.items.some(
                  (item) => item.disposition !== "mapped"
                ) ? (
                  <div className="max-h-36 space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-line/70 bg-panel/55 p-1.5">
                    {pendingFdxImport.parsed.lossPreview.items
                      .filter((item) => item.disposition !== "mapped")
                      .slice(0, 12)
                      .map((item) => (
                        <div
                          key={`${item.sourceIndex}:${item.sourceType}`}
                          className="rounded-md px-1.5 py-1 text-[0.58rem] leading-relaxed text-fg-3"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cx(
                                "shrink-0 rounded-full border px-1.5 py-0.5 text-[0.52rem] font-semibold",
                                item.disposition === "dropped"
                                  ? "border-bad/35 bg-bad/10 text-bad"
                                  : "border-warn/35 bg-warn/10 text-fg-2"
                              )}
                            >
                              {item.disposition === "dropped" ? "제외" : "문맥"}
                            </span>
                            <strong className="min-w-0 truncate text-fg-2">
                              {item.sourceType} · {item.preview}
                            </strong>
                          </div>
                          <p className="mt-0.5 pl-1 text-fg-4">{item.detail}</p>
                        </div>
                      ))}
                    {pendingFdxImport.parsed.lossPreview.items.filter(
                      (item) => item.disposition !== "mapped"
                    ).length > 12 ? (
                      <p className="px-1.5 py-1 text-[0.56rem] text-fg-4">
                        나머지{" "}
                        {pendingFdxImport.parsed.lossPreview.items.filter(
                          (item) => item.disposition !== "mapped"
                        ).length - 12}
                        개 항목은 요약 수치에 포함되어 있습니다.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-lg border border-good/35 bg-good/10 px-2 py-1.5 text-[0.6rem] text-good">
                    지원 범위 밖에서 제외되는 문단이 없습니다.
                  </p>
                )}

                {pendingFdxImport.parsed.lossPreview.truncated ? (
                  <p className="text-[0.58rem] leading-relaxed text-warn">
                    매우 큰 파일이라 상세 목록은 안전 예산에서 줄였습니다. 위 합계에는 전체
                    분석 결과가 반영되어 있습니다.
                  </p>
                ) : null}

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={cancelPendingFdxImport}
                    disabled={interchangeBusy}
                    className="min-h-11 rounded-lg border border-line bg-panel px-2 text-[0.64rem] font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmPendingFdxImport()}
                    disabled={interchangeBusy}
                    className="min-h-11 rounded-lg bg-accent px-2 text-[0.64rem] font-semibold text-on-accent transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-50"
                  >
                    {interchangeBusy ? "적용 중" : "확인하고 적용"}
                  </button>
                </div>
                <p className="text-[0.56rem] leading-relaxed text-fg-4">
                  적용은 문서 기록 한 번으로 반영되며 실행 취소 한 번으로 되돌릴 수 있습니다.
                </p>
              </section>
            ) : null}
            {interchangeStatus && (
              <p
                role={interchangeStatus.tone === "bad" ? "alert" : "status"}
                className={cx(
                  "rounded-lg border px-2 py-1.5 text-[0.62rem] leading-relaxed",
                  interchangeStatus.tone === "good" && "border-good/35 bg-good/10 text-good",
                  interchangeStatus.tone === "warn" && "border-warn/35 bg-warn/10 text-fg-2",
                  interchangeStatus.tone === "bad" && "border-bad/35 bg-bad/10 text-bad"
                )}
              >
                {interchangeStatus.text}
              </p>
            )}
          </div>
        )}
      </section>
      {/* 찾아바꾸기 — 적용 전 매치 미리보기를 보여주고, 적용은 실행취소 1회로 복구된다. */}
      <div className="space-y-1.5 border-b border-line/60 px-3 py-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          <input
            ref={findInputRef}
            type="text"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="찾기"
            aria-label="찾을 대사"
            className={inputClass}
          />
          <input
            type="text"
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            placeholder="바꾸기"
            aria-label="바꿀 대사"
            className={inputClass}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              aria-pressed={scope === s.id}
              className={cx(
                "min-h-11 rounded-full border px-3 py-1 text-[0.62rem] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                scope === s.id
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-card text-fg-3 hover:bg-raised"
              )}
            >
              {s.label}
            </button>
          ))}
          <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-1.5 text-[0.62rem] text-fg-3">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="accent-accent"
            />
            대소문자 구분
          </label>
        </div>
        {find ? (
          <p className="text-[0.62rem] leading-snug text-fg-3" role="status">
            {plan.totalCount > 0 ? (
              <>
                <span className="font-semibold text-fg-2">{plan.totalCount}건</span> · 요소{" "}
                {plan.elementCount}개 · {plan.pageCount}페이지
              </>
            ) : (
              "일치하는 대사가 없어요."
            )}
            {plan.lockedSkipped > 0 && (
              <span className="text-fg-4"> · 잠긴 요소 {plan.lockedSkipped}개 제외</span>
            )}
          </p>
        ) : (
          <p className="text-[0.62rem] leading-snug text-fg-4">
            찾을 문구를 입력하면 바꾸기 전에 매치 수를 미리 보여줘요.
          </p>
        )}
        <button
          type="button"
          onClick={applyReplace}
          disabled={plan.totalCount === 0}
          className={cx(
            "flex min-h-11 w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            plan.totalCount > 0
              ? "bg-accent text-on-accent hover:opacity-90"
              : "cursor-not-allowed bg-card text-fg-4"
          )}
        >
          <Replace size={12} /> 모두 바꾸기
        </button>
        {onApplyFormat || onConvertTextToBubble ? (
          <div
            role="group"
            aria-label="목록 대사 일괄 서식"
            className="space-y-1.5 border-t border-line/60 pt-2"
          >
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[0.58rem] font-medium text-fg-3">서식 범위</span>
              <button
                type="button"
                aria-pressed={formatScope === "visible"}
                onClick={() => setFormatScope("visible")}
                className={cx(
                  "min-h-9 rounded-lg border px-2 text-[0.6rem] font-semibold transition-colors",
                  formatScope === "visible"
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
                )}
              >
                목록 전체
              </button>
              <button
                type="button"
                aria-pressed={formatScope === "selected"}
                onClick={() => setFormatScope("selected")}
                disabled={!hasFormatSelection}
                className={cx(
                  "min-h-9 rounded-lg border px-2 text-[0.6rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  formatScope === "selected"
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
                )}
                title={
                  formatSelectionCount > 1
                    ? `캔버스에서 고른 대사 ${formatSelectionCount}개`
                    : "캔버스/목록에서 고른 대사"
                }
              >
                선택만
              </button>
              {formatSelectionCount > 1 ? (
                <span className="text-[0.58rem] tabular-nums text-fg-3" role="status">
                  {formatSelectionCount}개 선택
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => applyFormatToVisible({ fontStyle: "bold" }, "굵게")}
                disabled={shown.every((item) => item.locked)}
                className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-1 text-[0.62rem] font-bold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
                title="굵게"
              >
                굵게
              </button>
              <button
                type="button"
                onClick={() => applyFormatToVisible({ fontStyle: "italic" }, "기울임")}
                disabled={shown.every((item) => item.locked)}
                className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-1 text-[0.62rem] italic text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
                title="기울임"
              >
                기울임
              </button>
              <button
                type="button"
                onClick={() => applyFormatToVisible({ fontSize: 22 }, "22px")}
                disabled={shown.every((item) => item.locked)}
                className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-1 text-[0.62rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                22px
              </button>
              <button
                type="button"
                onClick={() => applyFormatToVisible({ fontSize: 28 }, "28px")}
                disabled={shown.every((item) => item.locked)}
                className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-1 text-[0.62rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                28px
              </button>
              <button
                type="button"
                onClick={() => applyFormatToVisible({ textColor: "#111111" }, "검정 글자")}
                disabled={shown.every((item) => item.locked)}
                className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-1 text-[0.62rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                검정
              </button>
              <button
                type="button"
                onClick={() => applyFormatToVisible({ textColor: "#c2410c" }, "강조 주황")}
                disabled={shown.every((item) => item.locked)}
                className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-1 text-[0.62rem] font-semibold text-accent hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                강조
              </button>
              <button
                type="button"
                onClick={() => applyFormatToVisible({ align: "center" }, "가운데 정렬")}
                disabled={shown.every((item) => item.locked)}
                className="col-span-2 flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-1 text-[0.62rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                가운데
              </button>
            </div>
            {onConvertTextToBubble || onConvertTextsToBubbles ? (
              <button
                type="button"
                onClick={convertAllVisibleTextToBubble}
                disabled={!shown.some((item) => item.elType === "text" && !item.locked)}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft/40 px-2 text-[0.66rem] font-semibold text-fg hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
                title="목록에 보이는 자유 텍스트를 한 번에 말풍선으로 바꿉니다"
              >
                <MessageCircle size={13} aria-hidden /> 목록 텍스트 → 말풍선
              </button>
            ) : null}
            {formatStatus ? (
              <p
                role="status"
                className={cx(
                  "rounded-md px-2 py-1.5 text-[0.6rem] leading-snug",
                  formatStatus.tone === "good" ? "bg-good/10 text-good" : "bg-warn/10 text-warn"
                )}
              >
                {formatStatus.text}
              </p>
            ) : (
              <p className="text-[0.58rem] leading-snug text-fg-4">
                서식·말풍선 변환은 문서에 바로 저장되며 실행 취소 1회로 되돌립니다.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* 브라우저 내장 음성으로 페이지 순서의 대사를 들어보는 비파괴 검수 도구. */}
      <section
        aria-labelledby={readAloudHeadingId}
        className="space-y-2 border-b border-line/60 px-3 py-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <p id={readAloudHeadingId} className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-fg-2">
            <Volume2 size={14} aria-hidden />
            대사 낭독 검수
          </p>
          {speechAdapter.supported && (
            <span className="shrink-0 text-[0.6rem] tabular-nums text-fg-3">
              {readAloudQueue.length}개
            </span>
          )}
        </div>

        {!speechAdapter.supported ? (
          <p
            role="status"
            className="rounded-lg border border-line bg-card/45 px-2.5 py-2 text-[0.65rem] leading-relaxed text-fg-3"
          >
            이 브라우저는 음성 낭독을 지원하지 않아요. 대사 편집은 그대로 사용할 수 있습니다.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={playShownDialogue}
                disabled={readAloudQueue.length === 0 || !selectedVoice}
                aria-label="검색된 대사 전체 낭독"
                aria-pressed={isActive}
                aria-busy={playback.status === "playing"}
                className="flex min-h-11 items-center justify-center gap-1 rounded-lg bg-accent px-2 text-[0.65rem] font-semibold text-on-accent transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play size={13} aria-hidden /> 전체 재생
              </button>
              <button
                type="button"
                onClick={togglePause}
                disabled={!canPause}
                aria-label={playback.status === "paused" ? "대사 낭독 계속" : "대사 낭독 일시 정지"}
                aria-pressed={playback.status === "paused"}
                className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.65rem] font-medium text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                {playback.status === "paused" ? (
                  <Play size={13} aria-hidden />
                ) : (
                  <Pause size={13} aria-hidden />
                )}
                {playback.status === "paused" ? "계속" : "일시 정지"}
              </button>
              <button
                type="button"
                onClick={() => readAloudController.stop()}
                disabled={!isActive}
                aria-label="대사 낭독 중지"
                className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.65rem] font-medium text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Square size={12} aria-hidden /> 중지
              </button>
            </div>

            <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-1.5">
              <label className="min-w-0 text-[0.6rem] font-medium text-fg-3">
                속도 {readAloudRate.toFixed(1)}×
                <select
                  value={readAloudRate}
                  onChange={(event) => setReadAloudRate(Number(event.target.value))}
                  aria-label="대사 낭독 속도"
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-2 text-[0.66rem] text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {READ_ALOUD_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate.toFixed(1)}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-[0.6rem] font-medium text-fg-3">
                시스템 음성
                <select
                  value={selectedVoice ? dialogueSpeechVoiceKey(selectedVoice) : ""}
                  onChange={(event) => setSelectedVoiceKey(event.target.value)}
                  aria-label="대사 낭독 시스템 음성"
                  disabled={selectableVoices.length === 0}
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-2 text-[0.66rem] text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {selectableVoices.length === 0 ? (
                    <option value="">기기 내 음성 없음</option>
                  ) : (
                    selectableVoices.map((voice) => (
                      <option key={dialogueSpeechVoiceKey(voice)} value={dialogueSpeechVoiceKey(voice)}>
                        {voice.name} · {voice.lang} · {isConfirmedLocalDialogueVoice(voice) ? "기기 내" : "온라인 가능"}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            {onlineOrUnknownVoiceCount > 0 ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 px-2.5 py-2 text-[0.62rem] leading-snug text-fg-2">
                <input
                  type="checkbox"
                  checked={allowOnlineVoices}
                  onChange={(event) => {
                    readAloudController.stop();
                    setAllowOnlineVoices(event.target.checked);
                  }}
                  aria-label="온라인 시스템 음성 허용"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span>
                  <span className="font-semibold">온라인 음성 허용</span>
                  <span className="mt-0.5 block text-fg-3">
                    선택하면 대사가 운영체제·브라우저의 음성 서비스로 전송될 수 있어요. ToonSpectrum 서버와 AI에는 보내지 않습니다.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-[0.6rem] leading-snug text-good">확인된 기기 내 음성만 사용합니다.</p>
            )}

            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={cx(
                "min-h-4 text-[0.62rem] leading-snug",
                playback.status === "error" ? "text-bad" : "text-fg-3"
              )}
            >
              {statusText}
            </p>
          </>
        )}
      </section>

      {/* 대사 목록 — 클릭=캔버스 선택, 텍스트는 그 자리에서 수정. */}
      <div className="px-3 py-2.5">
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-4" aria-hidden />
          <input
            type="text"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="목록에서 검색..."
            aria-label="대사 목록 검색"
            className={cx(inputClass, "pl-6")}
          />
        </div>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[0.66rem] leading-relaxed text-fg-4">
            아직 말풍선·텍스트가 없어요. 상단 도구의 말풍선 메뉴에서 대사를 넣으면 여기에서 한꺼번에
            고칠 수 있어요.
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[0.66rem] leading-relaxed text-fg-4">
            검색과 일치하는 대사가 없어요.
          </p>
        ) : (
          <div className="space-y-2.5">
            {grouped.map((group) => (
              <section key={group.pageId} aria-label={`${group.pageIndex + 1}페이지 대사`}>
                <p className="mb-1 flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-wide text-fg-3">
                  {group.pageIndex + 1}페이지
                  {group.pageId === currentPageId && (
                    <span className="rounded-full border border-accent/40 bg-accent-soft/40 px-1.5 text-[0.55rem] font-medium normal-case text-accent">
                      현재
                    </span>
                  )}
                </p>
                <ul className="space-y-1.5">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className={cx(
                        "rounded-lg border p-1.5 transition-colors",
                        item.id === selectedId
                          ? "border-accent/60 bg-accent-soft/30"
                          : "border-line bg-card/45"
                      )}
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        {item.elType === "bubble" ? (
                          <MessageCircle size={11} className="shrink-0 text-fg-3" aria-hidden />
                        ) : (
                          <TypeIcon size={11} className="shrink-0 text-fg-3" aria-hidden />
                        )}
                        <button
                          type="button"
                          onClick={() => focusDialogueEditor(item)}
                          className="min-h-11 min-w-0 flex-1 truncate rounded-md px-1 text-left text-[0.66rem] font-medium text-fg-2 transition-colors hover:bg-raised hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          aria-label={`${item.pageIndex + 1}페이지 ${dialogueItemTypeLabel(item)} "${dialogueExcerpt(item.text, 16)}" 선택하고 대사 편집`}
                          title={item.locked ? "잠금을 풀면 편집할 수 있어요" : "선택하고 바로 대사 편집"}
                        >
                          {dialogueItemTypeLabel(item)}
                        </button>
                        {item.locked && (
                          <span className="shrink-0 rounded border border-line px-1 text-[0.55rem] text-fg-4">
                            잠김
                          </span>
                        )}
                        {item.hidden && (
                          <span className="shrink-0 rounded border border-line px-1 text-[0.55rem] text-fg-4">
                            숨김
                          </span>
                        )}
                        {speechAdapter.supported && (
                          <button
                            type="button"
                            onClick={() => playSingleDialogue(item)}
                            disabled={!selectedVoice || !(drafts[item.id] ?? item.text).trim()}
                            aria-label={`${item.pageIndex + 1}페이지 ${dialogueItemTypeLabel(item)} 대사만 낭독하고 캔버스에서 선택`}
                            aria-pressed={isActive && playback.currentItemId === item.id}
                            aria-busy={
                              playback.status === "playing" && playback.currentItemId === item.id
                            }
                            className={cx(
                              "grid size-11 shrink-0 place-items-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40",
                              isActive && playback.currentItemId === item.id
                                ? "border-accent bg-accent text-on-accent"
                                : "border-line bg-card text-fg-2 hover:bg-raised"
                            )}
                          >
                            <Volume2 size={16} aria-hidden />
                          </button>
                        )}
                        {(onSplitText || onMergeWithNext || onTransferElement || onConvertTextToBubble || onApplyDialogueRuby || onClearDialogueRuby) && !item.locked ? (
                          <button
                            type="button"
                            onClick={() => {
                              setStructureMenuId((current) => current === item.id ? null : item.id);
                              captureTextareaSelection(item.id);
                            }}
                            aria-label={`${item.pageIndex + 1}페이지 ${dialogueItemTypeLabel(item)} "${dialogueExcerpt(item.text, 16)}" 구조 작업`}
                            aria-expanded={structureMenuId === item.id}
                            className={cx(
                              "grid size-11 shrink-0 place-items-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                              structureMenuId === item.id
                                ? "border-accent bg-accent-soft text-accent"
                                : "border-line bg-card text-fg-2 hover:bg-raised"
                            )}
                          >
                            <MoreHorizontal size={16} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                      <textarea
                        ref={(node) => {
                          if (node) textareaRefs.current.set(item.id, node);
                          else textareaRefs.current.delete(item.id);
                        }}
                        value={drafts[item.id] ?? item.text}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        onSelect={() => captureTextareaSelection(item.id)}
                        onKeyUp={() => captureTextareaSelection(item.id)}
                        onMouseUp={() => captureTextareaSelection(item.id)}
                        onFocus={() => {
                          if (selectedId !== item.id) onSelectElement(item.pageId, item.id);
                          captureTextareaSelection(item.id);
                        }}
                        onBlur={() => {
                          if (skipBlurCommitIdRef.current === item.id) {
                            skipBlurCommitIdRef.current = null;
                            return;
                          }
                          commitDraft(item);
                        }}
                        onCompositionStart={() => composingIdsRef.current.add(item.id)}
                        onCompositionEnd={() => composingIdsRef.current.delete(item.id)}
                        onKeyDown={(e) => {
                          if (
                            e.nativeEvent.isComposing ||
                            e.nativeEvent.keyCode === 229 ||
                            composingIdsRef.current.has(item.id)
                          ) {
                            return;
                          }
                          if (e.key === "Escape") {
                            // 패널 닫힘(Esc)과 분리 — 임시본만 되돌린다.
                            e.stopPropagation();
                            revertDraft(item.id);
                          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            if (e.repeat) return;
                            e.preventDefault();
                            e.stopPropagation();
                            commitAndMove(item, e.shiftKey ? "previous" : "next");
                          }
                        }}
                        disabled={item.locked}
                        rows={Math.min(4, Math.max(1, (drafts[item.id] ?? item.text).split("\n").length))}
                        aria-label={`${item.pageIndex + 1}페이지 ${dialogueItemTypeLabel(item)} 대사 수정`}
                        className={cx(
                          inputClass,
                          "resize-y py-1 leading-snug disabled:cursor-not-allowed disabled:opacity-50"
                        )}
                      />
                      {(() => {
                        const draftText = drafts[item.id] ?? item.text;
                        const rubySpans = readRubySpansFromPages(pages, item.pageId, item.id);
                        if (!rubySpans?.length) return null;
                        const preview = formatDialogueTextWithRubyPreview(draftText, rubySpans);
                        if (preview === draftText) return null;
                        return (
                          <p
                            className="mt-1 rounded-md border border-line/50 bg-card/40 px-2 py-1 text-[0.62rem] leading-snug text-fg-3"
                            aria-label={`${item.pageIndex + 1}페이지 루비 미리보기`}
                          >
                            {preview}
                          </p>
                        );
                      })()}
                      {structureMenuId === item.id ? (
                        <div
                          role="group"
                          aria-label={`${item.pageIndex + 1}페이지 대사 구조 편집`}
                          className="mt-1.5 rounded-lg border border-line bg-panel p-1.5"
                        >
                          <div className="grid grid-cols-2 gap-1">
                            {onSplitText ? (
                              <button
                                type="button"
                                onPointerDown={(event) => event.preventDefault()}
                                onClick={() => splitAtCaret(item)}
                                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                                title="대사 입력 커서가 있는 위치에서 둘로 나눕니다"
                              >
                                <Scissors size={13} aria-hidden /> 커서에서 나누기
                              </button>
                            ) : null}
                            {onMergeWithNext ? (
                              <button
                                type="button"
                                onClick={() => mergeWithNext(item)}
                                disabled={!nextDialogueById.get(item.id) || nextDialogueById.get(item.id)?.locked}
                                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
                                title="같은 페이지의 다음 대사를 현재 대사 뒤에 합칩니다"
                              >
                                <Combine size={13} aria-hidden /> 다음과 합치기
                              </button>
                            ) : null}
                            {onConvertTextToBubble && item.elType === "text" ? (
                              <button
                                type="button"
                                onClick={() => convertTextToBubble(item)}
                                className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                                title="자유 텍스트를 말풍선으로 바꿉니다. 한 번의 실행 취소로 되돌릴 수 있어요."
                              >
                                <MessageCircle size={13} aria-hidden /> 텍스트 → 말풍선
                              </button>
                            ) : null}
                          </div>
                          {(onApplyDialogueRuby || onClearDialogueRuby) &&
                          (selectionByItem[item.id] ?? null) ? (
                            <div className="mt-1.5 grid grid-cols-2 gap-1 border-t border-line/60 pt-1.5">
                              {onApplyDialogueRuby ? (
                                <>
                                  <label className="col-span-2 text-[0.58rem] font-medium text-fg-3">
                                    루비 읽기
                                    <input
                                      type="text"
                                      value={rubyReadingByItem[item.id] ?? ""}
                                      onChange={(event) =>
                                        setRubyReadingByItem((current) => ({
                                          ...current,
                                          [item.id]: event.target.value,
                                        }))
                                      }
                                      onPointerDown={(event) => event.stopPropagation()}
                                      placeholder="예: 한자"
                                      maxLength={80}
                                      aria-label={`${item.pageIndex + 1}페이지 선택 구간 루비 읽기`}
                                      className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-2 text-[0.66rem] text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onPointerDown={(event) => event.preventDefault()}
                                    onClick={() => applyRubyAtSelection(item)}
                                    disabled={!(rubyReadingByItem[item.id] ?? "").trim()}
                                    className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-[0.64rem] font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
                                    title="선택한 글자에 루비(후리가나)를 답니다"
                                  >
                                    루비 달기
                                  </button>
                                </>
                              ) : null}
                              {onClearDialogueRuby ? (
                                <button
                                  type="button"
                                  onPointerDown={(event) => event.preventDefault()}
                                  onClick={() => clearRubyAtSelection(item)}
                                  className={cx(
                                    "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                                    !onApplyDialogueRuby && "col-span-2"
                                  )}
                                  title="선택 구간과 겹치는 루비를 지웁니다"
                                >
                                  선택 루비 지우기
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {onTransferElement && pages.length > 1 ? (
                            <div className="mt-1.5 grid grid-cols-2 gap-1 border-t border-line/60 pt-1.5">
                              <label className="col-span-2 text-[0.58rem] font-medium text-fg-3">
                                대상 페이지
                                <select
                                  value={
                                    transferTargetByItem[item.id] ??
                                    pages.find((page) => page.id !== item.pageId)?.id ??
                                    ""
                                  }
                                  onChange={(event) => setTransferTargetByItem((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))}
                                  aria-label={`${item.pageIndex + 1}페이지 대사 이동 대상`}
                                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-2 text-[0.66rem] text-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                                >
                                  {pages.map((page, pageIndex) => page.id === item.pageId ? null : (
                                    <option key={page.id} value={page.id}>{pageIndex + 1}페이지</option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                onClick={() => transferElement(item, "move")}
                                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-[0.64rem] font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                              >
                                <ArrowRight size={13} aria-hidden /> 이동
                              </button>
                              <button
                                type="button"
                                onClick={() => transferElement(item, "copy")}
                                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-[0.64rem] font-semibold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                              >
                                <Copy size={13} aria-hidden /> 복사
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      </div>

      <p className="border-t border-line/60 px-3 py-1.5 text-[0.58rem] leading-snug text-fg-4">
        ⌘/Ctrl+Enter 저장 후 다음 · Shift와 함께 누르면 이전 · ⋯에서 나누기·합치기·페이지 이동을 할 수 있어요.
      </p>
    </section>
  );
}
