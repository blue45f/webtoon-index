import { describe, expect, it } from "vitest";

import {
  createStudioWebtoonDesignTokenDocument,
  hashStudioWebtoonDesignTokenDocument,
  projectStudioWebtoonDesignTokensToBrandKit,
  projectStudioWebtoonDesignTokensToSceneSeeds,
  resolveStudioWebtoonDesignToken,
  serializeStudioWebtoonDesignTokenDocument,
  STUDIO_WEBTOON_BUILTIN_MODE_AXES,
  STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES,
  STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS,
  StudioWebtoonDesignTokenError,
  type StudioWebtoonDesignToken,
} from "./studio-webtoon-design-tokens";

import type { BrandKit } from "./studio-brand-kit";
import type { SceneSeed } from "./studio-scene-templates";

function documentWith(
  tokens: readonly StudioWebtoonDesignToken[],
  axes = STUDIO_WEBTOON_BUILTIN_MODE_AXES,
) {
  return createStudioWebtoonDesignTokenDocument({
    version: 1,
    axes,
    tokens,
  });
}

function typographyToken(
  id: string,
  input: Partial<Extract<
    StudioWebtoonDesignToken,
    { category: "typography" }
  >> = {},
): Extract<StudioWebtoonDesignToken, { category: "typography" }> {
  return {
    id,
    label: id,
    category: "typography",
    value: {},
    ...input,
  };
}

function expectTokenError(
  action: () => unknown,
  code: StudioWebtoonDesignTokenError["code"],
): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioWebtoonDesignTokenError);
    expect((error as StudioWebtoonDesignTokenError).code).toBe(code);
  }
}

describe("studio webtoon design tokens", () => {
  it("resolves inheritance, mode specificity, priority, and runtime override in deterministic cascade order", () => {
    const document = documentWith([
      typographyToken("type.base", {
        value: {
          fontFamily: "Pretendard, sans-serif",
          fontSizePx: 16,
          color: "#222222",
        },
        overrides: [
          {
            id: "night",
            selector: { theme: "night" },
            value: { color: "#eeeeee", fontSizePx: 17 },
          },
          {
            id: "night-mobile",
            selector: { platform: "mobile", theme: "night" },
            priority: 10,
            value: { fontSizePx: 20 },
          },
        ],
      }),
      typographyToken("type.dialogue", {
        extendsTokenId: "type.base",
        value: { fontWeight: 700 },
        overrides: [
          {
            id: "japanese",
            selector: { language: "ja" },
            value: { fontFamily: "'Noto Sans JP', sans-serif" },
          },
        ],
      }),
    ]);

    expect(document.usable).toBe(true);
    const resolved = resolveStudioWebtoonDesignToken<"typography">(
      document,
      "type.dialogue",
      {
        modes: { theme: "night", language: "ja", platform: "mobile" },
        runtimeOverride: { letterSpacingPx: 1.5 },
      },
    );

    expect(resolved.inheritanceChain).toEqual([
      "type.base",
      "type.dialogue",
    ]);
    expect(resolved.appliedOverrideIds).toEqual([
      "type.base:night",
      "type.base:night-mobile",
      "type.dialogue:japanese",
    ]);
    expect(resolved.value).toMatchObject({
      fontFamily: "'Noto Sans JP', sans-serif",
      fontSizePx: 20,
      fontWeight: 700,
      letterSpacingPx: 1.5,
      color: "#eeeeee",
    });
  });

  it("produces the same canonical snapshot and hash regardless of declaration and object-key order", () => {
    const paletteA: StudioWebtoonDesignToken = {
      id: "palette.story",
      label: "Story",
      category: "palette",
      value: {
        colors: ["#111111", "#eeeeee"],
        roles: { text: "#111111", paper: "#eeeeee" },
      },
    };
    const strokeA: StudioWebtoonDesignToken = {
      id: "stroke.panel",
      label: "Panel",
      category: "stroke",
      value: { color: "#111111", widthPx: 3 },
      overrides: [
        {
          id: "print",
          selector: { platform: "print" },
          value: { widthPx: 2 },
        },
        {
          id: "night-mobile",
          selector: { platform: "mobile", theme: "night" },
          value: { color: "#eeeeee" },
        },
      ],
    };
    const paletteB: StudioWebtoonDesignToken = {
      ...paletteA,
      value: {
        roles: { paper: "#eeeeee", text: "#111111" },
        colors: ["#111111", "#eeeeee"],
      },
    };
    const strokeB: StudioWebtoonDesignToken = {
      ...strokeA,
      overrides: [...(strokeA.overrides ?? [])].reverse(),
    };

    const first = createStudioWebtoonDesignTokenDocument({
      version: 1,
      axes: STUDIO_WEBTOON_BUILTIN_MODE_AXES,
      tokens: [paletteA, strokeA],
    });
    const second = createStudioWebtoonDesignTokenDocument({
      version: 1,
      axes: [...STUDIO_WEBTOON_BUILTIN_MODE_AXES].reverse(),
      tokens: [strokeB, paletteB],
    });

    expect(serializeStudioWebtoonDesignTokenDocument(second)).toBe(
      serializeStudioWebtoonDesignTokenDocument(first),
    );
    expect(hashStudioWebtoonDesignTokenDocument(second)).toBe(
      hashStudioWebtoonDesignTokenDocument(first),
    );
    expect(hashStudioWebtoonDesignTokenDocument(first)).toMatch(
      /^wtdt1-[0-9a-f]{8}$/,
    );
  });

  it("diagnoses duplicate, dangling, mismatched, cyclic, unknown-mode, and unknown-field documents and fails closed", () => {
    const malformedTokens = [
      typographyToken("duplicate"),
      typographyToken("duplicate"),
      typographyToken("dangling", { extendsTokenId: "missing" }),
      typographyToken("wrong-kind", { extendsTokenId: "palette.parent" }),
      {
        id: "palette.parent",
        label: "Palette",
        category: "palette",
        value: { colors: ["#111111"] },
      },
      typographyToken("cycle.a", { extendsTokenId: "cycle.b" }),
      typographyToken("cycle.b", { extendsTokenId: "cycle.a" }),
      typographyToken("bad.override", {
        value: { mystery: true } as never,
        overrides: [
          {
            id: "same",
            selector: { missingAxis: "value" },
            value: {},
          },
          {
            id: "unknown-value",
            selector: { theme: "missingValue" },
            value: {},
          },
          {
            id: "same",
            selector: { theme: "night" },
            value: {},
          },
        ],
      }),
    ] satisfies readonly StudioWebtoonDesignToken[];

    const document = documentWith(malformedTokens);
    const codes = new Set(document.diagnostics.map(({ code }) => code));

    expect(codes).toEqual(
      new Set([
        "DANGLING_TOKEN_REFERENCE",
        "DUPLICATE_OVERRIDE_ID",
        "DUPLICATE_TOKEN_ID",
        "TOKEN_REFERENCE_CYCLE",
        "TOKEN_REFERENCE_KIND_MISMATCH",
        "UNKNOWN_MODE_AXIS",
        "UNKNOWN_MODE_VALUE",
        "UNKNOWN_TOKEN_FIELD",
      ]),
    );
    expect(document.usable).toBe(false);
    expectTokenError(
      () => resolveStudioWebtoonDesignToken(document, "cycle.a"),
      "INVALID_DOCUMENT",
    );
    expectTokenError(
      () => serializeStudioWebtoonDesignTokenDocument(document),
      "INVALID_DOCUMENT",
    );
  });

  it("fails closed for an unknown token, unknown active mode, and invalid runtime patch", () => {
    const document = documentWith([typographyToken("type.body")]);

    expectTokenError(
      () => resolveStudioWebtoonDesignToken(document, "missing"),
      "UNKNOWN_TOKEN",
    );
    expectTokenError(
      () =>
        resolveStudioWebtoonDesignToken(document, "type.body", {
          modes: { accessibility: "large" },
        }),
      "UNKNOWN_MODE_AXIS",
    );
    expectTokenError(
      () =>
        resolveStudioWebtoonDesignToken(document, "type.body", {
          modes: { language: "fr" },
        }),
      "UNKNOWN_MODE_VALUE",
    );
    expectTokenError(
      () =>
        resolveStudioWebtoonDesignToken<"typography">(
          document,
          "type.body",
          { runtimeOverride: { fontSizePx: -10 } },
        ),
      "INVALID_RUNTIME_OVERRIDE",
    );
  });

  it("enforces collection and inheritance safety limits before resolution", () => {
    const tooManyAxes = Array.from(
      { length: STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxAxes + 1 },
      (_, index) => ({
        id: `axis-${index}`,
        label: `Axis ${index}`,
        defaultValueId: "default",
        values: [{ id: "default", label: "Default" }],
      }),
    );
    expectTokenError(
      () =>
        createStudioWebtoonDesignTokenDocument({
          version: 1,
          axes: tooManyAxes,
          tokens: [],
        }),
      "LIMIT_EXCEEDED",
    );

    const deepChain = Array.from(
      {
        length:
          STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxInheritanceDepth + 2,
      },
      (_, index) =>
        typographyToken(`type.${index}`, {
          ...(index > 0 ? { extendsTokenId: `type.${index - 1}` } : {}),
        }),
    );
    const deepDocument = createStudioWebtoonDesignTokenDocument({
      version: 1,
      axes: [],
      tokens: deepChain,
    });
    expect(
      deepDocument.diagnostics.some(
        ({ code }) => code === "TOKEN_CHAIN_TOO_DEEP",
      ),
    ).toBe(true);
    expect(deepDocument.usable).toBe(false);
  });

  it("admits 1,000+ tokens, overrides, palette colors, and roles under the canonical byte budget", () => {
    const tokenCount = 1_201;
    const overrideCount = 2_100;
    const colorCount = 1_205;
    const roleCount = 1_101;
    const bulkTokens = Array.from({ length: tokenCount }, (_, index) =>
      typographyToken(`type.bulk.${index}`));
    const overrides = Array.from({ length: overrideCount }, (_, index) => ({
      id: `override-${index}`,
      selector: {},
      value: {},
    }));
    const colors = Array.from(
      { length: colorCount },
      (_, index) => `#${index.toString(16).padStart(6, "0")}`,
    );
    const roles = Object.fromEntries(
      Array.from({ length: roleCount }, (_, index) => [
        `role-${index}`,
        colors[index % colors.length],
      ]),
    );
    const document = createStudioWebtoonDesignTokenDocument({
      version: 1,
      axes: [],
      tokens: [
        ...bulkTokens,
        typographyToken("type.overridden", { overrides }),
        {
          id: "palette.large",
          label: "Large palette",
          category: "palette",
          value: { colors, roles },
        },
      ],
    });

    expect(document.usable).toBe(true);
    expect(document.tokens).toHaveLength(tokenCount + 2);
    expect(
      document.tokens.find(({ id }) => id === "type.overridden")?.overrides,
    ).toHaveLength(overrideCount);
    const palette = resolveStudioWebtoonDesignToken<"palette">(
      document,
      "palette.large",
    );
    expect(palette.value.colors).toHaveLength(colorCount);
    expect(Object.keys(palette.value.roles)).toHaveLength(roleCount);
    expect(
      new TextEncoder().encode(
        serializeStudioWebtoonDesignTokenDocument(document),
      ).byteLength,
    ).toBeLessThanOrEqual(STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES);
    expect(STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS).toMatchObject({
      maxTokens: Number.POSITIVE_INFINITY,
      maxOverridesPerToken: Number.POSITIVE_INFINITY,
      maxTotalOverrides: Number.POSITIVE_INFINITY,
      maxPaletteColors: Number.POSITIVE_INFINITY,
      maxPaletteRoles: Number.POSITIVE_INFINITY,
      maxSerializedBytes: STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES,
    });
  });

  it("rejects byte overflow atomically without changing the committed document identity or result", () => {
    const committed = documentWith([
      typographyToken("type.committed", { value: { fontSizePx: 24 } }),
    ]);
    const committedAxes = committed.axes;
    const committedTokens = committed.tokens;
    const committedToken = committed.tokens[0];
    const committedSnapshot = serializeStudioWebtoonDesignTokenDocument(committed);
    const maximumColor = "가".repeat(
      STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxStringLength,
    );
    const encodedColorBytes = new TextEncoder().encode(
      JSON.stringify(maximumColor),
    ).byteLength + 1;
    const overflowingColors = Array.from({
      length:
        Math.ceil(
          STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES
            / encodedColorBytes,
        ) + 1,
    }, () => maximumColor);

    expectTokenError(
      () =>
        createStudioWebtoonDesignTokenDocument({
          version: 1,
          axes: committed.axes,
          tokens: [
            ...committed.tokens,
            {
              id: "palette.overflow",
              label: "Overflow",
              category: "palette",
              value: { colors: overflowingColors, roles: {} },
            },
          ],
        }),
      "LIMIT_EXCEEDED",
    );
    expect(committed.axes).toBe(committedAxes);
    expect(committed.tokens).toBe(committedTokens);
    expect(committed.tokens[0]).toBe(committedToken);
    expect(serializeStudioWebtoonDesignTokenDocument(committed)).toBe(
      committedSnapshot,
    );
  });

  it("fails typed-closed on accessors, sparse arrays, and cycles without invoking getters", () => {
    let getterCalls = 0;
    const accessorTokens: unknown[] = [];
    Object.defineProperty(accessorTokens, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return typographyToken("type.hostile");
      },
    });
    accessorTokens.length = 1;
    expectTokenError(
      () =>
        createStudioWebtoonDesignTokenDocument({
          version: 1,
          axes: [],
          tokens: accessorTokens as readonly StudioWebtoonDesignToken[],
        }),
      "INVALID_DOCUMENT",
    );
    expect(getterCalls).toBe(0);

    const sparseTokens: unknown[] = [];
    sparseTokens.length =
      STUDIO_WEBTOON_DESIGN_TOKEN_MAX_SERIALIZED_BYTES + 1;
    expectTokenError(
      () =>
        createStudioWebtoonDesignTokenDocument({
          version: 1,
          axes: [],
          tokens: sparseTokens as readonly StudioWebtoonDesignToken[],
        }),
      "INVALID_DOCUMENT",
    );

    const cyclicValue: Record<string, unknown> = {};
    cyclicValue.self = cyclicValue;
    expectTokenError(
      () =>
        createStudioWebtoonDesignTokenDocument({
          version: 1,
          axes: [],
          tokens: [
            typographyToken("type.cyclic", {
              value: cyclicValue as never,
            }),
          ],
        }),
      "INVALID_DOCUMENT",
    );
  });

  it("keeps diagnostics bounded and exposes truncation as the validation backpressure receipt", () => {
    const document = createStudioWebtoonDesignTokenDocument({
      version: 1,
      axes: [],
      tokens: Array.from(
        {
          length: STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxDiagnostics + 20,
        },
        (_, index) =>
          typographyToken(`type.noisy.${index}`, {
            value: { [`unknown-${index}`]: true } as never,
          }),
      ),
    });

    expect(document.diagnostics).toHaveLength(
      STUDIO_WEBTOON_DESIGN_TOKEN_LIMITS.maxDiagnostics,
    );
    expect(document.diagnosticsTruncated).toBe(true);
    expect(document.usable).toBe(false);
  });

  it("supplies complete deterministic defaults for every typed category", () => {
    const categories = [
      "palette",
      "typography",
      "spacing",
      "stroke",
      "bubble",
      "effect",
      "output",
    ] as const;
    const tokens = categories.map(
      (category): StudioWebtoonDesignToken => ({
        id: `${category}.default`,
        label: category,
        category,
        value: {},
      } as StudioWebtoonDesignToken),
    );
    const document = createStudioWebtoonDesignTokenDocument({
      version: 1,
      axes: [],
      tokens,
    });

    expect(document.usable).toBe(true);
    expect(
      resolveStudioWebtoonDesignToken<"palette">(
        document,
        "palette.default",
      ).value,
    ).toEqual({ colors: [], roles: {} });
    expect(
      resolveStudioWebtoonDesignToken<"spacing">(
        document,
        "spacing.default",
      ).value.panelGutterPx,
    ).toBe(20);
    expect(
      resolveStudioWebtoonDesignToken<"bubble">(
        document,
        "bubble.default",
      ).value.tailLengthPx,
    ).toBe(24);
    expect(
      resolveStudioWebtoonDesignToken<"output">(
        document,
        "output.default",
      ).value,
    ).toMatchObject({
      format: "webp",
      quality: 0.92,
      colorSpace: "srgb",
      compression: "balanced",
    });
  });

  it("projects resolved palette and typography modes into a new BrandKit boundary without mutating the source", () => {
    const document = documentWith([
      {
        id: "palette.brand",
        label: "Brand palette",
        category: "palette",
        value: {
          colors: ["#102030", "#fefefe", "#ff6688"],
          roles: { text: "#102030", paper: "#fefefe" },
        },
      },
      typographyToken("type.heading", {
        value: { fontFamily: "'Black Han Sans', sans-serif" },
      }),
      typographyToken("type.body", {
        value: { fontFamily: "Pretendard, sans-serif" },
        overrides: [
          {
            id: "ja",
            selector: { language: "ja" },
            value: { fontFamily: "'Noto Sans JP', sans-serif" },
          },
        ],
      }),
    ]);
    const source: BrandKit = {
      id: "kit-1",
      name: "Episode",
      createdAt: 100,
      updatedAt: 200,
      paletteId: null,
      headingFont: "Old Heading",
      bodyFont: "Old Body",
      logo: null,
    };

    const projection = projectStudioWebtoonDesignTokensToBrandKit(
      document,
      source,
      {
        paletteTokenId: "palette.brand",
        headingTypographyTokenId: "type.heading",
        bodyTypographyTokenId: "type.body",
      },
      { language: "ja" },
    );

    expect(source).toMatchObject({
      paletteId: null,
      headingFont: "Old Heading",
      bodyFont: "Old Body",
    });
    expect(projection.kit).toMatchObject({
      paletteId: "design-token:kit-1:palette",
      headingFont: "'Black Han Sans', sans-serif",
      bodyFont: "'Noto Sans JP', sans-serif",
    });
    expect(projection.palette).toEqual({
      id: "design-token:kit-1:palette",
      name: "Episode 팔레트",
      createdAt: 100,
      updatedAt: 200,
      colors: ["#102030", "#fefefe", "#ff6688"],
    });
    expect(projection.resolvedTokenIds).toEqual([
      "palette.brand",
      "type.body",
      "type.heading",
    ]);
    expectTokenError(
      () =>
        projectStudioWebtoonDesignTokensToBrandKit(document, source, {
          headingTypographyTokenId: "palette.brand",
        }),
      "TOKEN_KIND_MISMATCH",
    );
  });

  it("projects stroke, bubble, type, and effect tokens into cloned SceneSeed objects", () => {
    const document = documentWith([
      {
        id: "stroke.scene",
        label: "Scene stroke",
        category: "stroke",
        value: {
          color: "#334455",
          widthPx: 4,
          dash: [8, 4],
        },
      },
      {
        id: "bubble.dialogue",
        label: "Dialogue",
        category: "bubble",
        value: {
          fill: "#fff4dc",
          textColor: "#291900",
          fontFamily: "'Jua', sans-serif",
          fontSizePx: 22,
        },
      },
      typographyToken("type.effect", {
        value: {
          fontFamily: "'Black Han Sans', sans-serif",
          fontSizePx: 42,
          fontWeight: 800,
          color: "#ff3355",
        },
      }),
      {
        id: "effect.focus",
        label: "Focus",
        category: "effect",
        value: {
          effect: "focus-lines",
          color: "#6622aa",
          intensity: 3,
          density: 48,
          angleDeg: 12,
        },
      },
    ]);
    const source: SceneSeed[] = [
      {
        type: "frame",
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        stroke: "#000000",
        strokeWidth: 1,
      },
      {
        type: "bubble",
        variant: "speech",
        text: "대사",
        x: 10,
        y: 10,
        width: 120,
        height: 80,
        fill: "#ffffff",
        textFill: "#000000",
        rotation: 0,
      },
      {
        type: "text",
        text: "쾅",
        x: 20,
        y: 120,
        width: 100,
        fontSize: 20,
        fill: "#000000",
        rotation: 0,
      },
      {
        type: "focusLines",
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        lineCount: 20,
        innerRadius: 10,
        outerRadius: 100,
        stroke: "#000000",
        strokeWidth: 1,
        noise: 0,
        rotation: 0,
      },
      {
        type: "speedLines",
        x: 0,
        y: 0,
        width: 200,
        height: 300,
        lineCount: 20,
        direction: "horizontal",
        stroke: "#000000",
        strokeWidth: 1,
        rotation: 0,
      },
    ];

    const projected = projectStudioWebtoonDesignTokensToSceneSeeds(
      document,
      source,
      {
        frameStrokeTokenId: "stroke.scene",
        bubbleTokenId: "bubble.dialogue",
        textTypographyTokenId: "type.effect",
        effectTokenId: "effect.focus",
      },
    );

    expect(projected).not.toBe(source);
    expect(source[0]).toMatchObject({ stroke: "#000000", strokeWidth: 1 });
    expect(projected[0]).toMatchObject({
      stroke: "#334455",
      strokeWidth: 4,
      dashStyle: "dashed",
    });
    expect(projected[1]).toMatchObject({
      fill: "#fff4dc",
      textFill: "#291900",
      font: "'Jua', sans-serif",
      fontSize: 22,
    });
    expect(projected[2]).toMatchObject({
      fill: "#ff3355",
      font: "'Black Han Sans', sans-serif",
      fontSize: 42,
      fontStyle: "bold",
      stroke: "#334455",
      strokeWidth: 4,
    });
    expect(projected[3]).toMatchObject({
      stroke: "#6622aa",
      strokeWidth: 3,
      lineCount: 48,
      rotation: 12,
    });
    expect(projected[4]).toMatchObject({
      stroke: "#6622aa",
      strokeWidth: 3,
      lineCount: 48,
      rotation: 12,
    });
  });
});
