// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmptyStudioAiImageReferenceDocument,
  hydrateStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
} from "./studio-ai-image-reference-roles";
import {
  StudioAiImageReferencePackEditor,
  STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX,
  type StudioAiImageReferenceAssetOption,
} from "./StudioAiImageReferencePackEditor";

afterEach(cleanup);

const HASH = `sha256:${"a".repeat(64)}`;
const ASSETS: readonly StudioAiImageReferenceAssetOption[] = [
  {
    id: "asset/hero",
    name: "주인공 설정화",
    thumbnailUrl: "data:image/png;base64,private-preview",
    sha256: HASH,
  },
  {
    id: "asset/shot",
    name: "로우 앵글 구도",
    thumbnailUrl: "blob:http://localhost/private-shot",
  },
];

function referenceDocument(
  references: readonly Record<string, unknown>[],
): StudioAiImageReferenceDocument {
  return hydrateStudioAiImageReferenceDocument({ references });
}

function renderEditor(
  options: Partial<React.ComponentProps<typeof StudioAiImageReferencePackEditor>> = {},
) {
  const onChange = options.onChange
    ? vi.fn(options.onChange)
    : vi.fn<(next: StudioAiImageReferenceDocument) => void>();
  const result = render(
    <StudioAiImageReferencePackEditor
      document={options.document ?? createEmptyStudioAiImageReferenceDocument()}
      assetOptions={options.assetOptions ?? ASSETS}
      loading={options.loading}
      disabled={options.disabled}
      onChange={onChange}
    />,
  );
  return { ...result, onChange };
}

describe("StudioAiImageReferencePackEditor", () => {
  it("presents Character, Method, and Style as three explicit role sections", () => {
    renderEditor();

    expect(screen.getByRole("heading", { name: "Character · 캐릭터" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Method · 구도·연출" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Style · 화풍" })).toBeTruthy();
    expect(screen.getByText(/얼굴·체형·헤어·의상/u)).toBeTruthy();
    expect(screen.getByText(/카메라 각도·프레이밍/u)).toBeTruthy();
    expect(screen.getByText(/선질·색 관계·광원/u)).toBeTruthy();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("adds only asset identity metadata and never copies thumbnail data into the document", () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByRole("combobox", { name: "Character에 추가할 에셋" }), {
      target: { value: "asset/hero" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Character 참조 추가" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as StudioAiImageReferenceDocument;
    expect(next.references).toHaveLength(1);
    expect(next.references[0]).toMatchObject({
      role: "character",
      asset: { assetId: "asset/hero", sha256: HASH },
      label: "주인공 설정화",
    });
    expect(JSON.stringify(next)).not.toContain("private-preview");
    expect(JSON.stringify(next)).not.toContain("thumbnailUrl");
  });

  it("prevents same-role duplicates while allowing the same asset in another role", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StudioAiImageReferencePackEditor
        document={createEmptyStudioAiImageReferenceDocument()}
        assetOptions={ASSETS}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Character에 추가할 에셋" }), {
      target: { value: "asset/hero" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Character 참조 추가" }));
    const characterDocument = onChange.mock.calls[0]![0] as StudioAiImageReferenceDocument;

    rerender(
      <StudioAiImageReferencePackEditor
        document={characterDocument}
        assetOptions={ASSETS}
        onChange={onChange}
      />,
    );
    expect(
      within(screen.getByRole("combobox", { name: "Character에 추가할 에셋" }))
        .queryByRole("option", { name: "주인공 설정화" }),
    ).toBeNull();
    expect(
      within(screen.getByRole("combobox", { name: "Method에 추가할 에셋" }))
        .getByRole("option", { name: "주인공 설정화" }),
    ).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Method에 추가할 에셋" }), {
      target: { value: "asset/hero" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Method 참조 추가" }));
    const crossRoleDocument = onChange.mock.calls.at(-1)![0] as StudioAiImageReferenceDocument;
    expect(crossRoleDocument.references.map((reference) => reference.role)).toEqual([
      "character",
      "method",
    ]);
  });

  it("treats a stored hash as authoritative while recovering an asset renamed with identical pixels", () => {
    const document = referenceDocument([
      {
        id: "hero-reference",
        role: "character",
        assetId: "reused-id",
        sha256: HASH,
        label: "저장된 주인공",
      },
    ]);
    const replacementHash = `sha256:${"b".repeat(64)}`;
    renderEditor({
      document,
      assetOptions: [
        {
          id: "reused-id",
          name: "ID만 같은 다른 이미지",
          thumbnailUrl: "data:image/png;base64,UkVQTEFDRU1FTlQ=",
          sha256: replacementHash,
        },
        {
          id: "renamed-original",
          name: "이름 변경된 원본",
          thumbnailUrl: "data:image/png;base64,T1JJR0lOQUw=",
          sha256: HASH,
        },
      ],
    });

    expect(screen.getByTitle("이름 변경된 원본")).toBeTruthy();
    expect(
      within(screen.getByRole("combobox", { name: "Character에 추가할 에셋" }))
        .getByRole("option", { name: "ID만 같은 다른 이미지" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("combobox", { name: "Character에 추가할 에셋" }))
        .queryByRole("option", { name: "이름 변경된 원본" }),
    ).toBeNull();
  });

  it("blocks cross-origin and active-data thumbnails without issuing an image request", () => {
    renderEditor({
      document: referenceDocument([
        {
          id: "remote",
          role: "style",
          assetId: "asset/remote",
          label: "원격 미리보기",
        },
        {
          id: "svg",
          role: "style",
          assetId: "asset/svg",
          label: "SVG 미리보기",
        },
        {
          id: "same-origin",
          role: "style",
          assetId: "asset/same-origin",
          label: "동일 출처 미리보기",
        },
        {
          id: "data-raster",
          role: "style",
          assetId: "asset/data-raster",
          label: "로컬 래스터 미리보기",
        },
      ]),
      assetOptions: [
        {
          id: "asset/remote",
          name: "원격 미리보기",
          thumbnailUrl: "https://tracker.example/private.png",
        },
        {
          id: "asset/svg",
          name: "SVG 미리보기",
          thumbnailUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        },
        {
          id: "asset/same-origin",
          name: "동일 출처 미리보기",
          thumbnailUrl: "/assets/reference.png",
        },
        {
          id: "asset/data-raster",
          name: "로컬 래스터 미리보기",
          thumbnailUrl: "data:image/webp;base64,UklGRg==",
        },
      ],
    });

    expect(
      Array.from(document.querySelectorAll("img"), (image) =>
        image.getAttribute("src"),
      ),
    ).toEqual([
      "data:image/webp;base64,UklGRg==",
      `${window.location.origin}/assets/reference.png`,
    ]);
    expect(
      screen.getAllByTitle(
        "외부 미리보기는 개인정보 보호를 위해 차단되었습니다.",
      ),
    ).toHaveLength(2);
  });

  it("edits optional guidance and removes a selected reference", () => {
    const document = referenceDocument([
      {
        id: "hero-reference",
        role: "character",
        assetId: "asset/hero",
        sha256: HASH,
        label: "주인공 설정화",
      },
    ]);
    const { onChange } = renderEditor({ document });
    fireEvent.change(screen.getByRole("textbox", { name: "주인공 설정화 참조 지침" }), {
      target: { value: "얼굴과 교복 색만 유지" },
    });
    const guided = onChange.mock.calls.at(-1)![0] as StudioAiImageReferenceDocument;
    expect(guided.references[0]?.guidance).toBe("얼굴과 교복 색만 유지");

    fireEvent.click(
      screen.getByRole("button", { name: "주인공 설정화 Character 참조 제거" }),
    );
    const removed = onChange.mock.calls.at(-1)![0] as StudioAiImageReferenceDocument;
    expect(removed.references).toEqual([]);
  });

  it("explains and disables a role at six references without blocking another role", () => {
    const references = Array.from({ length: 6 }, (_, index) => ({
      id: `character-${index}`,
      role: "character",
      assetId: `asset/character-${index}`,
      label: `캐릭터 ${index}`,
    }));
    renderEditor({ document: referenceDocument(references) });

    expect(screen.getByText("Character 역할은 최대 6개까지 연결할 수 있습니다.")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Character에 추가할 에셋" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("combobox", { name: "Method에 추가할 에셋" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("enforces and explains the provider-safe total of sixteen references", () => {
    const references = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `character-${index}`,
        role: "character",
        assetId: `asset/character-${index}`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `method-${index}`,
        role: "method",
        assetId: `asset/method-${index}`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `style-${index}`,
        role: "style",
        assetId: `asset/style-${index}`,
      })),
    ];
    renderEditor({ document: referenceDocument(references) });

    expect(
      screen.getByLabelText(
        `전체 참조 ${STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX}/${STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/AI 제공자 안전 한도 16개에 도달/u),
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("combobox").every((control) => control.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("renders explicit loading, empty, and disabled states", () => {
    const { rerender } = render(
      <StudioAiImageReferencePackEditor
        document={createEmptyStudioAiImageReferenceDocument()}
        assetOptions={[]}
        loading
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("불러오는 중");
    expect(screen.getAllByRole("combobox").every((control) => control.hasAttribute("disabled"))).toBe(true);

    rerender(
      <StudioAiImageReferencePackEditor
        document={createEmptyStudioAiImageReferenceDocument()}
        assetOptions={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("이 역할에 새로 연결할 에셋이 없습니다.")).toHaveLength(3);
    expect(screen.getAllByText(/참조가 없습니다/u)).toHaveLength(3);

    rerender(
      <StudioAiImageReferencePackEditor
        document={referenceDocument([{
          id: "hero",
          role: "character",
          assetId: "asset/hero",
          label: "주인공 설정화",
        }])}
        assetOptions={ASSETS}
        disabled
        onChange={vi.fn()}
      />,
    );
    const editor = screen.getByRole("region", { name: "AI 이미지 참조 팩" });
    expect(editor.getAttribute("data-disabled")).toBe("true");
    expect(screen.getAllByText(/읽기 전용 상태/u).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button").every((control) => control.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("keeps every mobile control at 44px and constrains the 320px layout tracks", () => {
    renderEditor({
      document: referenceDocument([{
        id: "hero",
        role: "character",
        assetId: "asset/hero",
        label: "주인공 설정화",
      }]),
    });
    const editor = document.querySelector(
      '[data-studio-ai-image-reference-pack-editor="true"]',
    );
    expect(editor?.className).toContain("w-full min-w-0 overflow-hidden");
    for (const select of screen.getAllByRole("combobox")) {
      expect(select.className).toContain("min-h-11");
      expect(select.className).toContain("min-w-0");
    }
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/(?:min-h-11|min-w-11|size-11)/u);
    }
    expect(editor?.innerHTML).toContain("grid-cols-[44px_minmax(0,1fr)_44px]");
    expect(editor?.innerHTML).toContain("grid-cols-[minmax(0,1fr)_44px]");
  });
});
