// @vitest-environment jsdom

/**
 * 다이얼로그 포커스 복귀 그물의 계약.
 *
 * 회귀 근거(브라우저 실측 2026-08-08): 도움말 9개 표면 중 7개가 Esc 후 `document.body` 로
 * 포커스를 떨어뜨렸다. 여기서 잠그는 것은 두 가지다 — (1) 떨어뜨렸을 때는 반드시 받는다,
 * (2) 스스로 복원하는 다이얼로그의 결정은 절대 덮어쓰지 않는다.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  canReturnStudioDialogFocus,
  installStudioDialogFocusReturn,
  resolveStudioDialogOpener,
  studioDialogFocusAnchor,
  studioDialogFocusWasDropped,
} from "./studio-dialog-focus-return";

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = "";
});

/** MutationObserver 콜백은 마이크로태스크로 온다. */
async function settle() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 관찰자가 예약한 2차 확인(`setTimeout(0)`)까지 흘려보낸다. 1차는 관찰자 마이크로태스크
 * 안에서 끝나므로 `settle()` 한 번이면 되지만, 2차는 그때 예약되는 타이머라 한 틱 더 든다.
 */
async function settleTwice() {
  await settle();
  await settle();
}

function mountTrigger(id = "trigger") {
  const trigger = document.createElement("button");
  trigger.id = id;
  trigger.textContent = id;
  document.body.append(trigger);
  return trigger;
}

function mountModalPortal() {
  const portalRoot = document.createElement("div");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;
  portalRoot.append(dialog);
  document.body.append(portalRoot);
  return { dialog, portalRoot };
}

describe("studio-dialog-focus-return", () => {
  it("body 로 떨어진 포커스를 다이얼로그를 연 컨트롤로 되돌린다", async () => {
    dispose = installStudioDialogFocusReturn(document);
    const trigger = mountTrigger("help-trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { dialog, portalRoot } = mountModalPortal();
    await settle();
    dialog.focus();
    expect(document.activeElement).toBe(dialog);

    portalRoot.remove();
    expect(studioDialogFocusWasDropped(document)).toBe(true);
    await settle();

    expect(document.activeElement).toBe(trigger);
  });

  it("백드롭을 눌러 닫아 복원 직후 포커스를 다시 빼앗겨도 되돌린다", async () => {
    // 실측(2026-08-13): `pointerdown` 으로 백드롭을 닫으면 그물이 1차 복원을 마친 뒤
    // 같은 입력의 `mousedown` 기본 동작이 포커스를 다시 body 로 떨어뜨렸다.
    dispose = installStudioDialogFocusReturn(document);
    const trigger = mountTrigger("help-trigger");
    trigger.focus();

    const { dialog, portalRoot } = mountModalPortal();
    await settle();
    dialog.focus();

    portalRoot.remove();
    await settle();
    expect(document.activeElement).toBe(trigger);

    // 마우스 기본 동작이 방금 되돌린 포커스를 지운다.
    trigger.blur();
    expect(studioDialogFocusWasDropped(document)).toBe(true);
    await settle();

    expect(document.activeElement).toBe(trigger);
  });

  it("닫히는 순간 배경이 아직 inert 여도 정리가 끝난 뒤 되돌린다", async () => {
    // 기능 튜토리얼은 열릴 때 body 의 다른 자식을 inert 로 만들고 자기 정리에서 되돌린다.
    // 포털이 사라진 직후에는 되돌릴 후보가 전부 걸러져 한 번의 판정으로는 실패한다.
    dispose = installStudioDialogFocusReturn(document);
    const trigger = mountTrigger("help-trigger");
    trigger.focus();

    const { dialog, portalRoot } = mountModalPortal();
    await settle();
    dialog.focus();
    trigger.setAttribute("inert", "");

    portalRoot.remove();
    await settle();
    expect(document.activeElement).toBe(document.body);

    // 다이얼로그의 정리가 뒤늦게 inert 를 되돌린다.
    trigger.removeAttribute("inert");
    await settleTwice();

    expect(document.activeElement).toBe(trigger);
  });

  it("2차 확인도 스스로 복원한 다이얼로그의 결정은 덮어쓰지 않는다", async () => {
    dispose = installStudioDialogFocusReturn(document);
    const trigger = mountTrigger("opener");
    const elsewhere = mountTrigger("dialog-picked-this");
    trigger.focus();

    const { dialog, portalRoot } = mountModalPortal();
    await settle();
    dialog.focus();

    portalRoot.remove();
    elsewhere.focus();
    await settleTwice();

    expect(document.activeElement).toBe(elsewhere);
  });

  it("스스로 복원한 다이얼로그의 결정은 덮어쓰지 않는다", async () => {
    dispose = installStudioDialogFocusReturn(document);
    const trigger = mountTrigger("opener");
    const elsewhere = mountTrigger("dialog-picked-this");
    trigger.focus();

    const { dialog, portalRoot } = mountModalPortal();
    await settle();
    dialog.focus();

    // 자기 정리에서 다른 곳으로 포커스를 옮기는 다이얼로그(브러시 매니저 계열).
    portalRoot.remove();
    elsewhere.focus();
    await settle();

    expect(document.activeElement).toBe(elsewhere);
  });

  it("트리거가 사라졌으면 메뉴바 앵커로 착지시킨다", async () => {
    dispose = installStudioDialogFocusReturn(document);
    const anchor = document.createElement("button");
    anchor.setAttribute("data-studio-main-menu-trigger", "file");
    document.body.append(anchor);
    const disposable = mountTrigger("disposable");
    disposable.focus();

    const { dialog, portalRoot } = mountModalPortal();
    await settle();
    dialog.focus();
    disposable.remove();

    portalRoot.remove();
    await settle();

    expect(document.activeElement).toBe(anchor);
  });

  it("모달이 아닌 포털은 추적하지 않는다", async () => {
    dispose = installStudioDialogFocusReturn(document);
    const trigger = mountTrigger("untouched");
    trigger.focus();

    const tooltip = document.createElement("div");
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);
    await settle();
    (document.activeElement as HTMLElement | null)?.blur();
    tooltip.remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
  });

  it("이미 설치돼 있으면 관찰자를 겹치지 않는다", () => {
    dispose = installStudioDialogFocusReturn(document);
    expect(installStudioDialogFocusReturn(document)).toBe(dispose);
  });

  it("복원 후보를 고를 때 사라졌거나 inert 인 컨트롤은 제외한다", () => {
    const live = mountTrigger("live");
    const detached = document.createElement("button");
    expect(canReturnStudioDialogFocus(live, document)).toBe(true);
    expect(canReturnStudioDialogFocus(detached, document)).toBe(false);
    expect(canReturnStudioDialogFocus(document.body, document)).toBe(false);
    expect(canReturnStudioDialogFocus(null, document)).toBe(false);

    const inertHost = document.createElement("div");
    inertHost.setAttribute("inert", "");
    const buried = document.createElement("button");
    inertHost.append(buried);
    document.body.append(inertHost);
    expect(canReturnStudioDialogFocus(buried, document)).toBe(false);
  });

  it("모달 안쪽 포커스는 트리거 후보가 아니다", () => {
    const { dialog } = mountModalPortal();
    const inside = document.createElement("button");
    dialog.append(inside);
    inside.focus();

    const remembered = mountTrigger("remembered");
    expect(resolveStudioDialogOpener(document, remembered)).toBe(remembered);
  });

  it("앵커가 없으면 조용히 아무것도 하지 않는다", () => {
    expect(studioDialogFocusAnchor(document)).toBeNull();
  });
});
