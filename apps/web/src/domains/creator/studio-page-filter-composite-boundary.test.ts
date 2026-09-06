import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { STUDIO_FILTER_MENU_KINDS } from "./filter/studio-filter-menu";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageUrl = new URL("./StudioCuttoonEditorHost.tsx", import.meta.url);
const editorViewUrl = new URL("./studio-cuttoon-editor/StudioCuttoonEditorView.tsx", import.meta.url);
const sessionDialogsUrl = new URL(
  "./studio-cuttoon-editor/StudioCuttoonEditorSessionDialogs.tsx",
  import.meta.url,
);
const pageSource = readStudioCuttoonEditorSource();
const rawPageSource = readFileSync(pageUrl, "utf8");
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
const editorViewSource = readFileSync(editorViewUrl, "utf8");
const sessionDialogsSource = readFileSync(sessionDialogsUrl, "utf8");
const pageFile = ts.createSourceFile(
  pageUrl.pathname,
  rawPageSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const editorViewFile = ts.createSourceFile(
  editorViewUrl.pathname,
  editorViewSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const sessionDialogsFile = ts.createSourceFile(
  sessionDialogsUrl.pathname,
  sessionDialogsSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function nestedFunction(name: string): ts.FunctionDeclaration {
  let match: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(pageFile);
  if (!match) throw new Error(`Missing nested function ${name}`);
  return match;
}

function variableInitializer(name: string): ts.Expression {
  let match: ts.Expression | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) {
      match = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(pageFile);
  if (!match) throw new Error(`Missing variable initializer ${name}`);
  return match;
}

function nestedVariableInitializer(functionName: string, variableName: string): ts.Expression {
  const fn = nestedFunction(functionName);
  let match: ts.Expression | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
      && node.initializer
    ) {
      match = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  if (fn.body) visit(fn.body);
  if (!match) throw new Error(`Missing ${functionName}.${variableName} initializer`);
  return match;
}

function jsxCallback(tagName: string, attributeName: string): { expression: ts.Expression; sourceFile: ts.SourceFile } {
  let match: { expression: ts.Expression; sourceFile: ts.SourceFile } | null = null;
  function visit(node: ts.Node, sourceFile: ts.SourceFile): void {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
      && node.tagName.getText(sourceFile) === tagName
    ) {
      const attribute = node.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && property.name.getText(sourceFile) === attributeName,
      );
      const expression = attribute?.initializer
        && ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : null;
      if (expression) {
        match = { expression, sourceFile };
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, sourceFile));
  }
  visit(pageFile, pageFile);
  if (!match) visit(editorViewFile, editorViewFile);
  if (!match) visit(sessionDialogsFile, sessionDialogsFile);
  if (!match) throw new Error(`Missing ${tagName}.${attributeName} JSX callback`);
  return match;
}

function sourceBetween(startToken: string, endToken: string): string {
  const start = pageSource.indexOf(startToken);
  const end = pageSource.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing source boundary: ${startToken} -> ${endToken}`);
  }
  return pageSource.slice(start, end);
}

function viewportSourceBetween(startToken: string, endToken: string): string {
  const start = viewportSource.indexOf(startToken);
  const end = viewportSource.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing viewport source boundary: ${startToken} -> ${endToken}`);
  }
  return viewportSource.slice(start, end);
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function topLevelOrOperands(expression: ts.Expression): ts.Expression[] {
  const current = unwrapParentheses(expression);
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return [
      ...topLevelOrOperands(current.left),
      ...topLevelOrOperands(current.right),
    ];
  }
  return [current];
}

describe("StudioPage page-composite filter integration boundary", () => {
  it("routes all cleanup filters through the same image-free page-composite session as every dialog filter", () => {
    const open = nestedFunction("openStudioFilter").getText(pageFile);

    const cleanupKinds = [
      "line-cleanup",
      "screentone-removal",
      "jpeg-artifact-reduction",
      "edge-aware-denoise",
      "lens-blur",
      "field-iris-blur",
      "tilt-shift-blur",
      "selective-gaussian-blur",
      "tileable-blur",
      "dust-scratches",
      "difference-of-gaussians",
      "color-to-alpha",
    ] as const;
    expect(STUDIO_FILTER_MENU_KINDS).toEqual(expect.arrayContaining([...cleanupKinds]));
    expect(open).toContain('target: "page-composite"');
    expect(open).toContain("kind,");
    for (const kind of cleanupKinds) {
      expect(open).not.toContain(`kind !== "${kind}"`);
      expect(open).not.toContain(`kind === "${kind}"`);
    }
  });

  it("does not require an image selection to enable the filter menu", () => {
    const initializer = variableInitializer("menuFilterDisabled");
    const operands = topLevelOrOperands(initializer).map((operand) => operand.getText(pageFile));
    const unavailableReason = variableInitializer("studioFilterUnavailableReason").getText(pageFile);

    expect(operands).toContain("studioFilterPreparationBusy");
    expect(operands).toContain("studioFilterUnavailableReason !== null");
    expect(unavailableReason).toContain('masterEditMode && selected?.type !== "image"');
    expect(initializer.getText(pageFile)).not.toMatch(
      /(?:^|\|\|)\s*selected\?\.type\s*!==\s*"image"\s*(?:\|\||$)/u,
    );
  });

  it("flushes pending ink before an abortable lazy raster plan and rejects stale results", () => {
    const open = nestedFunction("openStudioFilter");
    const text = open.getText(pageFile);
    const dynamicImports: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node)
        && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1
        && ts.isStringLiteral(node.arguments[0])
      ) {
        dynamicImports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(open);

    expect(dynamicImports).toEqual(["./render/studio-raster-edit-preparation"]);
    expect(text).toContain(
      'prepareStudioDocumentReplacement("필터 미리보기를 준비", { flushPending: true })',
    );
    expect(text.indexOf("flushPending: true")).toBeLessThan(
      text.indexOf("const mutationTicket = captureStudioMutationTicket()"),
    );
    expect(text).toContain("const historyIndex = pagesHiRef.current");
    expect(text).toContain("const pageId = currentPageIdRef.current");
    expect(text).toContain("const controller = new AbortController()");
    expect(text).toContain('rasterExecutionBackend: "offscreen-worker"');
    expect(text).toContain("signal: controller.signal");
    expect(text).toContain("pagesHiRef.current !== historyIndex");
    expect(text).toContain("currentPageIdRef.current !== pageId");
    expect(text).toContain("!canApplyStudioMutation(mutationTicket)");
    expect(text.indexOf("await rasterRuntime.renderStudioEditableRasterCopy")).toBeLessThan(
      text.indexOf("pagesHiRef.current !== historyIndex"),
    );
  });

  it("forwards filter purpose plus live collaboration and visibility guards to the shared page context", () => {
    const sharedContext = nestedFunction("currentStudioEditablePageRasterContext")
      .getText(pageFile);
    const filterContext = nestedFunction("currentStudioFilterPageRasterContext")
      .getText(pageFile);

    expect(sharedContext).toContain("rasterRuntime.createStudioEditablePageRasterContext({");
    expect(sharedContext).toContain("localHiddenElementIds: localHiddenElementIdsRef.current");
    expect(sharedContext).toContain("sharedDocument: sharedDocumentRef.current !== null");
    expect(sharedContext).toContain("collaborationLockedReason: collaborationAccessRef.current.locked");
    expect(sharedContext).toContain("masterEditMode: masterEditModeRef.current");
    expect(sharedContext).toContain("timelinePlaying: timelinePlayingRef.current");
    expect(sharedContext).toContain("viewTransformSuppressed: viewTransformSuppressedRef.current");
    expect(sharedContext).toContain("purpose,");
    expect(filterContext).toContain(
      'currentStudioEditablePageRasterContext(name, rasterRuntime, "page-filter")',
    );
  });

  it("keeps the direct selected-image filter path ahead of page-composite guards", () => {
    const open = nestedFunction("openStudioFilter");
    const directImageTarget = nestedVariableInitializer("openStudioFilter", "directImageTarget");
    let directBranch: ts.IfStatement | null = null;
    function visit(node: ts.Node): void {
      if (
        !directBranch
        && ts.isIfStatement(node)
        && node.expression.getText(pageFile) === "directImageTarget"
      ) {
        directBranch = node;
        return;
      }
      ts.forEachChild(node, visit);
    }
    if (open.body) visit(open.body);

    expect(directImageTarget.getText(pageFile)).toContain('selected?.type === "image"');
    expect(directImageTarget.getText(pageFile)).not.toMatch(
      /sharedDocumentRef|localHiddenElementIdsRef|localHiddenIds/u,
    );
    const matchedDirectBranch = directBranch as ts.IfStatement | null;
    expect(matchedDirectBranch).not.toBeNull();
    const directBranchText = matchedDirectBranch?.getText(pageFile) ?? "";
    expect(directBranchText).toMatch(/target\s*:\s*["']image["']/u);
    expect(directBranchText).toMatch(/\breturn\s*;/u);
    expect(directBranchText).not.toContain("currentStudioFilterPageRasterContext");
    expect(matchedDirectBranch?.getStart(pageFile)).toBeLessThan(
      open.getText(pageFile).includes("currentStudioFilterPageRasterContext")
        ? open.getStart(pageFile) + open.getText(pageFile).indexOf("currentStudioFilterPageRasterContext")
        : Number.POSITIVE_INFINITY,
    );
  });

  it("projects the composite as a locked virtual ImageEl without mutating authored arrays", () => {
    const projection = viewportSourceBetween(
      "const canvasRenderElements: El[] = studioFilterPreview",
      "const virtualFillPreviewTarget =",
    );

    expect(projection).toContain("const canvasRenderElements: El[] = studioFilterPreview");
    expect(projection).toContain(": [...studioLiveGesturePreviewRenderPlan.elements]");
    expect(projection).toContain("if (studioFilterPageComposite)");
    expect(projection).toContain("studioFilterPreview?.elementId === studioFilterPageComposite.id");
    expect(projection).toContain("canvasRenderElements.push({");
    expect(projection).toContain("...previewComposite");
    expect(projection).toContain("locked: true");
    expect(projection).toContain("noClip: true");
    expect(projection).not.toMatch(/authoredCanvasRenderElements\.(?:push|splice|pop|shift|unshift)\(/u);
    expect(projection).not.toMatch(/\belements\.(?:push|splice|pop|shift|unshift)\(/u);
  });

  it("applies one editable raster copy into destination elements with one history commit", () => {
    const applyCallback = jsxCallback("StudioFilterDialog", "onApply");
    const apply = applyCallback.expression.getText(applyCallback.sourceFile);

    expect(apply).toContain('if (studioFilterSession.target === "image")');
    expect(apply).toMatch(/import\(["'].*render\/studio-raster-edit-preparation["']\)/);
    expect(apply).toContain("rasterRuntime.applyStudioEditableRasterCopy({");
    expect(apply).toContain("destinationElements: currentContext.destinationElements");
    expect(apply).toContain("const composite = {");
    expect(apply).toContain("...studioFilterSession.image");
    expect(apply).toContain("...patch");
    expect(apply.match(/\bcommit\(/gu)).toHaveLength(1);
    expect(apply).toContain(
      "commit(applied.elements, undefined, studioFilterSession.pageId)",
    );
  });

  it("invalidates cancel and stale sessions without committing a virtual preview", () => {
    const close = nestedFunction("closeStudioFilterDialog").getText(pageFile);
    const applyCallback = jsxCallback("StudioFilterDialog", "onApply");
    const apply = applyCallback.expression.getText(applyCallback.sourceFile);
    const staleSessionEffect = sourceBetween(
      "useEffect(() => {\n    if (!studioFilterSession) return;",
      "const selectedWorkAssetDestructiveEditReason =",
    );

    expect(close).toContain("studioFilterSessionIdRef.current += 1");
    expect(close).toContain("studioFilterPreparationRunIdRef.current += 1");
    expect(close).toContain("studioFilterPreparationAbortRef.current?.abort()");
    expect(close).toContain("setStudioFilterSession(null)");
    expect(close).toContain("setStudioFilterPreview(null)");
    expect(close).not.toContain("commit(");
    expect(apply.match(/studioFilterSession\.historyIndex !== pagesHiRef\.current/gu)).toHaveLength(2);
    expect(apply.match(/!canApplyStudioMutation\(studioFilterSession\.mutationTicket\)/gu)).toHaveLength(2);
    expect(apply).toContain("closeStudioFilterDialog()");
    expect(staleSessionEffect).toContain("if (studioFilterDialogImage?.type === \"image\") return");
    expect(staleSessionEffect).toContain("studioFilterSessionIdRef.current += 1");
    expect(staleSessionEffect).toContain("studioFilterPreparationRunIdRef.current += 1");
    expect(staleSessionEffect).toContain("studioFilterPreparationAbortRef.current?.abort()");
    expect(staleSessionEffect).toContain("studioFilterApplyBusyRef.current = false");
    expect(staleSessionEffect).toContain("setStudioFilterPreparationBusy(false)");
    expect(staleSessionEffect).toContain("setStudioFilterApplying(false)");
    expect(staleSessionEffect).toContain("setStudioFilterSession(null)");
    expect(staleSessionEffect).toContain("setStudioFilterPreview(null)");
  });

  it("connects page-composite target semantics to the dialog and mobile filter surface", () => {
    const sessionState = sourceBetween(
      "const [studioFilterSession, setStudioFilterSession] = useState<",
      "const [studioFilterPreview, setStudioFilterPreview] =",
    );
    const dialog = sourceBetween(
      "<StudioFilterDialog",
      "</Suspense>\n      ) : null}",
    );
    const mobileDock = sourceBetween(
      "<StudioMobileEditingDock",
      "ui={STUDIO_MOBILE_EDITING_DOCK_UI}",
    );
    const mobileHandlers = sourceBetween(
      "const studioMobileEditingDockHandlers =",
      "const studioPageListPaneHandlers =",
    );

    expect(sessionState).toContain('target: "page-composite"');
    expect(sessionState).toContain("image: ImageEl & El");
    expect(dialog).toContain("targetKind={studioFilterSession.target}");
    expect(dialog).toContain("onClose={closeStudioFilterDialog}");
    expect(mobileDock).toContain("filterMutationLocked={menuFilterDisabled}");
    expect(mobileDock).toContain("filterPreparationBusy={studioFilterPreparationBusy}");
    expect(mobileDock).toContain("filterTargetLabel={studioFilterTargetLabel}");
    expect(mobileHandlers).toContain("openStudioFilter");
  });
});
