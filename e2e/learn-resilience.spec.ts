import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { EMPTY_LESSON, STORAGE_KEY } from "../apps/web/src/domains/learn/learning-model";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("toonspectrum-compat-dismissed", "true"));
});

function backup(notes: string) {
  return JSON.stringify({
    format: "toonstudio-learning-backup", version: 1,
    progress: { version: 1, lessons: { "story-board": { ...EMPTY_LESSON, notes }, "color-layers": { ...EMPTY_LESSON, notes: "새 채색 메모" } }, bookmarks: ["layer"] },
  });
}

test("exports a real file and restores only after preview and explicit confirmation", async ({ page, browser }) => {
  await page.goto("/learn/lessons/story-board");
  await page.getByLabel("나의 실습 메모", { exact: true }).fill("내 컷의 호흡 🖋");
  await page.getByRole("link", { name: "내 학습 기록 · 백업 / 복원 →", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/records$/u);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "학습 기록 백업", exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).not.toBeNull();
  const raw = await readFile(path!, "utf8");
  expect(JSON.parse(raw).progress.lessons["story-board"].notes).toBe("내 컷의 호흡 🖋");
  const fresh = await browser.newContext();
  try {
    await fresh.addInitScript(() => sessionStorage.setItem("toonspectrum-compat-dismissed", "true"));
    const destination = await fresh.newPage();
    await destination.goto(new URL("/learn/records", page.url()).href);
    await destination.getByText("백업 파일에서 복원", { exact: true }).click();
    await destination.getByLabel("학습 백업 파일 선택 (.json, 최대 512 KiB)", { exact: true }).setInputFiles({ name: "my-learning.json", mimeType: "application/json", buffer: Buffer.from(raw) });
    await expect(destination.getByRole("heading", { name: "복원 전 확인", exact: true })).toBeVisible();
    expect(await destination.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await destination.getByRole("button", { name: "기존 기록 유지하고 복원", exact: true }).click();
    await destination.getByRole("link", { name: "제작 강좌", exact: true }).click();
    await destination.getByRole("link", { name: "한 문장에서 세 컷의 이야기로", exact: true }).click();
    await expect(destination.getByLabel("나의 실습 메모", { exact: true })).toHaveValue("내 컷의 호흡 🖋");
  } finally { await fresh.close(); }
});

test("restoring keeps existing notes and reports invalid files without changing records", async ({ page }) => {
  await page.goto("/learn/lessons/story-board");
  await page.getByLabel("나의 실습 메모", { exact: true }).fill("덮어쓰면 안 되는 메모");
  await page.getByRole("link", { name: "내 학습 기록 · 백업 / 복원 →", exact: true }).click();
  await page.getByText("백업 파일에서 복원", { exact: true }).click();
  const input = page.getByLabel("학습 백업 파일 선택 (.json, 최대 512 KiB)", { exact: true });
  await input.setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(backup("외부 메모")) });
  await expect(page.getByRole("heading", { name: "복원 전 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기존 기록 유지하고 복원", exact: true }).click();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(saved.lessons["story-board"].notes).toBe("덮어쓰면 안 되는 메모");
  expect(saved.lessons["color-layers"].notes).toBe("새 채색 메모");
  await input.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"version":999}') });
  await expect(page.locator(".learn-backup-preview")).toHaveCount(0);
  await expect(page.locator(".learn-record-tools [role=status]")).toContainText("버전 1 백업");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)).toEqual(saved);
});

test("cancelling a preview does not import and oversized files are rejected", async ({ page }) => {
  await page.goto("/learn/records");
  await page.getByText("백업 파일에서 복원", { exact: true }).click();
  const input = page.getByLabel("학습 백업 파일 선택 (.json, 최대 512 KiB)", { exact: true });
  await input.setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(backup("메모")) });
  await expect(page.getByRole("heading", { name: "복원 전 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "복원 취소", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  await input.setInputFiles({ name: "oversize.json", mimeType: "application/json", buffer: Buffer.alloc(512 * 1024 + 1, "x") });
  await expect(page.locator(".learn-record-tools [role=status]")).toContainText("512 KiB");
  await expect(page.locator(".learn-backup-preview")).toHaveCount(0);
});

test("mobile comparisons show one readable diagram and keyboard controls switch the view", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/learn/lessons/color-layers");
  const svg = page.locator(".learn-diagram");
  await expect(svg).toHaveAttribute("data-view", "comparison");
  await page.getByRole("button", { name: "기준만", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(svg).toHaveAttribute("viewBox", "0 0 320 360");
  await page.getByRole("button", { name: "비교만", exact: true }).click();
  await expect(svg).toHaveAttribute("viewBox", "320 0 320 360");
  expect(await page.locator(".learn-diagram-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await test.info().attach("mobile-clipping-comparison", { body: await page.locator(".learn-lab").screenshot(), contentType: "image/png" });
});

test("shared lab state restores paused and clipboard denial provides a privacy-safe manual link", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("blocked", "NotAllowedError"); } } }));
  await page.goto("/learn/lessons/color-layers?labValue=72&labFrame=200&labView=reference&notes=private&token=secret");
  await expect(page.getByRole("slider").first()).toHaveValue("72");
  await expect(page.getByRole("slider").nth(1)).toHaveValue("200");
  await expect(page.getByRole("button", { name: "설명 재생", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이 예제 설정 공유", exact: true }).click();
  const input = page.getByLabel("직접 복사할 예제 링크", { exact: true });
  await expect(input).toBeVisible();
  const link = await input.inputValue();
  expect(link).toContain("labValue=72");
  expect(link).toContain("labFrame=200");
  expect(link).not.toContain("private");
  expect(link).not.toContain("secret");
  await page.goto(link);
  await expect(page.getByRole("slider").first()).toHaveValue("72");
  await expect(page.locator(".learn-diagram")).toHaveAttribute("data-view", "reference");
  await expect(page.getByRole("button", { name: "설명 재생", exact: true })).toBeVisible();
});

test("failed writes survive real other-tab edits and SPA navigation to record management", async ({ page, context }) => {
  await page.goto("/learn/lessons/story-board");
  await page.getByLabel("나의 실습 메모", { exact: true }).fill("기준 메모");
  const other = await context.newPage();
  try {
    await other.addInitScript(() => sessionStorage.setItem("toonspectrum-compat-dismissed", "true"));
    await other.goto(new URL("/learn/lessons/story-board", page.url()).href);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "toonstudio:learning:v1") throw new DOMException("full", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    await page.getByLabel("나의 실습 메모", { exact: true }).fill("반드시 보존할 미저장 메모");
    await other.getByLabel("나의 실습 메모", { exact: true }).fill("다른 탭 메모");
    await expect(page.locator(".learn-page > [role=status]")).toContainText("다른 탭");
    await expect(page.getByLabel("나의 실습 메모", { exact: true })).toHaveValue("반드시 보존할 미저장 메모");
    await page.getByRole("link", { name: "내 학습 기록 · 백업 / 복원 →", exact: true }).click();
    await expect(page.getByRole("heading", { name: "다른 탭의 기록과 충돌했습니다", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "제작 강좌", exact: true }).click();
    await page.getByRole("link", { name: "한 문장에서 세 컷의 이야기로", exact: true }).click();
    await expect(page.getByLabel("나의 실습 메모", { exact: true })).toHaveValue("반드시 보존할 미저장 메모");
    expect(await other.evaluate((key) => JSON.parse(localStorage.getItem(key)!).lessons["story-board"].notes, STORAGE_KEY)).toBe("다른 탭 메모");
  } finally { await other.close(); }
});
