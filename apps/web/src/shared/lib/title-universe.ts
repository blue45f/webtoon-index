// 작품 '유니버스' 통합 큐레이션 데이터 — 한 작품에 딸린 보조 정보를 제목 기준 하나의 구조로 모은다.
// (기존 adaptations-media.ts + ost-tracks.ts 를 합쳐 페이지별 분산 구조를 단일 출처로 통합.
//  카테고리 추가 확장이 쉽도록 UniverseEntry 에 필드만 늘리면 된다: adaptations·osts·(향후) goods 등.)
//
// 정직성·저작권 안전 원칙:
// - 곡명/작품명/연도는 사실(저작권 대상 아님)만 기재.
// - videoId 는 WebSearch+oEmbed 로 '공식 채널 업로드'를 확인한 것만(예: Netflix·CJ ENM·Crunchyroll·
//   롯데엔터테인먼트·ANIPLUS·JYP 등 공식 채널). 확신 없으면 비움(추측·창작 금지).
// - 썸네일은 유튜브 공식 영상 썸네일(i.ytimg.com)만 사용 — 저작권 포스터를 호스팅/핫링크하지 않는다.
// - 재생/시청은 전부 공식 플랫폼으로 '링크아웃'만. 음원·영상을 저장/재생하지 않는다.

function norm(s: string): string {
  return String(s || "")
    .replace(/[\s:~!?,.\-()[\]·]/g, "")
    .toLowerCase();
}

export type MediaKind = "drama" | "movie" | "anime" | "ott";
export interface MediaAdaptation {
  kind: MediaKind;
  name: string;
  year: number;
  videoId?: string; // 공식 예고편 유튜브 ID(썸네일·미리보기용)
  url?: string; // 공식 시청/정보 페이지(Netflix·디즈니+·TVING·위키 등)
}

export type OstKind = "op" | "ed" | "ost" | "theme";
export interface OstTrack {
  song: string;
  artist: string;
  year: number;
  kind: OstKind;
  context: string; // 애니/드라마 등 출처
  videoId?: string; // 공식 MV/오디오 유튜브 ID
}

export interface Universe {
  adaptations: MediaAdaptation[];
  osts: OstTrack[];
}

interface UniverseEntry {
  titles: string[]; // 매칭할 제목(이형 포함)
  adaptations?: MediaAdaptation[];
  osts?: OstTrack[];
}

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  drama: "드라마",
  movie: "영화",
  anime: "애니메이션",
  ott: "OTT 시리즈",
};
export const OST_KIND_LABEL: Record<OstKind, string> = {
  op: "오프닝",
  ed: "엔딩",
  ost: "OST",
  theme: "주제가",
};

// ── 통합 데이터(제목별로 adaptations·osts 를 함께) ────────────────────────────
const DATA: UniverseEntry[] = [
  {
    titles: ["외모지상주의"],
    adaptations: [{ kind: "anime", name: "외모지상주의", year: 2022, videoId: "ASejc3E4DcI", url: "https://www.netflix.com/kr/title/81177634" }],
    osts: [{ song: "Like That", artist: "에이티즈 (ATEEZ)", year: 2022, kind: "op", context: "넷플릭스 애니메이션", videoId: "ZOLoVUWLMkQ" }],
  },
  {
    titles: ["나 혼자만 레벨업", "나혼자만레벨업"],
    adaptations: [{ kind: "anime", name: "나 혼자만 레벨업", year: 2024, videoId: "Q58hwaR4QTk", url: "https://www.aniplustv.com/items/3107" }],
    osts: [
      { song: "LEveL", artist: "SawanoHiroyuki[nZk]:TOMORROW X TOGETHER", year: 2024, kind: "op", context: "애니메이션", videoId: "Jsc6bPHe4tM" },
      { song: "request", artist: "히츠지분가쿠 (羊文学)", year: 2024, kind: "ed", context: "애니메이션" },
    ],
  },
  {
    titles: ["신의 탑", "신의탑", "tower of god"],
    adaptations: [{ kind: "anime", name: "신의 탑", year: 2020, videoId: "RNyClma6awo", url: "https://www.crunchyroll.com/series/G6J0G49DR/tower-of-god" }],
    osts: [
      { song: "TOP", artist: "스트레이 키즈 (Stray Kids)", year: 2020, kind: "op", context: "애니메이션", videoId: "PQXLLC9yGAY" },
      { song: "SLUMP", artist: "스트레이 키즈 (Stray Kids)", year: 2020, kind: "ed", context: "애니메이션", videoId: "63-6y8G7uXY" },
    ],
  },
  {
    titles: ["갓 오브 하이스쿨", "the god of high school"],
    adaptations: [{ kind: "anime", name: "갓 오브 하이스쿨", year: 2020, videoId: "oqjwUfprNAk", url: "https://www.crunchyroll.com/series/G6P541W1R/the-god-of-high-school" }],
    osts: [{ song: "Contradiction", artist: "KSUKE feat. Tyler Carter", year: 2020, kind: "op", context: "애니메이션", videoId: "pkw_Hl3qXCs" }],
  },
  {
    titles: ["노블레스"],
    adaptations: [{ kind: "anime", name: "노블레스", year: 2020, videoId: "FD08hv-7QQo", url: "https://www.netflix.com/kr/title/81511704" }],
  },
  {
    titles: ["여신강림"],
    adaptations: [{ kind: "drama", name: "여신강림", year: 2020, videoId: "BhP1eYQ5Pxk", url: "https://www.tving.com/contents/P001391055" }],
    osts: [
      { song: "Love so Fine", artist: "차은우 (ASTRO)", year: 2021, kind: "ost", context: "드라마", videoId: "uDLw2BRk3ww" },
      { song: "오늘부터 시작인걸", artist: "황인엽", year: 2021, kind: "ost", context: "드라마", videoId: "9LjxxZSYw0I" },
    ],
  },
  {
    titles: ["유미의 세포들"],
    adaptations: [{ kind: "drama", name: "유미의 세포들", year: 2021, videoId: "2ry_KtDPbvc", url: "https://en.wikipedia.org/wiki/Yumi's_Cells" }],
    osts: [
      { song: "Nightfalling", artist: "존박 (John Park)", year: 2021, kind: "ost", context: "드라마", videoId: "PMqVlIdklBk" },
      { song: "Like a Star", artist: "도영 (DOYOUNG, NCT)", year: 2021, kind: "ost", context: "드라마", videoId: "atJmeuWm4mo" },
    ],
  },
  { titles: ["스위트홈"], adaptations: [{ kind: "ott", name: "스위트홈", year: 2020, videoId: "B5IQqZDSRjk", url: "https://www.netflix.com/title/81061734" }] },
  { titles: ["지옥"], adaptations: [{ kind: "ott", name: "지옥", year: 2021, videoId: "ga3pXJEngms", url: "https://www.netflix.com/title/81256675" }] },
  { titles: ["지금 우리 학교는"], adaptations: [{ kind: "ott", name: "지금 우리 학교는", year: 2022, videoId: "IN5TD4VRcSM", url: "https://www.netflix.com/title/81237994" }] },
  { titles: ["재벌집 막내아들"], adaptations: [{ kind: "drama", name: "재벌집 막내아들", year: 2022, videoId: "KPSFUOQiTEQ", url: "https://ko.wikipedia.org/wiki/재벌집_막내아들" }] },
  { titles: ["알고있지만", "알고있지만,"], adaptations: [{ kind: "drama", name: "알고있지만,", year: 2021, videoId: "xJCTxUuu3js", url: "https://www.netflix.com/kr/title/81435649" }] },
  { titles: ["안나라수마나라"], adaptations: [{ kind: "ott", name: "안나라수마나라", year: 2022, videoId: "hAY2RS-8C90", url: "https://www.netflix.com/kr/title/81016276" }] },
  { titles: ["금수저"], adaptations: [{ kind: "drama", name: "금수저", year: 2022, videoId: "PXv4KLRTBJQ", url: "https://program.imbc.com/TheGoldenSpoon" }] },
  { titles: ["약한영웅"], adaptations: [{ kind: "ott", name: "약한영웅 Class 1", year: 2022, videoId: "JDwLxiTPrCQ", url: "https://www.netflix.com/title/81742615" }] },
  { titles: ["쌍갑포차"], adaptations: [{ kind: "drama", name: "쌍갑포차", year: 2020, videoId: "WobxNcK5o30", url: "https://www.netflix.com/title/81264882" }] },
  { titles: ["전지적 독자 시점", "전지적독자시점"], adaptations: [{ kind: "movie", name: "전지적 독자 시점", year: 2025, videoId: "Xb96_61kMS8", url: "https://ko.wikipedia.org/wiki/전지적_독자_시점_(영화)" }] },
  {
    titles: ["신과함께", "신과 함께"],
    adaptations: [
      { kind: "movie", name: "신과함께: 죄와 벌", year: 2017, videoId: "5O5PVvHTWRo", url: "https://www.tving.com/contents/M000305842" },
      { kind: "movie", name: "신과함께: 인과 연", year: 2018 },
    ],
  },
  { titles: ["타인은 지옥이다"], adaptations: [{ kind: "drama", name: "타인은 지옥이다", year: 2019, videoId: "bc85-DZwopU", url: "https://www.netflix.com/title/81267632" }] },
  {
    titles: ["치즈인더트랩", "치즈 인 더 트랩"],
    adaptations: [
      { kind: "drama", name: "치즈인더트랩", year: 2016 },
      { kind: "movie", name: "치즈인더트랩", year: 2018, url: "https://ko.wikipedia.org/wiki/치즈인더트랩_(영화)" },
    ],
  },
  { titles: ["마음의소리", "마음의 소리"], adaptations: [{ kind: "drama", name: "마음의 소리", year: 2016 }] },

  // ── 아래는 검증된 영상화이나 현재 카탈로그에 원작이 없을 수 있음(있으면 자동 노출) ──
  {
    titles: ["김비서가 왜 그럴까"],
    adaptations: [{ kind: "drama", name: "김비서가 왜 그럴까", year: 2018 }],
    osts: [{ song: "It's You", artist: "정세운", year: 2018, kind: "ost", context: "드라마", videoId: "rBaEVC2aWqQ" }],
  },
  {
    titles: ["이태원 클라쓰"],
    adaptations: [{ kind: "drama", name: "이태원 클라쓰", year: 2020 }],
    osts: [
      { song: "시작 (Start)", artist: "가호 (Gaho)", year: 2020, kind: "ost", context: "드라마", videoId: "O0StKlRHVeE" },
      { song: "Sweet Night", artist: "뷔 (V)", year: 2020, kind: "ost", context: "드라마" },
    ],
  },
  {
    titles: ["사내맞선"],
    adaptations: [{ kind: "drama", name: "사내맞선", year: 2022 }],
    osts: [{ song: "Love, Maybe (사랑인가 봐)", artist: "멜로망스 (MeloMance)", year: 2022, kind: "ost", context: "드라마", videoId: "UoBsiQW23IY" }],
  },
  { titles: ["무빙"], adaptations: [{ kind: "ott", name: "무빙", year: 2023, url: "https://www.disneyplus.com" }] },
  { titles: ["경이로운 소문"], adaptations: [{ kind: "drama", name: "경이로운 소문", year: 2020 }] },
  { titles: ["내 아이디는 강남미인", "내 ID는 강남미인"], adaptations: [{ kind: "drama", name: "내 ID는 강남미인", year: 2018 }] },
  { titles: ["미생"], adaptations: [{ kind: "drama", name: "미생", year: 2014 }] },
  { titles: ["나빌레라"], adaptations: [{ kind: "drama", name: "나빌레라", year: 2021 }] },
  { titles: ["디피", "d.p", "개의 날"], adaptations: [{ kind: "ott", name: "D.P.", year: 2021, url: "https://www.netflix.com/title/81280917" }] },
  { titles: ["술꾼도시여자들"], adaptations: [{ kind: "ott", name: "술꾼도시여자들", year: 2021 }] },
  { titles: ["쌉니다 천리마마트", "쌉니다 천리마트"], adaptations: [{ kind: "drama", name: "쌉니다 천리마마트", year: 2019 }] },
  { titles: ["어쩌다 발견한 하루", "어쩌다 발견한 7월"], adaptations: [{ kind: "drama", name: "어쩌다 발견한 하루", year: 2019 }] },
  { titles: ["트레이스"], adaptations: [{ kind: "drama", name: "트레이스", year: 2017 }] },
  { titles: ["청춘블라썸"], adaptations: [{ kind: "drama", name: "청춘블라썸", year: 2022 }] },
  { titles: ["연놈"], adaptations: [{ kind: "drama", name: "연놈", year: 2021 }] },
  { titles: ["조명가게"], adaptations: [{ kind: "ott", name: "조명가게", year: 2024, url: "https://www.disneyplus.com" }] },
  { titles: ["이두나", "이두나!"], adaptations: [{ kind: "ott", name: "이두나!", year: 2023, url: "https://www.netflix.com/title/81668110" }] },
];

// ── 인덱스 + 조회 ─────────────────────────────────────────────────────────────
const INDEX = new Map<string, Universe>();
for (const e of DATA) {
  for (const t of e.titles) {
    const k = norm(t);
    const cur = INDEX.get(k) ?? { adaptations: [], osts: [] };
    if (e.adaptations) cur.adaptations.push(...e.adaptations);
    if (e.osts) cur.osts.push(...e.osts);
    INDEX.set(k, cur);
  }
}

const EMPTY: Universe = { adaptations: [], osts: [] };

// 작품(제목)에 매칭되는 유니버스 데이터. 없으면 빈 구조.
export function universeFor(title: { title: string }): Universe {
  return INDEX.get(norm(title.title)) ?? EMPTY;
}

// 두 제목(예: 원작 + 현재작)의 유니버스를 합치고 중복 제거.
export function mergedUniverse(a: { title: string }, b?: { title: string }): Universe {
  const ua = universeFor(a);
  const ub = b && b.title !== a.title ? universeFor(b) : EMPTY;
  const adKey = (m: MediaAdaptation) => `${m.kind}|${m.name}|${m.year}`;
  const ostKey = (o: OstTrack) => `${o.song}|${o.artist}`;
  return {
    adaptations: dedupe([...ua.adaptations, ...ub.adaptations], adKey),
    osts: dedupe([...ua.osts, ...ub.osts], ostKey),
  };
}

function dedupe<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── 썸네일·링크 헬퍼(전부 유튜브 공식 영상 기반 / 공식 플랫폼 링크아웃) ──────────
export function ytThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// 영상화 노드: 썸네일(예고편) + 대표 링크(공식 시청/정보 → 없으면 예고편 → 없으면 검색).
export function mediaThumb(m: MediaAdaptation): string | null {
  return m.videoId ? ytThumb(m.videoId) : null;
}
export function mediaLink(m: MediaAdaptation): string {
  if (m.url) return m.url;
  if (m.videoId) return `https://www.youtube.com/watch?v=${m.videoId}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.name} ${MEDIA_KIND_LABEL[m.kind]} 공식 예고편`)}`;
}

// OST 트랙: 썸네일(MV) + 공식 플랫폼 링크아웃.
function ostQuery(t: OstTrack): string {
  return `${t.song} ${t.artist}`;
}
export function ostThumb(t: OstTrack): string | null {
  return t.videoId ? ytThumb(t.videoId) : null;
}
export function ostWatchUrl(t: OstTrack): string {
  if (t.videoId) return `https://www.youtube.com/watch?v=${t.videoId}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(ostQuery(t))}`;
}
export function ostMelonUrl(t: OstTrack): string {
  return `https://www.melon.com/search/total/index.htm?q=${encodeURIComponent(ostQuery(t))}`;
}
export function ostSpotifyUrl(t: OstTrack): string {
  return `https://open.spotify.com/search/${encodeURIComponent(ostQuery(t))}`;
}
