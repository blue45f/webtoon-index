// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAuthoredSutFixture } from "../../../../../../tests/corpus/formats/csp-sut-fixtures";
import { buildKritaBundleFixture } from "../../../../../../tests/corpus/formats/krita-bundle-fixtures";

import { brushLifecycleStageOf } from "./studio-brush-catalog-lifecycle";
import { studioBrushDynamicsPresetSettings } from "./studio-brush-dynamics";
import {
  BRUSH_LIBRARY_KEY,
  BRUSH_LIBRARY_STORAGE_VERSION,
  type BrushLibraryStorage,
  type StudioBrushSnapshot,
  type StudioSavedBrush,
} from "./studio-brush-library";
import {
  createStorageBrushLibraryRepository,
  type BrushLibraryPageRequest,
} from "./studio-brush-library-repository";
import { notifyStudioBrushLibraryChanged } from "./studio-brush-library-sqlite-repository";
import { STUDIO_BRUSH_PACK_ACCEPT } from "./studio-brush-pack-format";
import { StudioBrushLibraryPanel } from "./StudioBrushLibraryPanel";

const snapshot: StudioBrushSnapshot = {
  brushId: "pen",
  strokeWidth: 6,
  brushOpacity: 1,
  color: "#ff6600",
  stabilizer: 6,
  stabilizerMode: "adaptive",
  postCorrection: 4,
  preserveCorners: true,
  pressureCurve: 1,
      pressureMinSize: 0,
  useVelocityPressure: true,
  velocitySensitivity: 0.65,
  tiltEnabled: true,
  tipAngle: -30,
  tipRoundness: 0.24,
  brushDynamics: studioBrushDynamicsPresetSettings("ink-particle"),
  stampTuning: null,
  enginePrograms: null,
};

const saved: StudioSavedBrush = {
  id: "saved-1",
  name: "주력 펜",
  createdAt: 1,
  updatedAt: 2,
  pinned: true,
  lastUsedAt: 3,
  ...snapshot,
};

// 노출 단계 픽스처 — 각 단계 판정은 테스트 본문에서 수명주기 결정자로 재검증한다.
const watercolorBase: StudioSavedBrush = {
  ...saved,
  id: "saved-watercolor-core",
  name: "수채 기본",
  brushId: "watercolor",
  pinned: false,
};

const watercolorExtended: StudioSavedBrush = {
  ...saved,
  id: "saved-watercolor-extended",
  name: "번짐 수채",
  brushId: "watercolor",
  sourcePresetId: "watercolor--granular",
  pinned: false,
};

const watercolorExperimental: StudioSavedBrush = {
  ...saved,
  id: "saved-watercolor-experimental",
  name: "실험 수채",
  brushId: "watercolor",
  sourcePresetId: "watercolor--edge-bloom",
  pinned: false,
};

const quarantinedGpen: StudioSavedBrush = {
  ...saved,
  id: "saved-gpen-quarantined",
  name: "격리 지펜",
  brushId: "gpen",
  sourcePresetId: "gpen--causal-round",
  pinned: false,
};

function seededRepositoryFactory(brushes: readonly StudioSavedBrush[]) {
  const values = new Map<string, string>([
    [
      BRUSH_LIBRARY_KEY,
      JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION, brushes }),
    ],
  ]);
  const repository = createStorageBrushLibraryRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  return async () => ({
    authority: "sqlite" as const,
    repository,
    migration: null,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StudioBrushLibraryPanel", () => {
  it("controlled 목록과 고정·복제·이름·내보내기·공유·삭제 액션을 렌더한다", () => {
    const html = renderToStaticMarkup(
      <StudioBrushLibraryPanel
        currentSnapshot={snapshot}
        brushes={[saved]}
        activeBrushId={saved.id}
        onBrushesChange={() => undefined}
        onApplyBrush={() => undefined}
        onBrushDeleted={() => undefined}
      />
    );
    expect(html).toContain('data-studio-brush-library-scope="saved"');
    expect(html).toContain('data-studio-brush-surface-role="user-library-management"');
    expect(html).toContain('aria-label="내 브러시"');
    expect(html).toContain("내 브러시 · 사용자 설정");
    expect(html).toContain("로컬 SQL 브러시 카탈로그 연결 중…");
    expect(html).not.toContain("1개 · 무제한");
    expect(html).not.toContain("1/120");
    expect(html).not.toContain("Infinity");
    expect(html).toContain(
      'aria-label="브러시 설정 · Photoshop ABR · Clip Studio SUT/SUTG · libmypaint MYB · Krita KPP/번들 가져오기"',
    );
    // MYB/KPP 파서가 있는데 진입점이 없던 상태를 되돌리지 못하게 accept 를 고정한다.
    expect(html).toContain(`accept="${STUDIO_BRUSH_PACK_ACCEPT}"`);
    for (const extension of [".json", ".abr", ".myb", ".kpp", ".sut", ".sutg", ".bundle"]) {
      expect(STUDIO_BRUSH_PACK_ACCEPT).toContain(extension);
    }
    expect(html).toContain("주력 펜 고정 해제");
    expect(html).toContain("주력 펜 복제");
    expect(html).toContain("주력 펜 이름 변경");
    expect(html).toContain("주력 펜 내보내기");
    expect(html).toContain("주력 펜 브러시 공유");
    expect(html).toContain("주력 펜 브러시 삭제");
    expect(html).toContain("<details");
    expect(html).toContain("관리 · 덮어쓰기, 복제, 공유");
    expect(html).not.toContain("<details open");
    expect(html).toContain("grid-cols-3");
    expect(html).toContain("sm:grid-cols-6");
    expect(html).toContain('aria-label="주력 펜 브러시 적용, 매끈한 펜, 6px, 100퍼센트"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("모바일 조작 영역과 투명 색상용 명암 미리보기를 유지한다", () => {
    const html = renderToStaticMarkup(
      <StudioBrushLibraryPanel
        currentSnapshot={snapshot}
        brushes={[saved]}
        onBrushesChange={() => undefined}
        onApplyBrush={() => undefined}
        onBrushDeleted={() => undefined}
      />
    );
    expect(html).toContain("min-h-11");
    expect(html).toContain("size-11");
    expect(html).toContain("min-h-16");
    expect(html).toContain('role="group" aria-label="내 브러시 표시 방식"');
    expect(html).toContain('data-studio-saved-brush-view="stroke"');
    expect(html).toContain('data-studio-saved-brush-preview="solid"');
    expect(html).toContain('data-studio-saved-brush-preview-opacity="1"');
    expect(html).toContain('fill="#ff6600"');
    expect(html).toContain("oklch(0.9 0.008 70)");
  });

  it("저장한 프로 브러시는 런타임 펜이 아니라 원본 프리셋 이름과 획 스타일로 표시한다", () => {
    const proSaved: StudioSavedBrush = {
      ...saved,
      id: "saved-pro",
      name: "반짝임 장식",
      brushId: "ink-particle",
      sourcePresetId: "heart-stamp",
      sourcePresetName: "하트 도장",
    };
    const html = renderToStaticMarkup(
      <StudioBrushLibraryPanel
        currentSnapshot={snapshot}
        brushes={[proSaved]}
        onBrushesChange={() => undefined}
        onApplyBrush={() => undefined}
        onBrushDeleted={() => undefined}
      />
    );

    expect(html).toContain('data-studio-saved-brush-preview="glitter"');
    expect(html).toContain(
      'aria-label="반짝임 장식 브러시 적용, 하트 도장, 6px, 100퍼센트"'
    );
    expect(html).toContain("하트 도장 · 6px · 100%");
    expect(html).not.toContain("입자");
  });

  it("획과 이름 목록을 바꿔도 저장 브러시 적용·관리 계약을 유지한다", async () => {
    const onApplyBrush = vi.fn();
    const values = new Map<string, string>([
      [
        BRUSH_LIBRARY_KEY,
        JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION, brushes: [saved] }),
      ],
    ]);
    const repository = createStorageBrushLibraryRepository({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const repositoryFactory = vi.fn(async () => ({
      authority: "sqlite" as const,
      repository,
      migration: null,
    }));
    const { container } = render(
      <StudioBrushLibraryPanel
        currentSnapshot={snapshot}
        brushes={[saved]}
        onBrushesChange={vi.fn()}
        onApplyBrush={onApplyBrush}
        onBrushDeleted={vi.fn()}
        repositoryFactory={repositoryFactory}
      />
    );

    await waitFor(() => expect(
      container.querySelector("[data-studio-brush-library-authority]")
        ?.getAttribute("data-studio-brush-library-authority"),
    ).toBe("sqlite"));

    const list = () => container.querySelector<HTMLElement>("[data-studio-saved-brush-view]");
    expect(list()?.dataset.studioSavedBrushView).toBe("stroke");
    expect(screen.getByRole("button", { name: "내 브러시 획 미리보기" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(container.querySelector("[data-studio-saved-brush-preview]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "내 브러시 이름 목록" }));
    expect(list()?.dataset.studioSavedBrushView).toBe("text");
    expect(screen.getByRole("button", { name: "내 브러시 이름 목록" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(container.querySelector("[data-studio-saved-brush-preview]")).toBeNull();
    expect(container.querySelector('span[style*="background"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", {
      name: "주력 펜 브러시 적용, 매끈한 펜, 6px, 100퍼센트",
    }));
    await waitFor(() => expect(onApplyBrush).toHaveBeenCalledOnce());
    expect(onApplyBrush).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }));
    expect(screen.getByText("관리 · 덮어쓰기, 복제, 공유")).toBeTruthy();
  });

  it("빈 상태는 모바일에서도 저장 브러시를 재사용할 수 있음을 안내한다", () => {
    const html = renderToStaticMarkup(
      <StudioBrushLibraryPanel
        currentSnapshot={snapshot}
        brushes={[]}
        onBrushesChange={() => undefined}
        onApplyBrush={() => undefined}
        onBrushDeleted={() => undefined}
      />
    );
    expect(html).toContain("브러시 카탈로그를 준비하고 있어요");
  });

  it("제품 경계가 SQLite 권위 repository를 비동기로 불러오고 mutation을 그 포트로 보낸다", async () => {
    const values = new Map<string, string>([
      [
        BRUSH_LIBRARY_KEY,
        JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION, brushes: [saved] }),
      ],
    ]);
    const storage: BrushLibraryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const repository = createStorageBrushLibraryRepository(storage);
    const repositoryFactory = vi.fn(async () => ({
      authority: "sqlite" as const,
      repository,
      migration: null,
    }));

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={vi.fn()}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => expect(screen.getByText(/1개 · 무제한 · 로컬 SQL/)).toBeTruthy());
    expect(
      container.querySelector("[data-studio-brush-library-authority]")
        ?.getAttribute("data-studio-brush-library-authority"),
    ).toBe("sqlite");
    expect(repositoryFactory).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "주력 펜 고정 해제" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "주력 펜 빠른 선반에 고정" })
          .getAttribute("aria-pressed"),
      ).toBe("false");
    });

    await repository.put({
      ...saved,
      id: "market-installed",
      name: "마켓 설치 펜",
      createdAt: 10,
      updatedAt: 10,
      lastUsedAt: null,
    });
    notifyStudioBrushLibraryChanged();
    await waitFor(() => expect(screen.getByText("마켓 설치 펜")).toBeTruthy());
    expect(screen.getByText(/2개 · 무제한 · 로컬 SQL/u)).toBeTruthy();
  });

  it("첫 repository 열기 실패 뒤 같은 패널에서 새 generation으로 복구한다", async () => {
    const repository = createStorageBrushLibraryRepository({
      getItem: () => null,
      setItem: () => undefined,
    });
    const repositoryFactory = vi.fn()
      .mockRejectedValueOnce(new Error("worker bootstrap failed"))
      .mockResolvedValue({
        authority: "sqlite" as const,
        repository,
        migration: null,
      });

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={vi.fn()}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => expect(
      container.querySelector("[data-studio-brush-library-authority]")
        ?.getAttribute("data-studio-brush-library-authority"),
    ).toBe("error"));

    fireEvent.change(screen.getByRole("searchbox", { name: "내 브러시 검색" }), {
      target: { value: "복구" },
    });

    await waitFor(() => expect(
      container.querySelector("[data-studio-brush-library-authority]")
        ?.getAttribute("data-studio-brush-library-authority"),
    ).toBe("sqlite"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(repositoryFactory).toHaveBeenCalledTimes(2);
  });

  it("SQLite 비가용 메모리 세션을 비영속으로 표시하고 저장·무제한을 주장하지 않는다", async () => {
    const values = new Map<string, string>([
      [
        BRUSH_LIBRARY_KEY,
        JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION, brushes: [saved] }),
      ],
    ]);
    const repository = createStorageBrushLibraryRepository({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    const repositoryFactory = vi.fn(async () => ({
      authority: "memory-session" as const,
      repository,
      migration: null,
    }));

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={vi.fn()}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => expect(screen.getByText(
      "세션 편집·가져오기·공유·재적용 · 1개 · 비영속 메모리 · 브라우저 종료 시 사라짐",
    )).toBeTruthy());
    expect(container.querySelector("[data-studio-brush-library-authority]")
      ?.getAttribute("data-studio-brush-library-authority")).toBe("memory-session");
    expect(screen.getByRole("button", { name: "현재 브러시 세션에 보관" })).toBeTruthy();
    expect(container.textContent).not.toContain("무제한");
    expect(container.textContent).not.toContain("현재 브러시 저장");
    expect(container.textContent).not.toContain("호환 저장소");
  });

  it("무제한 SQLite 카탈로그를 256개 keyset 페이지로 읽고 명시적으로 이어 붙인다", async () => {
    const second: StudioSavedBrush = {
      ...saved,
      id: "saved-2",
      name: "두 번째 펜",
      createdAt: 4,
      updatedAt: 5,
      lastUsedAt: 6,
      pinned: false,
    };
    const baseRepository = createStorageBrushLibraryRepository({
      getItem: () => null,
      setItem: () => undefined,
    });
    const query = vi.fn(async (request: BrushLibraryPageRequest = {}) => {
      if (request.search === "두 번째") {
        return {
          items: [second],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        };
      }
      return request.cursor === "page-2"
        ? {
            items: [second],
            nextCursor: null,
            hasMore: false,
            totalCount: 2,
          }
        : {
            items: [saved],
            nextCursor: "page-2",
            hasMore: true,
            totalCount: 2,
          };
    });
    const repositoryFactory = async () => ({
      authority: "sqlite" as const,
      repository: { ...baseRepository, query },
      migration: null,
    });

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={vi.fn()}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => expect(screen.getByText(/2개 · 무제한 · 로컬 SQL/u)).toBeTruthy());
    expect(query).toHaveBeenNthCalledWith(1, { cursor: null, limit: 256 });
    expect(container.querySelector("[data-studio-brush-library-loaded-count]")
      ?.getAttribute("data-studio-brush-library-loaded-count")).toBe("1");
    expect(screen.queryByText("두 번째 펜")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "더 불러오기 (1/2)" }));

    await waitFor(() => expect(screen.getByText("두 번째 펜")).toBeTruthy());
    expect(query).toHaveBeenNthCalledWith(2, { cursor: "page-2", limit: 256 });
    expect(screen.queryByRole("button", { name: /더 불러오기/u })).toBeNull();
    expect(container.querySelector("[data-studio-brush-library-loaded-count]")
      ?.getAttribute("data-studio-brush-library-loaded-count")).toBe("2");

    fireEvent.change(screen.getByRole("searchbox", { name: "내 브러시 검색" }), {
      target: { value: "두 번째" },
    });

    await waitFor(() => expect(screen.getByText(/1개 · 무제한 · 로컬 SQL/u)).toBeTruthy());
    expect(query).toHaveBeenLastCalledWith({
      cursor: null,
      limit: 256,
      search: "두 번째",
    });
    expect(screen.getByText("두 번째 펜")).toBeTruthy();
    expect(screen.queryByText("주력 펜")).toBeNull();
  });

  it("Krita bundle의 KPP/MYB 3개를 한 putMany로 저장하고 권리·미지원 원장을 표시한다", async () => {
    const values = new Map<string, string>();
    const storage: BrushLibraryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const repository = createStorageBrushLibraryRepository(storage);
    const putMany = vi.spyOn(repository, "putMany");
    const repositoryFactory = async () => ({
      authority: "sqlite" as const,
      repository,
      migration: null,
    });

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={vi.fn()}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    render(<Harness />);
    await waitFor(() => expect(screen.getByText(/0개 · 무제한 · 로컬 SQL/u)).toBeTruthy());
    const bytes = buildKritaBundleFixture({ compression: "stored" });
    const input = screen.getByLabelText(
      "브러시 설정 · Photoshop ABR · Clip Studio SUT/SUTG · libmypaint MYB · Krita KPP/번들 가져오기",
    );
    fireEvent.change(input, {
      target: {
        files: [new File([bytes.slice().buffer], "authored.bundle", {
          type: "application/x-krita-resourcebundle",
        })],
      },
    });

    await waitFor(() => expect(putMany).toHaveBeenCalledOnce());
    expect(putMany.mock.calls[0]?.[0]).toHaveLength(3);
    await waitFor(() => expect(screen.getByText(/3개 · 무제한 · 로컬 SQL/u)).toBeTruthy());
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("Krita 번들");
    expect(status).toContain("CC0-1.0");
    expect(status).toContain("미지원 항목");
  });

  it("Worker 격리가 없으면 preserve-only SUT를 성공 처리하거나 putMany하지 않는다", async () => {
    vi.stubGlobal("Worker", undefined);
    const values = new Map<string, string>();
    const storage: BrushLibraryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    const repository = createStorageBrushLibraryRepository(storage);
    const putMany = vi.spyOn(repository, "putMany");
    const repositoryFactory = async () => ({
      authority: "sqlite" as const,
      repository,
      migration: null,
    });
    render(
      <StudioBrushLibraryPanel
        currentSnapshot={snapshot}
        brushes={[]}
        onBrushesChange={vi.fn()}
        onApplyBrush={vi.fn()}
        onBrushDeleted={vi.fn()}
        repositoryFactory={repositoryFactory}
      />,
    );
    const bytes = buildAuthoredSutFixture();
    fireEvent.change(screen.getByLabelText(
      "브러시 설정 · Photoshop ABR · Clip Studio SUT/SUTG · libmypaint MYB · Krita KPP/번들 가져오기",
    ), {
      target: {
        files: [new File([bytes.slice().buffer], "preserve-only.sut", {
          type: "application/octet-stream",
        })],
      },
    });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("보존 판정"));
    expect(screen.getByRole("alert").textContent).toContain("SQLite 카탈로그에는 저장하지 않았어요");
    expect(screen.queryByRole("status")).toBeNull();
    expect(putMany).not.toHaveBeenCalled();
  });

  it("노출 필터는 전체가 기본이고 격리 프리셋 브러시는 정적 렌더에서도 목록에서 제외한다", () => {
    expect(brushLifecycleStageOf("gpen--causal-round")).toBe("quarantined");
    const html = renderToStaticMarkup(
      <StudioBrushLibraryPanel
        currentSnapshot={snapshot}
        brushes={[saved, quarantinedGpen]}
        onBrushesChange={() => undefined}
        onApplyBrush={() => undefined}
        onBrushDeleted={() => undefined}
      />
    );
    expect(html).toContain('aria-label="브러시 노출 단계 필터"');
    expect(html).toContain('data-studio-brush-exposure-tier="all"');
    expect(html).toContain('aria-pressed="true" data-studio-brush-exposure-tier-option="all"');
    expect(html).toContain('aria-pressed="false" data-studio-brush-exposure-tier-option="core"');
    expect(html).toContain(
      'aria-pressed="false" data-studio-brush-exposure-tier-option="experimental"',
    );
    expect(html).toContain("주력 펜");
    expect(html).not.toContain("격리 지펜");
  });

  it("전체 보기는 격리 프리셋만 제외하고 핵심·확장·실험 저장 브러시를 모두 나열한다", async () => {
    expect(brushLifecycleStageOf("pen")).toBe("core");
    expect(brushLifecycleStageOf("watercolor")).toBe("core");
    expect(brushLifecycleStageOf("watercolor--granular")).toBe("extended");
    expect(brushLifecycleStageOf("watercolor--edge-bloom")).toBe("experimental");
    const repositoryFactory = seededRepositoryFactory([
      saved,
      watercolorBase,
      watercolorExtended,
      watercolorExperimental,
      quarantinedGpen,
    ]);

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={vi.fn()}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    render(<Harness />);
    await waitFor(() => expect(screen.getByText("번짐 수채")).toBeTruthy());
    expect(screen.getByText("주력 펜")).toBeTruthy();
    expect(screen.getByText("수채 기본")).toBeTruthy();
    expect(screen.getByText("실험 수채")).toBeTruthy();
    // 격리 프리셋 브러시는 저장소에는 남지만(5개 로드) 새 목록에는 나타나지 않는다.
    expect(screen.getByText(/5개 · 무제한 · 로컬 SQL/u)).toBeTruthy();
    expect(screen.queryByText("격리 지펜")).toBeNull();
  });

  it("핵심·실험 보기는 해당 단계만 남기고 격리는 모든 보기에서 계속 제외한다", async () => {
    const repositoryFactory = seededRepositoryFactory([
      saved,
      watercolorBase,
      watercolorExtended,
      watercolorExperimental,
      quarantinedGpen,
    ]);

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={vi.fn()}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => expect(screen.getByText("번짐 수채")).toBeTruthy());
    const tierAttribute = () => container
      .querySelector("[data-studio-brush-exposure-tier]")
      ?.getAttribute("data-studio-brush-exposure-tier");

    fireEvent.click(screen.getByRole("button", { name: "핵심" }));
    expect(tierAttribute()).toBe("core");
    await waitFor(() => {
      expect(screen.getByText("주력 펜")).toBeTruthy();
      expect(screen.getByText("수채 기본")).toBeTruthy();
      expect(screen.queryByText("번짐 수채")).toBeNull();
      expect(screen.queryByText("실험 수채")).toBeNull();
      expect(screen.queryByText("격리 지펜")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "실험" }));
    expect(tierAttribute()).toBe("experimental");
    await waitFor(() => {
      expect(screen.getByText("실험 수채")).toBeTruthy();
      expect(screen.queryByText("주력 펜")).toBeNull();
      expect(screen.queryByText("수채 기본")).toBeNull();
      expect(screen.queryByText("번짐 수채")).toBeNull();
      expect(screen.queryByText("격리 지펜")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    expect(tierAttribute()).toBe("all");
    await waitFor(() => {
      expect(screen.getByText("주력 펜")).toBeTruthy();
      expect(screen.getByText("번짐 수채")).toBeTruthy();
      expect(screen.queryByText("격리 지펜")).toBeNull();
    });
  });

  it("변형군 배지에서 형제 프리셋을 고르면 그 저장 브러시가 적용되고 격리 형제는 나열되지 않는다", async () => {
    const onApplyBrush = vi.fn();
    const repositoryFactory = seededRepositoryFactory([
      watercolorBase,
      watercolorExtended,
      quarantinedGpen,
    ]);

    function Harness() {
      const [items, setItems] = useState<StudioSavedBrush[]>([]);
      return (
        <StudioBrushLibraryPanel
          currentSnapshot={snapshot}
          brushes={items}
          onBrushesChange={setItems}
          onApplyBrush={onApplyBrush}
          onBrushDeleted={vi.fn()}
          repositoryFactory={repositoryFactory}
        />
      );
    }

    render(<Harness />);
    const applyBase = await screen.findByRole("button", { name: /수채 기본 브러시 적용/u });
    const item = applyBase.closest("li");
    expect(item).toBeTruthy();
    if (!item) return;

    // 거버넌스 모듈이 지연 로드된 뒤에야 변형군 배지가 나타난다.
    await waitFor(() => expect(within(item).getByText(/변형군 · 형제/u)).toBeTruthy());
    expect(within(item).getByRole("list", { name: "수채 기본 변형군 형제 프리셋" })).toBeTruthy();

    // 격리된 형제(G펜 · 연속 원형)는 어느 항목의 변형군에서도 새로 나열되지 않는다.
    expect(screen.queryByText("G펜 · 연속 원형")).toBeNull();

    fireEvent.click(within(item).getByRole("button", { name: /저장 브러시 번짐 수채/u }));
    await waitFor(() => expect(onApplyBrush).toHaveBeenCalledOnce());
    expect(onApplyBrush).toHaveBeenCalledWith(
      expect.objectContaining({ id: "saved-watercolor-extended" }),
    );
  });
});
