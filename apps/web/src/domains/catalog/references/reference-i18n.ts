import type { ReferenceErrorCode, ReferenceField, ReferenceItem } from "@/shared/lib/kmas-reference";

import { registerI18nLocaleEntries } from "@/shared/lib/i18n";

const ko = {
  eyebrow: "COMIC REFERENCE LIBRARY", title: "다음 이야기의 시작,", titleAccent: "좋은 레퍼런스에서.",
  intro: "만화규장각의 도서·웹툰 정보를 찾아보고, 나만의 관찰을 연구노트에 남겨보세요.",
  source: "KMAS 공식 데이터", sourceName: "한국만화영상진흥원 · 만화규장각", studio: "스튜디오 열기",
  journeyTitle: "발견에서 창작으로", step1: "작품을 찾고", step1Body: "제목, 작가, 출판사로 탐색",
  step2: "나의 시선을 기록하고", step2Body: "좋았던 설정과 연출을 연구노트에",
  step3: "새로운 이야기를 시작하세요", step3Body: "출처는 남기고, 표현은 나답게",
  searchTab: "작품 검색", notesTab: "내 연구노트", guideTab: "이용 안내", nav: "레퍼런스 메뉴",
  searchTitle: "무엇에서 영감을 찾고 있나요?", field: "검색 기준", query: "검색어", search: "검색",
  titleField: "작품 제목", illustratorField: "그림작가", writerField: "글작가", publisherField: "출판사", platformField: "플랫폼", isbnField: "ISBN",
  placeholder: "제목이나 선택한 기준에 맞는 검색어를 입력하세요", searchHelp: "입력만으로는 API를 호출하지 않습니다. 검색 버튼을 누르거나 Enter를 입력하세요.",
  suggestion: "이렇게 시작해 보세요", suggestionTitle: "원피스 · 제목", suggestionPublisher: "대원씨아이 · 출판사", suggestionPlatform: "네이버웹툰 · 플랫폼",
  emptyTitle: "좋은 질문이 좋은 레퍼런스를 만듭니다", emptyBody: "작품의 제목부터, 좋아하는 작가의 이름부터. 검색 기준을 선택해 첫 작품을 찾아보세요.",
  emptyTag: "YOUR NEXT IDEA STARTS HERE", loading: "만화규장각에서 자료를 찾고 있습니다", results: "검색 결과", countUnit: "건", page: "페이지",
  pageScope: "KMAS 제공 순서입니다. 인기순위나 전체 시장 통계가 아닙니다.", cache: "캐시 데이터", fetched: "조회 시각", totalUnknown: "전체 건수 미제공",
  noResults: "검색 조건에 맞는 자료가 없습니다", noResultsBody: "짧은 제목으로 검색하거나, 작가·출판사 등 다른 검색 기준을 사용해 보세요.",
  previous: "이전", next: "다음", detail: "작품 정보", save: "연구노트에 담기", saved: "연구노트에 저장됨", remove: "노트 삭제", close: "닫기",
  missing: "정보 미제공", subtitle: "부제", genre: "장르", age: "연령등급", outline: "작품 소개", noOutline: "제공된 작품 소개가 없습니다.",
  noStoredOutline: "연구노트에는 작품 식별 정보와 내 메모만 보관합니다. 작품 소개는 검색 결과에서 확인하세요.",
  detailsDescription: "만화규장각이 제공한 작품 메타데이터입니다. 제공되지 않은 값은 추정하지 않습니다.",
  noteTitle: "나의 관찰", notePlaceholder: "인상 깊은 설정, 인물의 관계, 더 알아보고 싶은 점을 기록하세요.", noteSave: "메모 저장", noteHelp: "개인 메모는 이 브라우저에만 저장됩니다. 계정 간 동기화는 하지 않습니다.",
  copy: "출처 복사", copied: "출처를 복사했습니다.", copyFailed: "클립보드에 접근할 수 없습니다. 아래 출처를 직접 선택해 복사해 주세요.",
  savedNotice: "연구노트에 저장했습니다.", removedNotice: "연구노트에서 삭제했습니다.", noteSavedNotice: "메모를 저장했습니다.",
  storageWarning: "저장소를 읽을 수 없습니다. 기존 저장소는 덮어쓰지 않으며, 새 메모는 이번 화면에서만 유지됩니다. 내보내기로 보관하세요.",
  storageWriteWarning: "브라우저에 저장하지 못했습니다. 현재 노트는 이번 화면에서만 유지됩니다. 내보내기로 보관하세요.",
  limit: "연구노트는 최대 100개까지 보관할 수 있습니다. 먼저 기존 노트를 내보내고 정리해 주세요.",
  notesTitle: "아이디어가 쌓이는 나만의 서가", notesEmpty: "아직 담아둔 작품이 없습니다", notesEmptyBody: "작품 검색에서 책갈피 버튼을 눌러 나만의 연구노트를 시작하세요.",
  notesFilter: "저장한 노트에서 찾기", notesNoMatch: "일치하는 연구노트가 없습니다.", export: "노트 내보내기", exportFailed: "파일을 내보내지 못했습니다. 브라우저의 다운로드 권한을 확인하세요.",
  confirmRemove: "메모와 함께 삭제 확인", cancel: "취소",
  noNote: "아직 관찰 메모가 없습니다.", local: "이 브라우저에 저장", edit: "노트 열기", notice: "알림",
  guideTitle: "자료는 정확하게, 영감은 자유롭게", guideData: "어떤 정보를 볼 수 있나요?", guideDataBody: "KMAS 도서·웹툰 조회 API의 제목, 글·그림작가, 출판사, 플랫폼, 장르, 연령등급, ISBN과 작품 소개를 제공합니다. 검색 결과는 제공기관의 원문입니다.",
  guideRights: "표지와 원문은 복제하지 않습니다", guideRightsBody: "이 페이지는 메타데이터 탐색용입니다. 표지 이미지·만화 본문을 내려받거나 창작 에셋으로 제공하지 않습니다. API 이용이 개별 작품의 재사용 권한을 뜻하지는 않습니다.",
  guideConnection: "API 연결과 사용 한도", guideConnectionBody: "운영 서버의 KMAS_PRV_KEY에 승인된 키가 필요합니다. 공식 안내 기준 일일 신청 트래픽은 1,000회, 활용기간은 승인일부터 12개월입니다. 동일 검색은 서버에서 최대 30분 캐시합니다.",
  guideNotes: "개인 연구노트 보관", guideNotesBody: "최대 100개 작품의 식별 정보와 메모를 이 브라우저에 저장합니다. 브라우저 데이터 삭제 시 사라질 수 있으므로 Markdown 파일로 내보내 보관하세요. 계정 로그인 여부와 무관한 로컬 저장입니다.",
  officialGuide: "KMAS Open API 안내", attribution: "데이터 출처: 한국만화영상진흥원 만화규장각(KMAS)",
  errorTitle: "자료를 불러오지 못했습니다", retry: "다시 시도", INVALID_QUERY: "검색어는 1~120자로 입력하세요. ISBN은 10자리 또는 13자리이며 페이지는 1~1,000 범위입니다.",
  KMAS_NOT_CONFIGURED: "서버의 KMAS 인증키가 설정되지 않았거나 연결 설정을 확인해야 합니다. 운영자는 승인된 KMAS_PRV_KEY를 설정해 주세요. 연구노트는 계속 사용할 수 있습니다.",
  KMAS_RATE_LIMITED: "요청이 많거나 KMAS 사용 한도에 도달했습니다. 잠시 후 다시 검색해 주세요.",
  KMAS_TIMEOUT: "KMAS 응답 시간이 초과되었습니다. 검색 조건을 유지했으니 다시 시도해 주세요.",
  KMAS_UNAVAILABLE: "KMAS 연결 또는 응답을 확인할 수 없습니다. 실제 검색 결과를 대신할 임의 데이터는 표시하지 않습니다.",
};
const en: Record<keyof typeof ko, string> = {
  eyebrow: "COMIC REFERENCE LIBRARY", title: "Your next story starts", titleAccent: "with a good reference.",
  intro: "Explore comic and webtoon metadata from KMAS, and keep your own observations in a private research notebook.",
  source: "Official KMAS data", sourceName: "Korea Manhwa Contents Agency · KMAS", studio: "Open Studio",
  journeyTitle: "From discovery to creation", step1: "Find a work", step1Body: "Search by title, creator or publisher",
  step2: "Record what you notice", step2Body: "Keep ideas and observations in your notebook",
  step3: "Begin your own story", step3Body: "Credit the source. Make the expression yours.",
  searchTab: "Find references", notesTab: "My notebook", guideTab: "How it works", nav: "Reference navigation",
  searchTitle: "Where will you find inspiration?", field: "Search by", query: "Search term", search: "Search",
  titleField: "Title", illustratorField: "Illustrator", writerField: "Writer", publisherField: "Publisher", platformField: "Platform", isbnField: "ISBN",
  placeholder: "Enter a term matching your selected search field", searchHelp: "Typing does not call the API. Select Search or press Enter to submit.",
  suggestion: "Try a starting point", suggestionTitle: "원피스 · title", suggestionPublisher: "대원씨아이 · publisher", suggestionPlatform: "네이버웹툰 · platform",
  emptyTitle: "A good question makes a good reference", emptyBody: "Begin with a title or a favorite creator. Choose a search field to discover your first reference.",
  emptyTag: "YOUR NEXT IDEA STARTS HERE", loading: "Searching KMAS metadata", results: "Search results", countUnit: "results", page: "Page",
  pageScope: "Ordered by KMAS. These results are not popularity rankings or market statistics.", cache: "Cached data", fetched: "Retrieved", totalUnknown: "Total not provided",
  noResults: "No matching references", noResultsBody: "Try a shorter title or a different field, such as writer or publisher.",
  previous: "Previous", next: "Next", detail: "Work details", save: "Save to notebook", saved: "Saved to notebook", remove: "Delete note", close: "Close",
  missing: "Not provided", subtitle: "Subtitle", genre: "Genre", age: "Age rating", outline: "Synopsis", noOutline: "No synopsis was provided.",
  noStoredOutline: "Your notebook stores identifying metadata and personal notes only. Search results contain the available synopsis.",
  detailsDescription: "Work metadata supplied by KMAS. Missing values are not inferred.",
  noteTitle: "My observations", notePlaceholder: "Record an interesting setting, character relationship, or a question to explore.", noteSave: "Save note", noteHelp: "Personal notes stay in this browser. They are not synced to an account.",
  copy: "Copy citation", copied: "Citation copied.", copyFailed: "Clipboard unavailable. Select and copy the source text below.",
  savedNotice: "Saved to your notebook.", removedNotice: "Removed from your notebook.", noteSavedNotice: "Note saved.",
  storageWarning: "Existing browser storage could not be read and will not be overwritten. New notes last for this page session only. Export them to keep a copy.",
  storageWriteWarning: "Browser storage could not be written. Current notes last for this page session only. Export them to keep a copy.",
  limit: "The notebook holds up to 100 works. Export and organize existing notes before adding more.",
  notesTitle: "A bookshelf for your next idea", notesEmpty: "Your notebook is empty", notesEmptyBody: "Use the bookmark button in search results to start a research notebook.",
  notesFilter: "Search saved notes", notesNoMatch: "No matching notes.", export: "Export notes", exportFailed: "Export failed. Check your browser's download permissions.",
  confirmRemove: "Confirm deletion of note", cancel: "Cancel",
  noNote: "No observations yet.", local: "Stored in this browser", edit: "Open note", notice: "Notice",
  guideTitle: "Reliable sources. Original ideas.", guideData: "What data is available?", guideDataBody: "The KMAS book and webtoon API provides titles, writers, illustrators, publishers, platforms, genres, age ratings, ISBNs and synopses. Metadata remains in the provider's original language.",
  guideRights: "No copied covers or comic pages", guideRightsBody: "This page is for metadata research. It does not download covers or comic pages, or provide them as creative assets. API access does not grant reuse rights to individual works.",
  guideConnection: "API connection and limits", guideConnectionBody: "An approved KMAS_PRV_KEY must be configured on the server. The official guide lists 1,000 requests per day and a 12-month approval period. Identical searches are cached for up to 30 minutes on the server.",
  guideNotes: "Keep your personal research", guideNotesBody: "Up to 100 works and their personal notes can be stored in this browser. Export a Markdown copy before clearing browser data. Storage is local, independent of your account.",
  officialGuide: "KMAS Open API guide", attribution: "Data: Korea Manhwa Contents Agency · KMAS",
  errorTitle: "References could not be loaded", retry: "Try again", INVALID_QUERY: "Use 1–120 characters, a 10- or 13-character ISBN, and a page from 1 to 1,000.",
  KMAS_NOT_CONFIGURED: "The server needs an approved KMAS_PRV_KEY or a corrected connection setting. Your notebook is still available.",
  KMAS_RATE_LIMITED: "Too many requests or the KMAS quota has been reached. Please try again later.",
  KMAS_TIMEOUT: "KMAS took too long to respond. Your search has been preserved so you can retry.",
  KMAS_UNAVAILABLE: "The KMAS connection or response could not be verified. No invented results will be substituted.",
};
for (const [locale, entries] of Object.entries({ ko, en })) {
  registerI18nLocaleEntries(locale, Object.fromEntries(Object.entries(entries).map(([key, value]) => [`ref.${key}`, value])));
}


registerI18nLocaleEntries("ko", {
  "ref.storageWarning": "저장소를 읽을 수 없습니다. 기존 데이터는 덮어쓰지 않으며 저장 기능이 중단됩니다. 편집 중인 초안은 복사해 별도로 보관해 주세요.",
  "ref.storageWriteWarning": "기기에 저장하지 못했습니다. 편집창의 초안은 유지되며 저장된 노트를 덮어쓰지 않았습니다.",
  "ref.noteConflict": "다른 탭에서 이 노트가 변경되었습니다. 저장하지 않았으며 입력한 초안은 그대로 유지됩니다. 최신 메모와 비교해 주세요.",
  "ref.noteChangedElsewhere": "저장된 메모가 편집을 시작한 이후 변경되었습니다. 아래는 최신 메모이며, 입력 중인 초안은 유지됩니다.",
  "ref.reloadLatest": "최신 메모 불러오기",
  "ref.replaceDraftConfirm": "현재 저장하지 않은 초안을 버리고 최신 메모로 바꿀까요?",
  "ref.lockUnavailable": "이 브라우저에서는 탭 간 안전한 저장을 지원하지 않습니다. 읽기와 내보내기는 가능하며, 저장에는 HTTPS 환경의 최신 브라우저가 필요합니다.",
  "ref.saving": "저장 중…",
  "ref.backup": "JSON 백업",
  "ref.importBackup": "백업 복원",
  "ref.backupHelp": "JSON으로 백업하고 복원할 수 있습니다. 복원은 새 자료만 추가하며 기존 메모는 유지합니다. 최대 2 MiB · 총 100개.",
  "ref.importedNotice": "백업을 확인했습니다. 새 자료만 추가했으며 이미 저장된 자료의 메모는 변경하지 않았습니다.",
  "ref.invalidBackup": "유효한 툰스튜디오 연구노트 백업이 아니거나 크기·메모 한도를 초과했습니다. 기존 데이터는 변경하지 않았습니다.",
});
registerI18nLocaleEntries("en", {
  "ref.storageWarning": "Browser storage could not be read. Existing data will not be overwritten and saving is unavailable. Copy an unsaved draft to keep it separately.",
  "ref.storageWriteWarning": "The write failed. Your editor draft is preserved and stored notes were not overwritten.",
  "ref.noteConflict": "Another tab changed this note. Nothing was saved and your draft is preserved. Compare it with the latest note.",
  "ref.noteChangedElsewhere": "The stored note changed after you started editing. The latest note is shown below; your draft is preserved.",
  "ref.reloadLatest": "Load latest note",
  "ref.replaceDraftConfirm": "Discard your unsaved draft and load the latest note?",
  "ref.lockUnavailable": "Safe cross-tab saving is not supported in this browser. Reading and export still work. Use a current browser over HTTPS to save.",
  "ref.saving": "Saving…",
  "ref.backup": "JSON backup",
  "ref.importBackup": "Restore backup",
  "ref.backupHelp": "Back up and restore JSON. Restore adds new references and preserves existing notes. Maximum 2 MiB and 100 notes total.",
  "ref.importedNotice": "Backup checked. New references were added; existing notes were left unchanged.",
  "ref.invalidBackup": "This is not a valid ToonStudio notebook backup, or a size/note limit was exceeded. Existing data was not changed.",
});

registerI18nLocaleEntries("ko", {
  "ref.readingBackup": "백업 파일을 검사하고 있습니다. 아직 저장소를 변경하지 않았습니다.",
  "ref.importPreview": "복원 전 변경 내용 확인",
  "ref.importNew": "새로 추가", "ref.importKept": "기존 자료 유지", "ref.importDifferent": "서로 다른 메모 유지", "ref.importTotal": "복원 후 노트 수",
  "ref.importPreviewHelp": "확인하기 전에는 저장하지 않습니다. 동일 자료의 기존 메모는 덮어쓰지 않으며, 확정 시 최신 저장소를 다시 확인합니다.",
  "ref.importNoNew": "추가할 새 자료가 없습니다. 기존 노트는 그대로 유지됩니다.", "ref.importConfirm": "새 자료만 추가 확인",
  "ref.draftRetained": "초안을 이 탭에 임시 보관했습니다. 새로고침 후에도 복구할 수 있지만 탭을 닫으면 사라질 수 있습니다. 영구 보관은 메모 저장을 눌러주세요.",
  "ref.draftRecovered": "이 탭의 미저장 초안을 복구했습니다. 저장된 메모와 다를 수 있으니 내용을 확인해 주세요.",
  "ref.draftUnavailable": "초안을 임시 보관하지 못했습니다. 입력 내용은 편집창에만 있으므로 닫거나 새로고침하기 전에 복사해 주세요. 임시 초안은 최대 20개·256 KiB입니다.",
  "ref.draftCleanupFailed": "노트 작업은 완료했지만 임시 초안을 정리하지 못했습니다. 복구 목록에 이전 초안이 남아 있을 수 있습니다.",
  "ref.draftsTitle": "이 탭의 미저장 초안", "ref.draftsHelp": "임시 보관된 초안입니다. 계정과 동기화되지 않으며 탭을 닫으면 사라질 수 있습니다.", "ref.recoverDraft": "초안 복구",
  "ref.unsavedClose": "영구 저장하지 않은 메모가 있습니다. 편집창의 임시 보관 상태를 확인한 뒤 닫으시겠습니까?",
});
registerI18nLocaleEntries("en", {
  "ref.readingBackup": "Checking the backup. Nothing has been written yet.",
  "ref.importPreview": "Review changes before restoring",
  "ref.importNew": "New references", "ref.importKept": "Existing references kept", "ref.importDifferent": "Different existing notes kept", "ref.importTotal": "Notes after restore",
  "ref.importPreviewHelp": "Nothing is saved until you confirm. Existing notes are never overwritten. Storage is checked again when you confirm.",
  "ref.importNoNew": "There are no new references to add. Existing notes are unchanged.", "ref.importConfirm": "Confirm adding new references",
  "ref.draftRetained": "Draft retained in this tab for reload recovery. It may disappear when the tab closes. Use Save note to keep it permanently.",
  "ref.draftRecovered": "Recovered an unsaved draft from this tab. Review it against the stored note before saving.",
  "ref.draftUnavailable": "Draft recovery storage is unavailable. Copy your text before closing or reloading. Draft limits: 20 entries and 256 KiB.",
  "ref.draftCleanupFailed": "The notebook operation completed, but the temporary draft could not be removed. An older draft may remain in recovery.",
  "ref.draftsTitle": "Unsaved drafts in this tab", "ref.draftsHelp": "Temporary recovery only. Drafts do not sync to an account and may disappear when this tab closes.", "ref.recoverDraft": "Recover draft",
  "ref.unsavedClose": "This note is not permanently saved. Have you checked its temporary draft status before closing?",
});

// Keys the UI picks at runtime. They stay literal strings inside closed maps — never template
// literals at the call site — so the dictionary above remains the single source of truth and
// reference-i18n.test.ts can prove each value resolves in both shell locales.
export const REFERENCE_ERROR_MESSAGE_KEYS = {
  INVALID_QUERY: "ref.INVALID_QUERY",
  KMAS_NOT_CONFIGURED: "ref.KMAS_NOT_CONFIGURED",
  KMAS_RATE_LIMITED: "ref.KMAS_RATE_LIMITED",
  KMAS_TIMEOUT: "ref.KMAS_TIMEOUT",
  KMAS_UNAVAILABLE: "ref.KMAS_UNAVAILABLE",
} as const satisfies Record<ReferenceErrorCode, string>;

export const REFERENCE_FIELD_LABEL_KEYS = {
  title: "ref.titleField", illustrator: "ref.illustratorField", writer: "ref.writerField",
  publisher: "ref.publisherField", platform: "ref.platformField", isbn: "ref.isbnField",
} as const satisfies Record<ReferenceField, string>;

export const REFERENCE_METADATA_FIELDS = [
  "subtitle", "writer", "illustrator", "publisher", "platform", "genre", "age", "isbn",
] as const satisfies readonly (keyof ReferenceItem)[];
export type ReferenceMetadataField = (typeof REFERENCE_METADATA_FIELDS)[number];
export const REFERENCE_METADATA_LABEL_KEYS = {
  subtitle: "ref.subtitle", writer: "ref.writerField", illustrator: "ref.illustratorField", publisher: "ref.publisherField",
  platform: "ref.platformField", genre: "ref.genre", age: "ref.age", isbn: "ref.isbnField",
} as const satisfies Record<ReferenceMetadataField, string>;

export const REFERENCE_VIEWS = ["search", "notes", "guide"] as const;
export type ReferenceView = (typeof REFERENCE_VIEWS)[number];
export const REFERENCE_VIEW_TAB_KEYS = {
  search: "ref.searchTab", notes: "ref.notesTab", guide: "ref.guideTab",
} as const satisfies Record<ReferenceView, string>;

export const REFERENCE_JOURNEY_STEPS = [
  { title: "ref.step1", body: "ref.step1Body" },
  { title: "ref.step2", body: "ref.step2Body" },
  { title: "ref.step3", body: "ref.step3Body" },
] as const;

export const REFERENCE_GUIDE_SECTIONS = [
  { title: "ref.guideData", body: "ref.guideDataBody" },
  { title: "ref.guideRights", body: "ref.guideRightsBody" },
  { title: "ref.guideConnection", body: "ref.guideConnectionBody" },
  { title: "ref.guideNotes", body: "ref.guideNotesBody" },
] as const;

export const REFERENCE_NOTICE_KEYS = {
  savedNotice: "ref.savedNotice", removedNotice: "ref.removedNotice", noteSavedNotice: "ref.noteSavedNotice", importedNotice: "ref.importedNotice",
  copied: "ref.copied", copyFailed: "ref.copyFailed", exportFailed: "ref.exportFailed",
  noteConflict: "ref.noteConflict", storageWriteWarning: "ref.storageWriteWarning", limit: "ref.limit",
  lockUnavailable: "ref.lockUnavailable", invalidBackup: "ref.invalidBackup",
  draftRetained: "ref.draftRetained", draftRecovered: "ref.draftRecovered", draftUnavailable: "ref.draftUnavailable", draftCleanupFailed: "ref.draftCleanupFailed",
} as const;
export type ReferenceNotice = keyof typeof REFERENCE_NOTICE_KEYS;
