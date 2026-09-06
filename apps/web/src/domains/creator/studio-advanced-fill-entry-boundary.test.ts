import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const pageUrl = new URL("./StudioCuttoonEditorHost.tsx", import.meta.url);
const source = readFileSync(pageUrl, "utf8");
const advancedFillEffectsSource = readFileSync(
  new URL("./studio-page-advanced-fill.ts", import.meta.url),
  "utf8",
);
const file = ts.createSourceFile(
  pageUrl.pathname,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function nestedFunction(name: string): string {
  let match: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!match) throw new Error(`Missing nested function ${name}`);
  return (match as ts.FunctionDeclaration).getText(file);
}

describe("Studio advanced fill entry boundary", () => {
  it("keeps every existing document, asset, layer, animation, and reference guard in one target policy", () => {
    const targetPolicy = nestedFunction("advancedFillTargetUnsupportedReason");
    const editor = nestedFunction("StudioCuttoonEditor");

    expect(editor).toContain("const advancedFillDocumentUnsupportedReason =");
    expect(editor).toContain("collaborationDocumentLocked");
    expect(editor).toContain("masterEditMode");
    expect(editor).toContain("pageEditLocked");
    expect(targetPolicy).toContain("advancedFillDocumentUnsupportedReason");
    expect(targetPolicy).toContain("studioWorkAssetDestructiveEditReason(target)");
    expect(targetPolicy).toContain("isEffectivelyLocked(target, groups)");
    expect(targetPolicy).toContain("isEffectivelyHidden(target, groups)");
    expect(targetPolicy).toContain("target.isAnimatedGif");
    expect(targetPolicy).toContain("target.frames?.length");
    expect(targetPolicy).toContain("timelinePlaying");
    expect(targetPolicy).toContain("collectOverlappingStudioFillReferenceLayers(");
    expect(targetPolicy).toContain("advancedFillHasVisibleVectorLineArt");
    expect(targetPolicy).toContain('advancedFillSettings.referenceScope === "reference"');
    expect(targetPolicy).toContain('advancedFillSettings.referenceScope === "all-visible"');
  });

  it("delegates raster ambiguity and vector fallback to the canonical non-mutating entry decision", () => {
    const toggle = nestedFunction("toggleAdvancedFill");
    const editor = nestedFunction("StudioCuttoonEditor");

    expect(source).toContain(
      'import { resolveStudioAdvancedFillEntry } from "./studio-advanced-fill-entry";',
    );
    expect(toggle).toContain("resolveStudioAdvancedFillEntry({");
    expect(toggle).toContain("getRasterUnsupportedReason: advancedFillTargetUnsupportedReason");
    expect(toggle).toContain("vectorInput: currentAdvancedFillVectorInput()");
    expect(toggle).toContain('entry.mode === "auto-select-raster"');
    expect(toggle).toContain('entry.mode === "ambiguous-raster"');
    expect(toggle).toContain('entry.mode === "virtual-vector-fill"');
    expect(toggle).toContain('entry.mode === "unavailable"');
    expect(toggle).toContain("setMarqueeIds([])");
    expect(toggle).toContain("setSelectedId(target.id)");
    expect(toggle).toContain("advancedFillAutoArmTargetRef.current = { targetId: target.id, status: readyStatus }");
    // 자동 무장 토큰의 1회 소비·재생은 studio-page-advanced-fill 훅의 리셋 effect 로 추출됐다.
    expect(advancedFillEffectsSource).toContain(
      "const pendingAutoArm = takeStudioAdvancedFillAutoArmTarget(advancedFillAutoArmTargetRef)",
    );
    expect(advancedFillEffectsSource).toContain("const pendingAutoArm = ref.current");
    expect(advancedFillEffectsSource).toContain("if (pendingAutoArm?.targetId === selectedId)");
    expect(advancedFillEffectsSource).toContain("setAdvancedFillVirtualTarget(pendingAutoArm.virtualTarget)");
    expect(advancedFillEffectsSource).toContain("setAdvancedFillStatus(pendingAutoArm.status)");
    expect(toggle).toContain("virtualTarget: entry.target");
    expect(toggle).toContain('selectInspectorRoute({ primary: "properties", image: "fill" }');
    expect(toggle).not.toContain(
      'openInspectorRoute({ primary: "properties", image: "fill" }, null)',
    );
    expect(toggle).toContain("setAdvancedFillActive(true)");
    expect(toggle).toContain("레이어에서 하나를 선택한 뒤 채우기를 다시 누르세요");
    expect(toggle).toContain("flushPendingStrokeCommitsRef.current()");
    expect(toggle).toContain("setAdvancedFillVirtualTarget(entry.target)");
    expect(toggle).toContain("적용 전까지 문서는 바뀌지 않습니다");
    expect(toggle).not.toContain("rasterLayers.length === 0");
    expect(toggle).not.toContain("planStudioAdvancedFillVectorTarget(");
    expect(toggle).not.toContain("현재 페이지에 채울 래스터 이미지가 없어요");
    expect(toggle).not.toContain("setPages(");
    expect(toggle).not.toContain("commit(");
    expect(editor).toContain("const advancedFillEligibleRasterElements = elements.filter(");
    expect(editor).toContain("advancedFillEligibleRasterElements.length === 1");
    expect(editor).toContain("advancedFillHasVisibleVectorLineArt");
    expect(editor).not.toContain(
      "advancedFillRasterLayers.length === 0 && advancedFillHasVisibleVectorLineArt",
    );
  });

  it("routes the quick action through the same toggle and never pre-disables fill", () => {
    const quickAction = nestedFunction("executeQuickAction");
    const disabledStart = source.indexOf("const quickActionsDisabledActions = useMemo");
    const disabledEnd = source.indexOf("// 모바일 한 손 모드", disabledStart);
    const disabledPolicy = source.slice(disabledStart, disabledEnd);

    expect(quickAction).toContain('action !== "advanced-fill"');
    expect(quickAction).toContain('else if (action === "advanced-fill") toggleAdvancedFill()');
    expect(disabledPolicy).not.toContain('disabled.add("advanced-fill")');
  });

  // 래스터 대상에서 벡터 선화 참조는 래스터 경계 위에 얹는 추가 경계다. 예전에는 이 참조를
  // 정확히 만들지 못하면 채우기 전체를 던져 — 페이지 어딘가의 지우개 획 하나가 무관한 래스터
  // 레이어 채우기까지 막고 "먼저 레이어를 병합해 주세요" 배너를 띄웠다.
  it("drops the optional vector line-art reference instead of aborting a raster fill", () => {
    const run = nestedFunction("runAdvancedFillAt");

    expect(source).toContain("describeStudioAdvancedFillVectorReferenceExclusion,");
    expect(run).toContain(
      "vectorReferenceExclusion = describeStudioAdvancedFillVectorReferenceExclusion(vectorPlan)",
    );
    // 실패 코드를 골라 살려두던 게이트는 남아 있으면 안 된다.
    expect(run).not.toContain('vectorPlan.code !== "no-visible-vector-draw"');
    // 계획 실패로 던지는 자리는 벡터 대상 경로 한 곳뿐이어야 한다.
    expect(run.match(/throw new Error\(vectorPlan\.reason\)/g)).toHaveLength(1);
    // 제외 사실은 결과 문구에 실려 상태줄로 나간다 — 미리보기 문구에도 같이 남아야
    // 적용을 누르기 직전까지 무엇이 빠진 경계인지 보인다.
    expect(run).toContain("const previewMessage = withVectorExclusionNotice(previewSummary.message)");
    expect(run).toContain("message: previewMessage,");
    expect(run).toContain("setAdvancedFillStatus(previewMessage)");
    // 벡터 대상 경로에서는 참조가 경계 그 자체라 예전처럼 실패해야 한다.
    expect(run).toContain("if (!vectorPlan.ok) throw new Error(vectorPlan.reason);");
  });

  // 선화를 빼면 참조가 0이 되는 페이지(대상 래스터 하나 + 선화)가 흔하다. 참조 범위는 대상
  // 자신을 늘 제외하므로, 이때 합성기를 부르면 "참조할 표시 래스터 레이어가 없습니다"로 던져
  // 채우기가 그대로 멈추고 제외 사유는 catch 로 사라진다 — 축소 계약이 무너지는 구멍이었다.
  it("falls back to the target boundary instead of composing an empty reference set", () => {
    const run = nestedFunction("runAdvancedFillAt");

    expect(run).toContain(
      "if (pageReferences.length === 0 && scopedRasterReferences.length === 0) {",
    );
    expect(run).toContain("referenceSrc = undefined;");
    expect(run).toContain("참조로 남은 레이어가 없어 대상 레이어만 경계로 사용했어요.");
    // 사유가 이미 있으면 덮어쓰지 말고 이어 붙여야 두 사실이 모두 남는다.
    expect(run).toContain("vectorReferenceExclusion === null");
    // 합성은 참조가 실제로 있을 때만 — 빈 집합으로 부르는 경로가 남으면 안 된다.
    expect(run).toMatch(
      /scopedRasterReferences\.length === 0\)[\s\S]*?\} else \{[\s\S]*?composeStudioFillReferenceImageWithPageReferences\(/,
    );
  });

  it("projects linked pass references through bounded verified leases before browser composition", () => {
    const editor = nestedFunction("StudioCuttoonEditor");

    expect(source).toContain('"./render/studio-raster-source-projection"');
    expect(editor).toContain("withStudioRasterSourceProjection({");
    expect(editor).toContain('consumer: "studio-advanced-fill-reference"');
    expect(editor).toContain("collectOverlappingStudioFillReferenceLayers(");
    expect(editor).toContain("projectedById.get(layer.id) ?? layer");
  });

  // 래스터 대상에서 벡터 선화 참조는 래스터 경계 위에 얹는 추가 경계다. 예전에는 이 참조를
  // 정확히 만들지 못하면 채우기 전체를 던져 — 페이지 어딘가의 지우개 획 하나가 무관한 래스터
  // 레이어 채우기까지 막고 "먼저 레이어를 병합해 주세요" 배너를 띄웠다.
  it("drops the optional vector line-art reference instead of aborting a raster fill", () => {
    const run = nestedFunction("runAdvancedFillAt");

    expect(source).toContain("describeStudioAdvancedFillVectorReferenceExclusion,");
    expect(run).toContain(
      "vectorReferenceExclusion = describeStudioAdvancedFillVectorReferenceExclusion(vectorPlan)",
    );
    // 실패 코드를 골라 살려두던 게이트는 남아 있으면 안 된다.
    expect(run).not.toContain('vectorPlan.code !== "no-visible-vector-draw"');
    // 계획 실패로 던지는 자리는 벡터 대상 경로 한 곳뿐이어야 한다.
    expect(run.match(/throw new Error\(vectorPlan\.reason\)/g)).toHaveLength(1);
    // 제외 사실은 결과 문구에 실려 상태줄로 나간다 — 미리보기 문구에도 같이 남아야
    // 적용을 누르기 직전까지 무엇이 빠진 경계인지 보인다.
    expect(run).toContain("const previewMessage = withVectorExclusionNotice(previewSummary.message)");
    expect(run).toContain("message: previewMessage,");
    expect(run).toContain("setAdvancedFillStatus(previewMessage)");
    // 벡터 대상 경로에서는 참조가 경계 그 자체라 예전처럼 실패해야 한다.
    expect(run).toContain("if (!vectorPlan.ok) throw new Error(vectorPlan.reason);");
  });

  // 선화를 빼면 참조가 0이 되는 페이지(대상 래스터 하나 + 선화)가 흔하다. 참조 범위는 대상
  // 자신을 늘 제외하므로, 이때 합성기를 부르면 "참조할 표시 래스터 레이어가 없습니다"로 던져
  // 채우기가 그대로 멈추고 제외 사유는 catch 로 사라진다 — 축소 계약이 무너지는 구멍이었다.
  it("falls back to the target boundary instead of composing an empty reference set", () => {
    const run = nestedFunction("runAdvancedFillAt");

    expect(run).toContain(
      "if (pageReferences.length === 0 && scopedRasterReferences.length === 0) {",
    );
    expect(run).toContain("referenceSrc = undefined;");
    expect(run).toContain("참조로 남은 레이어가 없어 대상 레이어만 경계로 사용했어요.");
    // 사유가 이미 있으면 덮어쓰지 말고 이어 붙여야 두 사실이 모두 남는다.
    expect(run).toContain("vectorReferenceExclusion === null");
    // 합성은 참조가 실제로 있을 때만 — 빈 집합으로 부르는 경로가 남으면 안 된다.
    expect(run).toMatch(
      /scopedRasterReferences\.length === 0\)[\s\S]*?\} else \{[\s\S]*?composeStudioFillReferenceImageWithPageReferences\(/,
    );
  });
});
