import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

type ModuleEdges = Readonly<{
  allStaticImports: readonly string[];
  dynamicImports: readonly string[];
  sourceFile: ts.SourceFile;
  valueImports: readonly string[];
}>;

function moduleEdges(relativePath: string): ModuleEdges {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const sourceFile = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const allStaticImports: string[] = [];
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      allStaticImports.push(specifier);
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(bindings && ts.isNamespaceImport(bindings))
          || Boolean(
            bindings
            && ts.isNamedImports(bindings)
            && bindings.elements.some((element) => !element.isTypeOnly)
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(specifier);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) dynamicImports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { allStaticImports, dynamicImports, sourceFile, valueImports };
}

function dynamicImportsInsideVariable(
  sourceFile: ts.SourceFile,
  variableName: string
): readonly string[] {
  const imports: string[] = [];
  let initializer: ts.Expression | null = null;

  function findVariable(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
      && node.initializer
    ) initializer = node.initializer;
    ts.forEachChild(node, findVariable);
  }
  findVariable(sourceFile);
  if (!initializer) return imports;

  function collect(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) imports.push(node.arguments[0].text);
    ts.forEachChild(node, collect);
  }
  collect(initializer);
  return imports;
}

function equalityMatches(
  expression: ts.Expression,
  identifier: string,
  literal: string
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(unwrapped)
    || unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) return false;
  const matches = (left: ts.Expression, right: ts.Expression) => (
    ts.isIdentifier(left)
    && left.text === identifier
    && ts.isStringLiteralLike(right)
    && right.text === literal
  );
  return matches(unwrapped.left, unwrapped.right) || matches(unwrapped.right, unwrapped.left);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function containsJsxTag(node: ts.Node, tagName: string): boolean {
  let found = false;
  function visit(candidate: ts.Node): void {
    if (found) return;
    if (
      (ts.isJsxSelfClosingElement(candidate) || ts.isJsxOpeningElement(candidate))
      && ts.isIdentifier(candidate.tagName)
      && candidate.tagName.text === tagName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  }
  visit(node);
  return found;
}

function referenceDisplayMountGuard(sourceFile: ts.SourceFile): ts.Expression | null {
  let result: ts.Expression | null = null;
  function visit(node: ts.Node): void {
    if (
      result === null
      && ts.isConditionalExpression(node)
      && node.whenFalse.kind === ts.SyntaxKind.NullKeyword
      && containsJsxTag(node.whenTrue, "LazyStudioCompanionReferenceDisplay")
    ) {
      result = node.condition;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return result;
}

function isInactiveWorkspaceSafeReferenceGuard(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(unwrapped)
    || unwrapped.operatorToken.kind !== ts.SyntaxKind.BarBarToken
    || !equalityMatches(unwrapped.left, "effectiveSurface", "reference")
  ) return false;
  const right = unwrapExpression(unwrapped.right);
  if (
    !ts.isBinaryExpression(right)
    || right.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
  ) return false;
  return equalityMatches(right.left, "effectiveSurface", "workspace")
    && equalityMatches(right.right, "mode", "reference");
}

function isRefCurrentAccess(node: ts.Node, refName: string): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node)
    && node.name.text === "current"
    && ts.isIdentifier(node.expression)
    && node.expression.text === refName;
}

function countRefCurrentAccesses(node: ts.Node, refName: string): number {
  let count = 0;
  function visit(candidate: ts.Node): void {
    if (isRefCurrentAccess(candidate, refName)) count += 1;
    ts.forEachChild(candidate, visit);
  }
  visit(node);
  return count;
}

function refCurrentAssignments(sourceFile: ts.SourceFile, refName: string): ts.BinaryExpression[] {
  const assignments: ts.BinaryExpression[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && isRefCurrentAccess(node.left, refName)
    ) assignments.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return assignments;
}

function isInsideHookCall(node: ts.Node, hookName: string): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isCallExpression(current)
      && ts.isIdentifier(current.expression)
      && current.expression.text === hookName
    ) return true;
    current = current.parent;
  }
  return false;
}

function propertyInitializers(sourceFile: ts.SourceFile, name: string): ts.Expression[] {
  const initializers: ts.Expression[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node)
      && (
        (ts.isIdentifier(node.name) && node.name.text === name)
        || (ts.isStringLiteralLike(node.name) && node.name.text === name)
      )
    ) initializers.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return initializers;
}

const CAPTURE_RUNTIME = "@/domains/creator/studio/components/runtime/studio-companion-reference-capture-runtime";
const SOURCE_RUNTIME = "./studio-companion-reference-source-runtime";
const PREVIEW_RUNTIME = "@/src/domains/creator/studio-companion-reference-preview";
const REFERENCE_DISPLAY = "./StudioCompanionReferenceDisplay";

describe("Studio companion Reference runtime boundaries", () => {
  it("keeps the capture coordinator behind one analyzable StudioPage dynamic import", () => {
    const runtime = moduleEdges("./studio-tools-companion-runtime.ts");

    expect(runtime.allStaticImports).not.toContain(CAPTURE_RUNTIME);
    expect(runtime.valueImports).not.toContain(CAPTURE_RUNTIME);
    expect(runtime.dynamicImports.filter((specifier) => specifier === CAPTURE_RUNTIME)).toEqual([
      CAPTURE_RUNTIME,
    ]);
  });

  it("keeps source decoding and preview composition behind coordinator demand imports", () => {
    const coordinator = moduleEdges(
      "../../../components/studio/runtime/studio-companion-reference-capture-runtime.ts"
    );

    for (const specifier of [SOURCE_RUNTIME, PREVIEW_RUNTIME]) {
      expect(
        coordinator.valueImports,
        `${specifier} must remain erased or demand-loaded`
      ).not.toContain(specifier);
      expect(
        coordinator.dynamicImports.filter((candidate) => candidate === specifier),
        `${specifier} must have one literal dynamic-import boundary`
      ).toEqual([specifier]);
    }
  });

  it("keeps transport protocol independent from primary-only source and capture runtimes", () => {
    const protocol = moduleEdges("./studio-tools-companion.ts");
    const forbiddenRuntimeNames = [
      "studio-companion-reference-source-runtime",
      "studio-companion-reference-capture-runtime",
    ];

    for (const runtimeName of forbiddenRuntimeNames) {
      expect(protocol.allStaticImports.some((specifier) => specifier.includes(runtimeName))).toBe(false);
      expect(protocol.dynamicImports.some((specifier) => specifier.includes(runtimeName))).toBe(false);
    }
  });

  it("lazy-loads ReferenceDisplay only inside the dedicated or active workspace Reference panel", () => {
    const companionPage = moduleEdges("./StudioToolsCompanionPage.tsx");
    const guard = referenceDisplayMountGuard(companionPage.sourceFile);

    expect(companionPage.valueImports).not.toContain(REFERENCE_DISPLAY);
    expect(
      dynamicImportsInsideVariable(
        companionPage.sourceFile,
        "LazyStudioCompanionReferenceDisplay"
      )
    ).toEqual([REFERENCE_DISPLAY]);
    expect(guard).not.toBeNull();
    expect(isInactiveWorkspaceSafeReferenceGuard(guard!)).toBe(true);
  });

  it("publishes only one atomically committed Reference snapshot outside React", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    // 984251d8c 가 레퍼런스 보드 state·커밋 경계·가드 세터를 이 런타임 훅으로 옮겼다. 호스트에는
    // 커밋된 스냅샷을 읽기만 하는 컴패니언 투영이 남았다.
    const sidecars = moduleEdges(
      "./studio-cuttoon-editor/runtime/useStudioDocumentSidecarsRuntime.ts"
    );
    const committedRef = "referenceBoardCommittedSnapshotRef";
    const writes = refCurrentAssignments(sidecars.sourceFile, committedRef);

    expect(writes).toHaveLength(1);
    expect(isInsideHookCall(writes[0]!, "useLayoutEffect")).toBe(true);

    const captureSnapshotCallbacks = propertyInitializers(page.sourceFile, "getSnapshot")
      .filter((initializer) => countRefCurrentAccesses(initializer, committedRef) > 0);
    expect(captureSnapshotCallbacks).toHaveLength(1);
    expect(countRefCurrentAccesses(captureSnapshotCallbacks[0]!, committedRef)).toBe(1);

    const bootstrapProjectionCallbacks = propertyInitializers(
      page.sourceFile,
      "getReferenceProjection"
    );
    expect(bootstrapProjectionCallbacks).toHaveLength(1);
    expect(countRefCurrentAccesses(bootstrapProjectionCallbacks[0]!, committedRef)).toBe(1);

    const sidecarsSource = sidecars.sourceFile.getFullText();
    const pageSource = [page.sourceFile.getFullText(), sidecarsSource].join("\n");
    expect(pageSource).not.toContain("referenceBoardRef");
    expect(pageSource).not.toContain("referenceBoardRevisionRef");
    const guardedSetterStart = sidecarsSource.indexOf(
      "function setReferenceBoard(next: StudioReferenceBoardDocument): boolean {"
    );
    const guardedSetterEnd = sidecarsSource.indexOf("const [masterEditMode", guardedSetterStart);
    const guardedSetter = sidecarsSource.slice(guardedSetterStart, guardedSetterEnd);
    expect(guardedSetterStart).toBeGreaterThan(-1);
    expect(guardedSetterEnd).toBeGreaterThan(guardedSetterStart);
    expect(guardedSetter).toContain("referenceBoardLatestRequestedRef.current");
    expect(guardedSetter).not.toContain("referenceBoardCommittedSnapshotRef.current.document");
    expect(guardedSetter.indexOf("referenceBoardLatestRequestedRef.current = normalized")).toBeLessThan(
      guardedSetter.indexOf("setReferenceBoardState(normalized)")
    );
    // One guarded edit path plus the server-hydration raw setter must both converge through the
    // layout-effect commit boundary instead of imperatively publishing pending render state.
    expect(pageSource.match(/setReferenceBoardState\(/gu)?.length).toBeGreaterThanOrEqual(2);

    const coordinator = moduleEdges(
      "../../../components/studio/runtime/studio-companion-reference-capture-runtime.ts"
    ).sourceFile.getFullText();
    expect(coordinator).toContain("getSnapshot(): StudioCompanionReferenceCaptureSnapshot");
    expect(coordinator).not.toContain("getDocument():");
    expect(coordinator).not.toContain("getReferenceRevision():");
    expect(coordinator).not.toContain("getItemCount():");
  });
});
