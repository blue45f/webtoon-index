/**
 * Wave D contract — unified Command Search and terminology aliases
 * (V5 §15 / audit §2.8, gap `G-ALIAS`).
 *
 * The audit ran eight competitor-terminology queries against the four separate
 * search boxes and got **2 hits out of 8 (25%)**. The eight queries below are
 * transcribed verbatim from `docs/rewrite/ux-audit-v5.md` §2.8; this file is
 * the 100% gate.
 *
 * It also pins the counter-risk the audit named in the same breath: merging
 * four corpora must not turn a 10-result query into a 165-result dump.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildStudioSearchIndex,
  resolveStudioTerminology,
  searchStudio,
  STUDIO_SEARCH_DEFAULT_SECTION_LIMIT,
  STUDIO_SEARCH_DEFAULT_TOTAL_LIMIT,
  STUDIO_SEARCH_SECTION_ORDER,
  studioSearchIndex,
  studioSearchTextMatches,
  tokenizeStudioSearchQuery,
} from "./studio-command-search";
import { studioInspectorActions } from "./studio-inspector-layout";
import { STUDIO_SEARCH_CORPUS } from "./studio-search-corpus";

import type {
  StudioSearchKind,
  StudioSearchOutcome,
} from "./studio-command-search";
import type { StudioInspectorActionContext } from "./studio-inspector-layout";

const index = studioSearchIndex();

function ids(outcome: StudioSearchOutcome): string[] {
  return outcome.sections.flatMap((section) =>
    section.results.map((result) => result.entry.id),
  );
}

/**
 * The audit's measured table, verbatim. `expected` is the entry the query has
 * to surface; `label` is the wording the audit used for the row.
 */
const AUDIT_QUERIES: readonly {
  label: string;
  queries: readonly string[];
  expected: string;
}[] = [
  {
    label: "Bucket fill / 페인트 버킷",
    queries: ["Bucket fill", "페인트 버킷", "Paint Bucket"],
    expected: "tool.fill",
  },
  {
    label: "레이어 마스크",
    queries: ["레이어 마스크", "Layer Mask"],
    expected: "property.layer-mask",
  },
  {
    label: "선택 범위 (CSP)",
    queries: ["선택 범위"],
    expected: "tool.marquee-rect",
  },
  {
    label: "Clipping / 클리핑",
    queries: ["클리핑", "Clipping", "Clipping Mask"],
    expected: "property.clipping",
  },
  {
    label: "Sub tool / 서브 도구",
    queries: ["서브 도구", "Sub tool"],
    expected: "panel.sub-tools",
  },
  {
    label: "Auto action",
    queries: ["Auto action", "자동 액션", "오토 액션"],
    expected: "panel.auto-actions",
  },
  {
    label: "Levels / 레벨",
    queries: ["Levels", "레벨"],
    expected: "property.levels",
  },
  {
    label: "Curves / 커브",
    queries: ["Curves", "커브"],
    expected: "filter.color-curves",
  },
];

describe("통합 Command Search — 감사 8개 질의 100%", () => {
  it.each(AUDIT_QUERIES)("$label", ({ queries, expected }) => {
    for (const query of queries) {
      const outcome = searchStudio(query);
      expect(ids(outcome), `${query} → ${expected}`).toContain(expected);
    }
  });

  it("여덟 질의 전부가 한 건 이상 결과를 낸다 (25% → 100%)", () => {
    const hit = AUDIT_QUERIES.filter((row) =>
      row.queries.every((query) => ids(searchStudio(query)).includes(row.expected)),
    );
    expect(hit).toHaveLength(AUDIT_QUERIES.length);
  });

  it("찾은 결과는 어디에 있는지와 도움말 노드를 함께 준다", () => {
    for (const row of AUDIT_QUERIES) {
      const first = row.queries[0];
      expect(first).toBeDefined();
      const outcome = searchStudio(first as string);
      const match = outcome.sections
        .flatMap((section) => section.results)
        .find((result) => result.entry.id === row.expected);
      expect(match, row.label).toBeDefined();
      expect(match?.entry.location.length).toBeGreaterThan(0);
      expect(match?.entry.helpNodeId).toMatch(/^help\//u);
    }
  });
});

describe("통합 Command Search — 타사 용어 사전", () => {
  it("CSP·Photoshop·Krita·Procreate 용어가 모두 우리 명령으로 풀린다", () => {
    const cases: readonly [string, string][] = [
      ["스포이트", "tool.eyedropper"],
      ["QuickShape", "tool.smart-shape"],
      ["ColorDrop", "tool.fill"],
      ["Inherit Alpha", "property.clipping"],
      ["Options Bar", "panel.tool-properties"],
      ["Brush Library", "panel.sub-tools"],
      ["Actions", "panel.auto-actions"],
      ["Transparency Mask", "property.layer-mask"],
    ];
    for (const [term, expected] of cases) {
      expect(
        resolveStudioTerminology(term).map((entry) => entry.id),
        term,
      ).toContain(expected);
    }
  });

  it("네 사전이 모두 의미 있는 규모로 색인된다", () => {
    const byVendor = new Map<string, number>();
    for (const entry of index.entries) {
      for (const alias of entry.aliases) {
        byVendor.set(alias.vendor, (byVendor.get(alias.vendor) ?? 0) + 1);
      }
    }
    for (const vendor of ["csp", "photoshop", "krita", "procreate"]) {
      expect(byVendor.get(vendor) ?? 0, vendor).toBeGreaterThan(20);
    }
  });

  it("타사 용어로 맞은 결과는 어떤 용어가 맞았는지 되돌려준다", () => {
    const outcome = searchStudio("Paint Bucket");
    const match = outcome.sections
      .flatMap((section) => section.results)
      .find((result) => result.entry.id === "tool.fill");
    expect(match?.matchedOn).toBe("alias");
    expect(match?.matchedAlias?.vendor).toBe("photoshop");
  });
});

/**
 * 회귀 방지(2026-09-04). PR #517 이 오른쪽 패널의 헤더·aria 라벨만 "작업 패널"로
 * 바꾸고 명령 카탈로그는 "속성 패널 표시 전환"에 남겨 둔 탓에, 화면에 보이는 이름으로
 * 이 토글을 검색하면 0건이 나왔다. 검색 색인의 명령 라벨은 메뉴 행이 아니라
 * `STUDIO_COMMAND_CATALOG` 의 `labels` 에서 온다(`buildStudioSearchIndex` 의
 * `label: koLabel(command.labels)`). 그래서 메뉴 행 라벨에 pin 을 박아도 이 결함은
 * 다시 들어올 수 있고, 여기서 실제 색인을 질의해 양쪽 이름을 모두 묶어 둔다.
 */
describe("통합 Command Search — 작업 패널 토글은 화면 이름과 옛 이름 둘 다로 찾힌다", () => {
  const TOGGLE = "window.right-panel";

  it("화면에 보이는 canonical 이름 '작업 패널'로 토글이 나온다", () => {
    expect(ids(searchStudio("작업 패널"))).toContain(TOGGLE);
  });

  it("색인이 들고 있는 명령 라벨 자체가 화면 이름이다", () => {
    const entry = index.entries.find((row) => row.id === TOGGLE);
    expect(entry?.label).toContain("작업 패널");
    expect(entry?.label).not.toContain("속성 패널");
  });

  it("옛 이름 '속성 패널'도 별칭으로 계속 같은 토글에 닿는다", () => {
    const outcome = searchStudio("속성 패널");
    expect(ids(outcome)).toContain(TOGGLE);
    const match = outcome.sections
      .flatMap((section) => section.results)
      .find((result) => result.entry.id === TOGGLE);
    expect(match?.matchedOn).toBe("alias");
    expect(match?.matchedAlias?.vendor).toBe("toonstudio");
  });
});

describe("통합 Command Search — 네 표면의 코퍼스를 모두 덮는다", () => {
  it("명령·속성·패널·튜토리얼 네 구획이 모두 색인돼 있다", () => {
    const kinds = new Set(index.entries.map((entry) => entry.kind));
    for (const kind of STUDIO_SEARCH_SECTION_ORDER) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it("Wave A 카탈로그 155 명령을 하나도 빠뜨리지 않는다", () => {
    const commands = index.entries.filter((entry) => entry.kind === "command");
    expect(commands.length).toBeGreaterThanOrEqual(155);
    expect(new Set(commands.map((entry) => entry.id)).size).toBe(
      commands.length,
    );
  });

  it("튜토리얼과 인스펙터 라우트도 같은 검색창에서 나온다", () => {
    expect(ids(searchStudio("튜토리얼", { kind: "tutorial" })).length + 1)
      .toBeGreaterThan(0);
    expect(ids(searchStudio("게시"))).toContain("inspector.publish");
  });

  /**
   * "브러시 스튜디오" 는 빌더가 액션의 `focusTarget` 을 싣기 시작한 뒤에야
   * 완전한 쌍둥이가 됐다 — 그 전에는 코퍼스 행만 `tool.brush-studio` 를
   * 들고 있어서 목적지가 달랐다. 라벨이 같고 목적지가 같은 행이 두 구획에
   * 나뉘어 뜨는 걸 여기서 막는다.
   */
  it("같은 이름 + 같은 목적지인 행이 색인에 둘 이상 있지 않다", () => {
    const seen = new Map<string, string[]>();
    for (const entry of index.entries) {
      const key = `${entry.label} ${JSON.stringify(entry.target)}`;
      seen.set(key, [...(seen.get(key) ?? []), entry.id]);
    }
    const twins = [...seen.values()].filter((group) => group.length > 1);
    expect(twins).toEqual([]);
  });

  it("중복 목적지는 한 번만 나온다 (인스펙터 라우트 흡수)", () => {
    const outcome = searchStudio("레이어 마스크");
    const labels = outcome.sections
      .flatMap((section) => section.results)
      .filter((result) => result.entry.label === "레이어 마스크");
    expect(labels).toHaveLength(1);
  });

  it("모든 색인 항목의 id 는 유일하다", () => {
    const all = index.entries.map((entry) => entry.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("모든 색인 항목이 도움말 노드를 갖는다", () => {
    for (const entry of index.entries) {
      expect(entry.helpNodeId, entry.id).toMatch(/^help\//u);
    }
  });
});

describe("통합 Command Search — 결과 급증 방지", () => {
  const BROAD_QUERIES = ["레이어", "브러시", "선택", "색", "이미지", "e"];

  it.each(BROAD_QUERIES)("'%s' 는 캡을 넘겨 쏟아지지 않는다", (query) => {
    const outcome = searchStudio(query);
    expect(outcome.totalShown).toBeLessThanOrEqual(
      STUDIO_SEARCH_DEFAULT_TOTAL_LIMIT,
    );
    for (const section of outcome.sections) {
      expect(section.results.length).toBeLessThanOrEqual(
        STUDIO_SEARCH_DEFAULT_SECTION_LIMIT,
      );
    }
  });

  it("잘린 결과 수는 숨기지 않고 totalMatched 로 보고한다", () => {
    const outcome = searchStudio("레이어");
    expect(outcome.totalMatched).toBeGreaterThanOrEqual(outcome.totalShown);
    if (outcome.totalMatched > outcome.totalShown) {
      expect(outcome.truncated).toBe(true);
      expect(outcome.sections.some((section) => section.truncated)).toBe(true);
    }
  });

  it("구획 순서는 명령 → 속성 → 패널 → 튜토리얼로 고정이다", () => {
    const outcome = searchStudio("레이어", { sectionLimit: 3 });
    const order = outcome.sections.map((section) => section.kind);
    const expected = STUDIO_SEARCH_SECTION_ORDER.filter((kind) =>
      order.includes(kind),
    );
    expect(order).toEqual(expected);
  });

  it("토큰 AND 규칙이 넓은 질의를 스스로 좁힌다", () => {
    const broad = searchStudio("레이어", { totalLimit: 500, sectionLimit: 500 });
    const narrow = searchStudio("레이어 마스크", {
      totalLimit: 500,
      sectionLimit: 500,
    });
    expect(narrow.totalMatched).toBeLessThan(broad.totalMatched);
  });

  it("빈 질의는 전체 목록을 쏟지 않는다", () => {
    for (const query of ["", "   ", "\t"]) {
      const outcome = searchStudio(query);
      expect(outcome.totalShown).toBe(0);
      expect(outcome.sections).toHaveLength(0);
    }
  });

  it("캡을 풀어도 구획 상한이 총 상한을 넘지 못한다", () => {
    const outcome = searchStudio("레이어", { sectionLimit: 50, totalLimit: 7 });
    expect(outcome.totalShown).toBeLessThanOrEqual(7);
  });
});

describe("통합 Command Search — 네 검색창이 같은 규칙을 쓴다", () => {
  // 감사 §2.8 이 센 네 표면. 각자 UI 는 남되 "무엇이 매칭인가"는 한 모듈이
  // 정한다. 자체 정규화 함수가 다시 생기면 이 테스트가 먼저 깨진다.
  const SURFACES: readonly [string, string][] = [
    ["StudioShortcutsHelp.tsx", "단축키 도움말"],
    ["studio-quick-access.ts", "⇧Q 빠른 액세스"],
    ["studio-inspector-layout.ts", "인스펙터 네비게이터"],
    ["StudioFeatureTutorialHub.tsx", "튜토리얼 허브"],
  ];

  it.each(SURFACES)("%s (%s) 가 공유 매처를 쓴다", (file) => {
    const source = readFileSync(path.join(__dirname, file), "utf-8");
    expect(source).toContain('from "./studio-search-text"');
    expect(source).toMatch(/studioSearchTextMatches\(/u);
  });

  it.each(SURFACES)("%s 에 자체 정규화 함수가 남아 있지 않다", (file) => {
    const source = readFileSync(path.join(__dirname, file), "utf-8");
    expect(source).not.toMatch(
      /function normalize(?:Help|Tutorial)?Search(?:Text)?\(/u,
    );
  });

  it("통합 검색 다이얼로그는 단일 색인만 소비한다", () => {
    const source = readFileSync(
      path.join(__dirname, "StudioCommandSearchDialog.tsx"),
      "utf-8",
    );
    expect(source).toContain('from "./studio-command-search"');
    expect(source).not.toContain("studio-quick-access");
    expect(source).not.toContain("studio-feature-tutorials");
  });

  it("F1 이 통합 검색에 바인딩돼 있다", () => {
    const source = readFileSync(
      path.join(__dirname, "StudioCommandSearchHost.tsx"),
      "utf-8",
    );
    expect(source).toMatch(/event\.key !== "F1"/u);
  });
});

describe("통합 Command Search — 랭킹", () => {
  it("정확한 라벨 일치가 부분 일치보다 앞선다", () => {
    const outcome = searchStudio("채우기");
    const first = outcome.sections[0]?.results[0];
    expect(first?.entry.id).toBe("tool.fill");
  });

  it("타사 용어 정확 일치도 최상위로 올라온다", () => {
    const outcome = searchStudio("Paint Bucket");
    expect(outcome.sections[0]?.results[0]?.entry.id).toBe("tool.fill");
  });

  it("같은 점수면 짧은 정식 명칭이 이긴다", () => {
    const outcome = searchStudio("커브", { totalLimit: 50, sectionLimit: 50 });
    const labels = outcome.sections
      .flatMap((section) => section.results)
      .map((result) => result.entry.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]?.length).toBeLessThanOrEqual(
      (labels.at(-1) ?? "").length + 6,
    );
  });

  it("점수는 내림차순이다", () => {
    for (const section of searchStudio("레이어").sections) {
      const scores = section.results.map((result) => result.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    }
  });
});

describe("통합 Command Search — 공유 매처", () => {
  it("네 표면이 같은 정규화 규칙을 쓴다", () => {
    expect(tokenizeStudioSearchQuery("Paint  Bucket")).toEqual([
      "paint",
      "bucket",
    ]);
    expect(tokenizeStudioSearchQuery("  ")).toEqual([]);
    expect(studioSearchTextMatches("레이어 마스크", ["레이어", "마스크 편집"]))
      .toBe(true);
    expect(studioSearchTextMatches("레이어 마스크", ["레이어"])).toBe(false);
    expect(studioSearchTextMatches("", ["아무거나"])).toBe(true);
  });

  it("색인은 한 번만 만들고 재사용한다", () => {
    expect(studioSearchIndex()).toBe(studioSearchIndex());
    expect(buildStudioSearchIndex()).not.toBe(studioSearchIndex());
  });
});

describe("통합 Command Search — 인스펙터 행은 목적지를 통째로 나른다", () => {
  /**
   * PR #517 이 인스펙터 자체 검색창을 지우고 통합 검색으로 합칠 때, 코퍼스
   * 빌더가 `route.primary` 만 복사하고 `route.document` 와 `focusTarget` 을
   * 흘렸다. 사라진 검색창은 둘 다 지켰다(`navigateStudioInspector(layout, route)`
   * + `requestStudioInspectorFocus(focusTarget)`), 그래서 결과를 활성화하면 탭은
   * 맞지만 서브탭은 직전 상태로 남고 컨트롤 그룹은 끝내 열리지 않았다.
   *
   * 기대값은 손으로 적지 않는다 — `studioInspectorActions()` 가 선언한 것을
   * 그대로 비교한다. 액션이 늘거나 라우트가 바뀌어도 이 테스트는 따라온다.
   */
  const CONTEXTS: readonly [string, StudioInspectorActionContext][] = [
    [
      "이미지 선택 + 그리기",
      {
        hasSelection: true,
        selectedType: "image",
        drawing: true,
        imageToolsAvailable: true,
      },
    ],
    [
      "텍스트 선택",
      {
        hasSelection: true,
        selectedType: "text",
        drawing: false,
        imageToolsAvailable: true,
      },
    ],
    [
      "말풍선 선택",
      {
        hasSelection: true,
        selectedType: "bubble",
        drawing: false,
        imageToolsAvailable: true,
      },
    ],
    [
      "선택 없음 · 그리기",
      {
        hasSelection: false,
        selectedType: null,
        drawing: true,
        imageToolsAvailable: true,
      },
    ],
  ];

  /** 코퍼스가 흡수한 액션은 자기 행이 없다 — 대신 코퍼스 행이 목적지를 든다. */
  const superseded = new Set(
    STUDIO_SEARCH_CORPUS.flatMap((entry) => entry.supersedes ?? []),
  );

  /** 액션 어휘(panel/property/tool) → 색인 구획. `tool` 도 컨트롤 그룹이다. */
  const EXPECTED_KIND: Readonly<Record<string, StudioSearchKind>> = {
    panel: "panel",
    property: "property",
    tool: "property",
  };

  it.each(CONTEXTS)(
    "%s — 모든 인스펙터 행이 액션이 선언한 라우트·포커스를 그대로 싣는다",
    (_label, context) => {
      const built = buildStudioSearchIndex(context);
      const actions = studioInspectorActions(context).filter(
        (action) => !superseded.has(action.id),
      );
      expect(actions.length).toBeGreaterThan(0);

      for (const action of actions) {
        const entry = built.entries.find(
          (candidate) => candidate.id === `inspector.${action.id}`,
        );
        expect(entry, `inspector.${action.id} 행이 색인에 없다`).toBeDefined();
        expect(entry?.target.type).toBe("inspector");
        if (entry?.target.type !== "inspector") continue;

        // 필드를 손으로 나열하지 않는다 — 액션이 선언한 `route` 를 통째로
        // 펼쳐서 비교한다. `StudioInspectorRoute` 에 새 필드가 생기고 빌더가
        // 그걸 옮기지 않으면, 이 테스트를 건드리지 않아도 여기서 깨진다.
        expect(entry.target).toEqual({
          type: "inspector",
          ...action.route,
          ...(action.focusTarget ? { focusTarget: action.focusTarget } : {}),
        });

        expect(entry.kind).toBe(EXPECTED_KIND[action.kind ?? "panel"]);

        // 다이얼로그가 라벨 밑에 그리는 건 `location` 이다. 액션이 이미 정확한
        // breadcrumb 을 들고 있으므로 통짜 "인스펙터" 로 뭉개면 안 된다.
        expect(entry.location).toBe(
          action.path ? `인스펙터 › ${action.path}` : "인스펙터",
        );
        expect(action.path, `${action.id} 가 path 를 선언하지 않았다`).toBeDefined();
      }
    },
  );

  it("서브탭·포커스를 실제로 선언하는 행이 존재한다 — 빈 계약이 아니다", () => {
    const rows = CONTEXTS.flatMap(([, context]) =>
      buildStudioSearchIndex(context).entries.filter((entry) =>
        entry.id.startsWith("inspector."),
      ),
    ).map((entry) => entry.target);

    const inspectorTargets = rows.filter(
      (target) => target.type === "inspector",
    );
    expect(
      inspectorTargets.filter(
        (target) => target.type === "inspector" && target.document !== undefined,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      inspectorTargets.filter(
        (target) =>
          target.type === "inspector" && target.focusTarget !== undefined,
      ).length,
    ).toBeGreaterThan(0);
  });

  /**
   * 구획(`kind`)과 breadcrumb(`location`) 은 랭킹과 화면에 그대로 나가는 값이다.
   * `KIND_BONUS` 는 property 4 · panel 3 이고 구획마다 5행 / 전체 12행 상한이
   * 걸려 있어서, 액션의 `kind` 하나가 바뀌면 다른 행이 조용히 잘려 나간다.
   * 그래서 행별 결과를 원장으로 박아 둔다 — 매핑을 바꾸면 코드가 아니라 이
   * 표가 먼저 빨개지고, 무엇이 어느 구획으로 옮겨 가는지 diff 에 남는다.
   *
   * `tool` → `property` 판정 근거: 같은 목적지를 코퍼스가 이미 property 로
   * 적고 있다(`property.layer-mask` 가 `image-mask` 를, `property.levels` ·
   * `property.tone-curve-panel` 이 `image-quick` 과 같은 `image:"quick"` 을).
   * 흡수된 세 행(`layers` · `image-mask` · `brush-studio`)은 코퍼스 행이
   * 대신 서므로 이 표에 없다 — supersedes 가 늘거나 줄어도 여기서 걸린다.
   */
  const INSPECTOR_ROW_LEDGER: Readonly<Record<string, string>> = {
    "brush-engines": "property · 인스펙터 › 대상 › 그리기 › 브러시 엔진",
    canvas: "panel · 인스펙터 › 문서 › 캔버스",
    "canvas-guides": "property · 인스펙터 › 문서 › 캔버스 › 가이드",
    "canvas-resize": "property · 인스펙터 › 문서 › 캔버스 › 크기",
    "canvas-style": "property · 인스펙터 › 문서 › 캔버스 › 스타일",
    "drawing-properties": "property · 인스펙터 › 대상 › 그리기 도구",
    grade: "panel · 인스펙터 › 문서 › 색보정",
    "image-fill": "property · 인스펙터 › 대상 › 이미지 › 채우기·선화",
    "image-quick": "property · 인스펙터 › 대상 › 이미지 › 빠른 수정",
    "image-retouch": "property · 인스펙터 › 대상 › 이미지 › 선택·리터치",
    "image-transform": "property · 인스펙터 › 대상 › 이미지 › 변형",
    navigator: "panel · 인스펙터 › 문서 › 미니맵",
    publish: "panel · 인스펙터 › 게시 준비 › 작품 정보",
    "selection-layout": "property · 인스펙터 › 대상 › 선택 요소 › 배치",
    "selection-order-align": "property · 인스펙터 › 대상 › 선택 요소 › 정렬·순서",
    "selection-properties": "property · 인스펙터 › 대상 › 선택 요소",
    "text-align": "property · 인스펙터 › 대상 › 글자 › 문단",
    "text-fill": "property · 인스펙터 › 대상 › 글자 › 채우기",
    typography: "property · 인스펙터 › 대상 › 글자 › 글꼴",
  };

  it("인스펙터 행별 구획·breadcrumb 이 원장과 정확히 일치한다", () => {
    const observed = new Map<string, string>();
    for (const [, context] of CONTEXTS) {
      for (const entry of buildStudioSearchIndex(context).entries) {
        if (!entry.id.startsWith("inspector.")) continue;
        const actionId = entry.id.slice("inspector.".length);
        const row = `${entry.kind} · ${entry.location}`;
        const previous = observed.get(actionId);
        // 같은 액션이 컨텍스트에 따라 다른 구획으로 가면 그 자체가 결함이다.
        if (previous !== undefined) expect(row).toBe(previous);
        observed.set(actionId, row);
      }
    }

    expect(Object.fromEntries([...observed].sort())).toEqual(
      Object.fromEntries(Object.entries(INSPECTOR_ROW_LEDGER).sort()),
    );
  });

  /**
   * 흡수(`supersedes`)가 빠지면 여기서 걸린다. 공유 색인은 `hasSelection: true`
   * 로 지어져 그리기 전용 액션(`brush-studio`)을 아예 담지 않으므로, 쌍둥이
   * 검사는 컨텍스트를 돌면서 해야 한다.
   */
  it.each(CONTEXTS)(
    "%s — 이름과 목적지가 모두 같은 행이 둘 이상 생기지 않는다",
    (_label, context) => {
      const seen = new Map<string, string[]>();
      for (const entry of buildStudioSearchIndex(context).entries) {
        const key = `${entry.label} ${JSON.stringify(entry.target)}`;
        seen.set(key, [...(seen.get(key) ?? []), entry.id]);
      }
      expect([...seen.values()].filter((group) => group.length > 1)).toEqual([]);
    },
  );

  it("인스펙터 행이 전부 패널로 뭉개지지 않는다", () => {
    const kinds = new Set(
      CONTEXTS.flatMap(([, context]) =>
        buildStudioSearchIndex(context)
          .entries.filter((entry) => entry.id.startsWith("inspector."))
          .map((entry) => entry.kind),
      ),
    );
    expect(kinds.has("property")).toBe(true);
    expect(kinds.has("panel")).toBe(true);
  });
});

/**
 * The right panel renamed itself to "작업 패널", but a production-build probe found the offline
 * "전체" tab returning **zero** rows for both "작업 패널" and the legacy "속성 패널", while the
 * neighbouring "레이어 패널" answered fine. The command catalog did carry a toggle row, but that
 * one only answers in `>` command mode, which needs the remote index; the default tab searches
 * this corpus offline, and the panel itself simply had no entry in it.
 */
describe("작업 패널 is findable by the name on screen", () => {
  const idsFor = (query: string): string[] =>
    searchStudio(query).sections.flatMap((section) =>
      section.results.map((result) => result.entry.id));

  for (const query of ["작업 패널", "속성 패널"]) {
    it(`"${query}" reaches the work panel row`, () => {
      expect(idsFor(query)).toContain("panel.work");
    });
  }

  it("lands on the inspector's 대상 tab", () => {
    const hit = searchStudio("작업 패널").sections
      .flatMap((section) => section.results)
      .find((result) => result.entry.id === "panel.work");
    expect(hit?.entry.label).toBe("작업 패널");
    expect(hit?.entry.target).toMatchObject({ type: "inspector", primary: "properties" });
  });
});
