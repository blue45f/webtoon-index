// 스톡 사진 검색 패널 — Unsplash BYOK(Bring Your Own Key) 검색 + 캔버스 삽입.
//
// StudioAiCompositionPanel과 동일하게 **자기완결형(self-contained)**이다 — 검색어/결과/busy/error를
// 전부 이 컴포넌트가 직접 useState로 소유하고, studio-stock-image-client.ts의 세 함수
// (searchStockPhotos/inlineStockPhotoForCanvas/triggerStockImageDownload)도 전부 이 안에서 직접
// 호출한다.
//
// Access Key **입력 UI는 이 패널에 없다** — StudioIntegrationsSettingsPanel(통합 "연동 설정" 패널)로
// 옮겨졌다(2026-07 API 키 등록 동선 통합 — AI 어시스트 설정과 한 곳에서 관리하도록). 이 패널은 여전히
// 마운트 시점에 저장된 Access Key를 읽어(검색·다운로드 트리거 호출에 실제 키 값이 필요하므로) 설정
// 여부만 판단하고, 미설정이면 안내 문구 + onOpenSettings 콜백으로 통합 설정 패널을 열도록 안내한다.
// menu는 StudioPage.tsx에서 단일 값이라 이 패널과 통합 설정 패널이 동시에 열리는 일이 없으므로,
// "마운트 시점에만 재로드"로 충분하다(통합 설정 패널에서 키를 바꾼 뒤 이 팝오버를 다시 열면 항상
// 새로 마운트되어 최신 값을 읽는다).
//
// 부모에게 필요한 건 onInsert/onOpenSettings 콜백 두 개뿐이다 — 이 패널이 이미 (1) 선택한 사진을 이
// 앱의 "항상 data: URL" 불변식에 맞게 인라인 변환하고 (2) Unsplash API Guidelines가 요구하는
// download_location 트리거를 fire-and-forget으로 쏜 뒤에 onInsert를 호출하므로, 부모는 그냥 주어진
// dataUrl/width/height/사진 메타데이터를 캔버스에 얹기만 하면 된다(addRenderedImage와 동일한 "이미
// 준비된 이미지 삽입" 책임 분리).
//
// 이 패널은 "생성형 AI 최초 사용 고지" 모달의 대상이 **아니다** — Unsplash 사진은 실사진(라이선스
// 사진)이지 AI 생성물이 아니다.
//
// "AI 연동" 툴바 그룹 팝오버 안에 서브탭 콘텐츠로 얹힌다 — 팝오버 위치·z-index·max-height는 호출부
// (StudioPage.tsx의 AI 연동 그룹 wrapper)가 담당한다(2026-07-05 툴바 그룹화로 이관). 이 컴포넌트는
// 자체 fixed/absolute wrapper 없이 flex-col gap-2 레이아웃만 유지한다(자식들이 margin이 아니라
// 부모 gap에 의존하므로 이 한 겹은 남겨둬야 한다).
import { Images, Loader2, Search, Settings2 } from "lucide-react";
import { useState } from "react";

import {
  inlineStockPhotoForCanvas,
  isStudioStockImageConfigured,
  loadStudioStockImageAccessKey,
  searchStockPhotos,
  triggerStockImageDownload,
  type StudioStockImageRateLimit,
  type StudioStockPhoto,
} from "./studio-stock-image-client";

export interface StudioStockImagePanelProps {
  /** 선택한 사진(이미 data: URL로 인라인 변환됨) + 원본 픽셀 크기를 캔버스에 얹고 싶을 때 호출된다.
   *  다운로드 트리거는 이 패널이 이미 쐈으므로, 이 콜백은 캔버스 배치만 신경 쓰면 된다. */
  onInsert: (photo: StudioStockPhoto, dataUrl: string, width: number, height: number) => void;
  /** "연동 설정" 통합 패널(StudioIntegrationsSettingsPanel)을 열기 위한 콜백 — Access Key 등록·변경은
   *  전부 그 패널에서 이뤄진다(이 패널은 더 이상 입력 UI를 갖지 않는다). */
  onOpenSettings: () => void;
}

export function StudioStockImagePanel({ onInsert, onOpenSettings }: StudioStockImagePanelProps) {
  // BYOK credentials are deliberately tab-scoped. The settings panel deletes the retired
  // localStorage value without reading it, so this consumer must use the same session authority.
  const [accessKey] = useState(() => loadStudioStockImageAccessKey(globalThis.sessionStorage));
  const configured = isStudioStockImageConfigured(accessKey);

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [photos, setPhotos] = useState<StudioStockPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [rateLimit, setRateLimit] = useState<StudioStockImageRateLimit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insertingId, setInsertingId] = useState<string | null>(null);

  async function runSearch(nextPage: number) {
    const term = (nextPage === 1 ? query : submittedQuery).trim();
    if (!term || loading || !configured) return;
    setLoading(true);
    setError(null);
    const result = await searchStockPhotos(term, accessKey, { page: nextPage });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSubmittedQuery(term);
    setPage(result.data.page);
    setTotalPages(result.data.totalPages);
    setRateLimit(result.data.rateLimit);
    setPhotos((prev) => (nextPage === 1 ? result.data.photos : [...prev, ...result.data.photos]));
  }

  async function onPick(photo: StudioStockPhoto) {
    if (insertingId) return;
    setInsertingId(photo.id);
    setError(null);
    const inlined = await inlineStockPhotoForCanvas(photo.insertUrl);
    if (!inlined.ok) {
      setError(inlined.error);
      setInsertingId(null);
      return;
    }
    onInsert(photo, inlined.data.dataUrl, inlined.data.width, inlined.data.height);
    // Unsplash API Guidelines가 요구하는 "다운로드" 트리거 — 실패해도 이미 삽입은 끝났으니 사용자
    // 흐름을 막지 않는다(fire-and-forget, studio-stock-image-client.ts §5-2).
    void triggerStockImageDownload(photo.downloadLocationUrl, accessKey);
    setInsertingId(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-fg-1">
          <Images size={14} />
          스톡 사진 검색 (Unsplash)
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="연동 설정 열기"
          title="연동 설정에서 Unsplash Access Key 등록·변경"
          className="text-fg-3 transition-colors hover:text-fg-2"
        >
          <Settings2 size={13} />
        </button>
      </div>

      {!configured && (
        <p className="rounded-lg border border-dashed border-line px-2 py-2 text-[0.66rem] leading-relaxed text-fg-4">
          설정에서 Unsplash Access Key를 등록하세요.{" "}
          <button type="button" onClick={onOpenSettings} className="font-medium text-accent hover:underline">
            연동 설정 열기
          </button>
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 200))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch(1);
            }}
            placeholder="예: 도시 야경, 카페, 바다"
            disabled={!configured || loading}
            className="w-full rounded-lg border border-line bg-card py-1 pl-6 pr-2 text-[0.65rem] placeholder:text-fg-3 outline-none transition-colors focus:border-accent disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={() => void runSearch(1)}
          disabled={!configured || loading || !query.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[0.65rem] font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          검색
        </button>
      </div>

      {/* 검색 결과 없이 정적으로 항상 보이는 문구는 아니다 — 실제로 검색을 해서 헤더에 요청 한도가
          왔을 때만 보여준다(무료 티어 시간당 50회를 사용자가 스스로 가늠할 수 있게). */}
      {rateLimit && (
        <p className="text-[0.58rem] leading-relaxed text-fg-3">
          이번 시간 남은 검색 한도: {rateLimit.remaining}/{rateLimit.limit} (Unsplash 무료 티어)
        </p>
      )}

      {error && <p className="text-xs text-bad">{error}</p>}

      {photos.length === 0 && !loading && !error && (
        <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-line p-4 text-center">
          <p className="text-xs text-fg-3">
            {!configured
              ? "Access Key를 먼저 등록하세요."
              : submittedQuery
                ? "검색 결과가 없습니다."
                : "검색어를 입력해 무료 사진을 찾아보세요."}
          </p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
          {photos.map((photo) => (
            <div key={photo.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => void onPick(photo)}
                disabled={insertingId !== null}
                title={photo.description || "이 사진을 캔버스에 삽입"}
                className="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-neutral-100 disabled:cursor-not-allowed dark:bg-neutral-800"
              >
                <img
                  src={photo.thumbUrl}
                  alt={photo.description || "Unsplash 스톡 사진"}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                {insertingId === photo.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 size={16} className="animate-spin text-white" />
                  </span>
                )}
              </button>
              {/* Unsplash API Guidelines 크레딧 표시 — 작가·Unsplash 양쪽 링크(UTM 포함, 이미
                  studio-stock-image-client.ts에서 붙여서 온다). */}
              <p className="truncate text-center text-[0.55rem] text-fg-3">
                <a
                  href={photo.credit.photographerProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-fg-2 hover:underline"
                >
                  {photo.credit.photographerName}
                </a>{" "}
                ·{" "}
                <a
                  href={photo.credit.unsplashPhotoPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-fg-2 hover:underline"
                >
                  Unsplash
                </a>
              </p>
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 && page < totalPages && (
        <button
          type="button"
          onClick={() => void runSearch(page + 1)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-card py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-raised disabled:opacity-60"
        >
          {loading && <Loader2 size={13} className="animate-spin" />}
          더 보기
        </button>
      )}

      <p className="text-[0.6rem] leading-relaxed text-fg-3">
        Unsplash 무료 사진 — 상업적 이용 가능, 사진작가·Unsplash 출처 표시가 자동으로 포함돼요.
      </p>
    </div>
  );
}
