/**
 * 좌측 툴레일 라벨의 로케일 전환.
 *
 * 레일 버튼 라벨은 오랫동안 JSX 안에 한국어로 박혀 있었다. 메뉴바·필터가 전부 번역되는
 * 로케일에서도 레일의 `aria-label`은 "선택 (V)", "핸드 (팬)", "펜 (B)" 그대로였다
 * (실측: `toonspectrum-lang=en`에서 34개 중 32개가 한국어, 컨테이너도 "그리기 도구").
 *
 * 고치는 길이 이 저장소에 둘 있었다 — (a) 75개 로케일 팩에 레일 전용 키를 새로 넣고 미번역
 * 로케일은 영어 pending-translation 으로 두기(필터 28키·모바일 도크 방식), (b) 모듈 안에
 * ko/en 라벨 표를 두고 로케일을 프로브하기(Help 그룹 방식).
 *
 * 여기서는 **(a)의 취지를 새 키 없이** 달성한다. 도구 카탈로그(`STUDIO_RAIL_TOOL_CATALOG`)가
 * 이미 도구마다 `studio.settings.tool.*` 라벨 키를 들고 있고, 그 키는 75개 팩 전부에 번역까지
 * 들어 있다 — 애플리케이션 설정 ▸ 툴바 목록이 지금도 그 키로 렌더한다. 레일이 같은 키를 쓰면
 * 팩을 한 글자도 건드리지 않으므로 `studio-i18n-loader.test.ts`가 고정한 팩당 키 개수
 * 계약(1,297)이 그대로 유지되고, 새 로케일이 추가돼도 레일은 따로 손볼 게 없다.
 *
 * 카탈로그에 대응 도구가 없는 셸 문구(레일 컨테이너 이름, 그룹 구분선)는 (b)를 쓴다. 개수가
 * 아홉 개뿐이고 팩에 대응 키가 없어서, 키를 새로 만드는 것보다 표가 정직하다.
 *
 * **한국어에서는 카탈로그로 갈아타지 않는다.** 카탈로그의 한국어 라벨은 설정 목록용 축약형
 * ("핸드(팬)")이라 레일이 쓰는 단축키 포함 문구("핸드 (팬)")와 글자가 다르고, 레일 쪽이 더
 * 정확하다. 한국어 화면의 문구를 바꾸는 것은 이 결함의 수선 범위가 아니다.
 */

import { studioRailToolLabel, type StudioRailToolId } from "./studio-app-settings";

/** 번역기가 키를 못 찾으면 키 문자열을 그대로 돌려준다. 그 경우엔 원문을 지켜야 한다. */
function isMissingTranslation(value: string, id: string): boolean {
  return value === id || value.startsWith("studio.");
}

export function isKoreanUiLocale(lang: string | undefined): boolean {
  return (lang ?? "").toLowerCase().startsWith("ko");
}

/**
 * 원문 라벨 끝의 괄호 표기를 번역 라벨에 옮길지 판단한다.
 *
 * "(V)" · "(B)" · "(Home)"처럼 단축키만 든 괄호는 로케일과 무관하므로 그대로 옮긴다. 반대로
 * "(팬)"은 단축키가 아니라 동의어 주석이고, 영어 카탈로그 라벨이 이미 "Hand (Pan)"으로 그
 * 뜻을 담고 있어 옮기면 "Hand (Pan) (팬)"이 된다. 한글이 한 글자라도 들어 있으면 버린다.
 */
const SHORTCUT_SUFFIX = /\s*\(([^()]*)\)\s*$/u;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/u;

export function studioRailShortcutSuffix(authoredLabel: string): string | null {
  const match = SHORTCUT_SUFFIX.exec(authoredLabel);
  if (!match) return null;
  const inner = match[1].trim();
  if (inner.length === 0 || HANGUL.test(inner)) return null;
  if (!/[A-Za-z0-9]/u.test(inner)) return null;
  return inner;
}

/**
 * 레일 버튼 한 개의 표시 라벨. 번역이 없거나 한국어 UI면 저자가 쓴 원문을 그대로 돌려준다.
 */
export function localizeStudioRailToolLabel(input: {
  readonly toolId: string | undefined;
  readonly authoredLabel: string;
  readonly lang: string | undefined;
  readonly t: ((key: string) => string) | undefined;
}): string {
  const { toolId, authoredLabel, lang, t } = input;
  if (!toolId || !t || isKoreanUiLocale(lang)) return authoredLabel;
  const translated = studioRailToolLabel(toolId as StudioRailToolId, t);
  if (isMissingTranslation(translated, toolId)) return authoredLabel;
  const shortcut = studioRailShortcutSuffix(authoredLabel);
  return shortcut ? `${translated} (${shortcut})` : translated;
}

/** 카탈로그 도구가 아닌 레일 셸 문구 — 컨테이너 이름과 그룹 구분선. */
const STUDIO_RAIL_SHELL_EN: Readonly<Record<string, string>> = {
  "그리기 도구": "Drawing tools",
  "스튜디오 도구": "Studio tools",
  "선택·이동": "Select & move",
  그리기: "Draw",
  "채색·보정": "Paint & retouch",
  "선택 범위": "Selection",
  변형: "Transform",
  오브젝트: "Objects",
  "3D·참고": "3D & reference",
  보기: "View",
  "더보기 · 툴바 설정": "More · toolbar settings",
  "애플리케이션 설정": "Application settings",
};

/**
 * 스튜디오 로케일 팩이 실제로 붙었는지 확인하는 탐침.
 *
 * 팩은 런타임에 받아 오는 자원이라, 아직 안 왔거나 요청이 실패한 순간이 존재한다. 그때 셸
 * 문구만 영어로 갈아타면 도구 라벨은 한국어인데 그룹 이름만 영어인 뒤죽박죽 화면이 된다.
 * 도구 라벨과 같은 조건(= 번역이 실제로 있는가)으로 묶어 두 쪽이 항상 같이 움직이게 한다.
 */
const STUDIO_LOCALE_PROBE_KEY = "studio.settings.tool.select";

function hasStudioLocalePack(t: ((key: string) => string) | undefined): boolean {
  if (!t) return false;
  return !isMissingTranslation(t(STUDIO_LOCALE_PROBE_KEY), STUDIO_LOCALE_PROBE_KEY);
}

/**
 * 레일 셸 문구의 로케일 전환. 팩에 대응 키가 없는 아홉 개 문구라 모듈 내 표를 쓰고, en 이외의
 * 로케일에는 영어를 내보낸다 — 이 저장소가 이미 쓰는 "미번역 로케일은 영어
 * pending-translation" 관례와 같다. 한국어 화면은 원문 그대로다.
 */
export function localizeStudioRailShellText(
  authored: string,
  lang: string | undefined,
  t?: (key: string) => string
): string {
  if (isKoreanUiLocale(lang) || !hasStudioLocalePack(t)) return authored;
  return STUDIO_RAIL_SHELL_EN[authored] ?? authored;
}
