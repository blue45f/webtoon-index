/**
 * 텍스트 복사 헬퍼 — "복사됨" 뱃지가 거짓말하지 않게 만든다.
 *
 * 스튜디오 도메인에서 시작했지만 순수 DOM 코드이고, 인앱 브라우저에서 가장 먼저 깨지는
 * 어포던스(브라우저 호환 모달의 "접속 주소 복사")가 `src/components` 에 있다. 그쪽은
 * `src/domains` 를 import 하지 않는 경계를 지키므로 공용 `lib/` 로 옮긴다.
 *
 * 규범(StudioAiCompositionPanel)은 `await navigator.clipboard.writeText(...)` 를 try/catch 로
 * 감싸는 것이다. 여기서 한 걸음 더 간다:
 *  1. `navigator.clipboard` 는 보안 컨텍스트(https/localhost)에서만 정의된다. http 로 열린
 *     스튜디오에서는 아예 undefined 라 옵셔널 체이닝이 필요하다.
 *  2. 정의돼 있어도 권한 거부·포커스 없음으로 reject 할 수 있다. 그때는 조용히 실패하는 대신
 *     숨긴 textarea + execCommand("copy") 로 한 번 더 시도한다(구형 경로지만 아직 유일한 폴백).
 *  3. 실제 성공 여부를 boolean 으로 돌려준다 — 호출부가 성공했을 때만 "복사됨"을 띄우게.
 * document/navigator 가 없는 환경(SSR·vitest node env)에서도 throw 하지 않고 false 를 돌려준다.
 */

async function writeViaAsyncClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    // 권한 거부 · 비보안 컨텍스트 · 포커스 없음 — 폴백으로 넘긴다.
    return false;
  }
}

function writeViaHiddenTextarea(text: string): boolean {
  const doc = globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== "function") return false;

  // 복사 후 원래 포커스를 돌려주지 않으면 모달 안에서 포커스가 body 로 튄다.
  const previouslyFocused = doc.activeElement;
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  // 화면에 보이지 않되 실제로 선택 가능해야 한다. display:none 이면 selection 이 잡히지 않는다.
  textarea.setAttribute("aria-hidden", "true");
  textarea.setAttribute("tabindex", "-1");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "none";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  // iOS 사파리는 readOnly 가 아니면 소프트 키보드를 띄운다.
  textarea.readOnly = true;

  try {
    doc.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return doc.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    // finally 에서 던지면 위의 return 값을 삼키고 예외가 밖으로 새어나간다.
    // `instanceof HTMLElement` 는 그 전역이 없는 환경(SSR·node)에서 ReferenceError 라 쓸 수 없다.
    try {
      textarea.remove();
      const restore = (previouslyFocused as { focus?: unknown } | null)?.focus;
      if (typeof restore === "function") restore.call(previouslyFocused);
    } catch {
      // 정리·포커스 복원 실패는 복사 결과에 영향을 주지 않는다.
    }
  }
}

/**
 * 텍스트를 클립보드에 복사하고 "실제로 복사됐는지"를 돌려준다.
 * 절대 throw 하지 않는다 — 호출부는 반환값만 보고 UI 를 정하면 된다.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof text !== "string") return false;
  if (await writeViaAsyncClipboard(text)) return true;
  return writeViaHiddenTextarea(text);
}

/** 스튜디오 도메인에서 쓰던 이름. 호출부를 한꺼번에 바꾸지 않기 위해 남긴다. */
export const copyStudioText = copyText;
