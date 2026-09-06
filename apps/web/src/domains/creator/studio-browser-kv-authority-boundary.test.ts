import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

type FindingKind =
  | "durable-storage-write"
  | "indexeddb-cleanup"
  | "indexeddb-open"
  | "indexeddb-wrapper"
  | "indexeddb-write"
  | "local-storage-cleanup"
  | "local-storage-write";

interface BrowserKvFinding {
  readonly file: string;
  readonly kind: FindingKind;
  readonly key: string;
  readonly line: number;
  readonly call: string;
}

interface BrowserKvAllowance {
  readonly file: string;
  readonly kind: FindingKind;
  readonly key: string;
  readonly occurrences: number;
  readonly rationale: string;
  readonly proof: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, "../../../../../");
const CREATOR_ROOT = resolve(WORKSPACE_ROOT, "apps/web/src/domains/creator");
const PACKAGE_ROOT = resolve(WORKSPACE_ROOT, "packages");
const PAGES_HISTORY_DURABLE_RUNTIME_SOURCE = readFileSync(
  resolve(CREATOR_ROOT, "studio-pages-history-durable-runtime.ts"),
  "utf8",
);
const COMPANION_PAGE_SOURCE = readFileSync(
  resolve(CREATOR_ROOT, "StudioToolsCompanionPage.tsx"),
  "utf8",
);
const COMPANION_LAYOUT_HOOK_SOURCE = readFileSync(
  resolve(CREATOR_ROOT, "use-studio-companion-window-layout.ts"),
  "utf8",
);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "__fixtures__",
  "__tests__",
  "fixtures",
  "generated",
  "testing",
]);
const TEST_FILE_PATTERN = /(?:\.boundary)?\.(?:spec|test)\.[cm]?[jt]sx?$/u;
const DURABLE_AUTHORITY_PATTERN =
  /(?:asset|autosave|bible|brand|brush|calibration|catalog|checkpoint|clip|collab|crdt|document|effect|filter|font|journal|library|mannequin|marketplace|outbox|pack|palette|pose|preset|project|recovery|scene|snapshot|texture|timeline|translation|workspace)/iu;
const BROWSER_KV_LEXICAL_SURFACE_PATTERN =
  /\b(?:Dexie|IDBDatabase|IDBFactory|IDBObjectStore|indexedDB|localStorage|openDB|removeItem|sessionStorage|setItem)\b|["'](?:dexie|idb|idb-keyval)["']/u;

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

function compact(value: string): string {
  return value.replace(/\s+/gu, "");
}

function sourceExtension(file: string): string {
  const match = file.match(/(\.[^.]+)$/u);
  return match?.[1] ?? "";
}

function isProductSourceFile(file: string): boolean {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return SOURCE_EXTENSIONS.has(sourceExtension(name))
    && !name.endsWith(".d.ts")
    && !TEST_FILE_PATTERN.test(name)
    && !name.includes(".stories.");
}

function mayContainBrowserKvAuthority(source: string): boolean {
  // Every finding produced below requires at least one of these exact language/library surfaces.
  // This conservative prefilter only avoids building a TypeScript AST for provably inert files;
  // it does not narrow the repository roots, allowance checks, or finding rules.
  // A backslash may encode an identifier or string-literal escape that TypeScript normalises to
  // one of those surfaces (for example `set\u0049tem`), so those files always reach the AST gate.
  return source.includes("\\") || BROWSER_KV_LEXICAL_SURFACE_PATTERN.test(source);
}

function walkProductSources(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry)) continue;
      const absolute = resolve(directory, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) visit(absolute);
      else if (stats.isFile() && isProductSourceFile(slash(absolute))) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function studioSourceRoots(): readonly string[] {
  const packageSources = existsSync(PACKAGE_ROOT)
    ? readdirSync(PACKAGE_ROOT)
      .filter((name) => name.startsWith("studio-"))
      .map((name) => resolve(PACKAGE_ROOT, name, "src"))
      .filter(existsSync)
      .sort()
    : [];
  return Object.freeze([CREATOR_ROOT, ...packageSources]);
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".mts")) return ts.ScriptKind.TS;
  if (file.endsWith(".cts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.TS;
}

function receiverAndMethod(
  expression: ts.LeftHandSideExpression,
  sourceFile: ts.SourceFile,
): { readonly receiver: string; readonly method: string } | null {
  if (ts.isPropertyAccessExpression(expression)) {
    return {
      receiver: compact(expression.expression.getText(sourceFile)),
      method: expression.name.text,
    };
  }
  if (
    ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return {
      receiver: compact(expression.expression.getText(sourceFile)),
      method: expression.argumentExpression.text,
    };
  }
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

type BrowserStorageName = "localStorage" | "sessionStorage";

function isDirectBrowserStorageReference(
  receiver: string,
  storageName: BrowserStorageName,
): boolean {
  return receiver === storageName
    || receiver === `globalThis.${storageName}`
    || receiver === `window.${storageName}`;
}

function collectBrowserStorageAliases(
  sourceFile: ts.SourceFile,
  storageName: BrowserStorageName,
): ReadonlySet<string> {
  const aliases = new Set<string>([storageName]);
  const visit = (node: ts.Node): void => {
    const initializer = ts.isVariableDeclaration(node) && node.initializer
      ? compact(unwrapExpression(node.initializer).getText(sourceFile))
      : null;
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && initializer !== null
      && isDirectBrowserStorageReference(initializer, storageName)
    ) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function collectInitializerText(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const candidates = new Map<string, Set<string>>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const values = candidates.get(node.name.text) ?? new Set<string>();
      values.add(compact(unwrapExpression(node.initializer).getText(sourceFile)));
      candidates.set(node.name.text, values);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return new Map([...candidates]
    .filter(([, values]) => values.size === 1)
    .map(([name, values]) => [name, [...values][0]!] as const));
}

function resolvedKeyText(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  initializers: ReadonlyMap<string, string>,
): string {
  if (!expression) return "<none>";
  const unwrapped = unwrapExpression(expression);
  const direct = compact(unwrapped.getText(sourceFile));
  if (!ts.isIdentifier(unwrapped)) return direct;
  const initializer = initializers.get(unwrapped.text);
  if (!initializer) return direct;
  return /^[A-Z][A-Z0-9_]*$/u.test(unwrapped.text)
    || /^["'`]/u.test(initializer)
    || DURABLE_AUTHORITY_PATTERN.test(initializer)
    ? initializer
    : direct;
}

function isDirectBrowserStorageReceiver(
  receiver: string,
  storageName: BrowserStorageName,
  aliases: ReadonlySet<string>,
): boolean {
  return isDirectBrowserStorageReference(receiver, storageName) || aliases.has(receiver);
}

function isIndexedDbFactoryReceiver(receiver: string, source: string): boolean {
  if (/^(?:(?:globalThis|window)\.)?indexedDB$/u.test(receiver)) return true;
  if (!/\b(?:IDBFactory|IDBDatabase|indexedDB)\b/u.test(source)) return false;
  return /(?:factory|indexedDB|indexedDb)$/u.test(receiver);
}

function finding(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  kind: FindingKind,
  key: string,
): BrowserKvFinding {
  return Object.freeze({
    file,
    kind,
    key,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    call: compact(node.getText(sourceFile)),
  });
}

/**
 * Static-only authority detector. It deliberately does not execute imported product code.
 * The exported shape is kept inside this test module so fixture cases exercise the exact scanner
 * used for the repository gate.
 */
function analyzeBrowserKvSource(file: string, source: string): readonly BrowserKvFinding[] {
  if (!mayContainBrowserKvAuthority(source)) return Object.freeze([]);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const localStorageAliases = collectBrowserStorageAliases(sourceFile, "localStorage");
  const sessionStorageAliases = collectBrowserStorageAliases(sourceFile, "sessionStorage");
  const initializers = collectInitializerText(sourceFile);
  const findings: BrowserKvFinding[] = [];
  const compactSource = compact(source);
  const wrapperModule =
    /(?:from|import\()["'](?:dexie|idb|idb-keyval)["']/u.test(compactSource);

  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node)
      && (compact(node.expression.getText(sourceFile)) === "Dexie" || wrapperModule)
    ) {
      findings.push(finding(file, sourceFile, node, "indexeddb-wrapper", "Dexie"));
    }
    if (ts.isCallExpression(node)) {
      const call = receiverAndMethod(node.expression, sourceFile);
      const firstArgument = node.arguments[0];
      const key = resolvedKeyText(firstArgument, sourceFile, initializers);
      if (call?.method === "setItem") {
        if (isDirectBrowserStorageReceiver(call.receiver, "localStorage", localStorageAliases)) {
          findings.push(finding(file, sourceFile, node, "local-storage-write", key));
        } else if (
          !isDirectBrowserStorageReceiver(
            call.receiver,
            "sessionStorage",
            sessionStorageAliases,
          )
          && DURABLE_AUTHORITY_PATTERN.test(`${file}:${key}:${call.receiver}`)
        ) {
          // Unknown/injected Storage-like receivers remain reviewable. Explicit sessionStorage is
          // tab-scoped and cannot become durable authority, even when its key describes a pose.
          findings.push(finding(file, sourceFile, node, "durable-storage-write", key));
        }
      } else if (
        call?.method === "removeItem"
        && isDirectBrowserStorageReceiver(call.receiver, "localStorage", localStorageAliases)
      ) {
        findings.push(finding(file, sourceFile, node, "local-storage-cleanup", key));
      } else if (call?.method === "open" && isIndexedDbFactoryReceiver(call.receiver, source)) {
        findings.push(finding(file, sourceFile, node, "indexeddb-open", key));
      } else if (
        call
        && /^(?:add|put)$/u.test(call.method)
        && (wrapperModule || /\b(?:IDBDatabase|IDBObjectStore|indexedDB)\b/u.test(source))
        && /(?:db|store|table|transaction)/iu.test(call.receiver)
      ) {
        findings.push(finding(file, sourceFile, node, "indexeddb-write", call.method));
      } else if (
        call?.method === "delete"
        && (wrapperModule || /\b(?:IDBDatabase|IDBObjectStore|indexedDB)\b/u.test(source))
        && /(?:db|store|table|transaction)/iu.test(call.receiver)
      ) {
        findings.push(finding(file, sourceFile, node, "indexeddb-cleanup", "delete"));
      } else if (
        wrapperModule
        && (compact(node.expression.getText(sourceFile)) === "openDB" || call?.method === "openDB")
      ) {
        findings.push(finding(file, sourceFile, node, "indexeddb-wrapper", key));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return Object.freeze(findings);
}

function analyzeWorkspace(): readonly BrowserKvFinding[] {
  return Object.freeze(studioSourceRoots().flatMap((root) =>
    walkProductSources(root).flatMap((absolute) => {
      const file = slash(relative(WORKSPACE_ROOT, absolute));
      return analyzeBrowserKvSource(file, readFileSync(absolute, "utf8"));
    })));
}

function allow(
  file: string,
  kind: FindingKind,
  key: string,
  occurrences: number,
  rationale: string,
  proof: string,
): BrowserKvAllowance {
  return Object.freeze({ file, kind, key, occurrences, rationale, proof });
}

const UI_ONLY =
  "UI preference, acknowledgement, tutorial, consent, recent-item, or clipboard state only; it is not project or creative-data authority.";
const UI_PROOF =
  "The exact key/call is bounded to presentation or session transfer and is not read by a SQLite/OPFS creative repository.";
const CLEANUP_ONLY =
  "Deletion-only compatibility cleanup; remove/delete cannot establish or refresh browser-KV authority.";
const CLEANUP_PROOF =
  "The allowance is limited to the exact cleanup method and occurrence count; any set/put call is a different finding kind.";
const INJECTED_COMPATIBILITY =
  "Injected storage compatibility codec or explicit legacy adapter; the product authority is separately wired to SQLite/OPFS and never silently selects this call.";
const INJECTED_PROOF =
  "The exact call is retained for tests, explicit import, or compatibility parsing; ambient product boot is guarded by existing V12 boundary tests.";
const LEGACY_IDB =
  "Explicit pre-V12 IndexedDB import/test or observable emergency rollback seam; SQLite/OPFS remains the product-default authority.";
const LEGACY_IDB_PROOF =
  "The legacy database name and exact operation count are pinned here; adding an open/write/delete or changing the key requires review.";
const VRM_LIBRARY_MIXED_PERSISTENCE =
  "Four calls belong to the explicit pre-V12 IndexedDB seam; two reviewed authorityStore writes persist hash-bound VRM license receipts through the product SQLite/OPFS database port.";
const VRM_LIBRARY_MIXED_PERSISTENCE_PROOF =
  "The exact total is pinned at six, while licenseAuthorityStore returns null for legacy or injected repositories and the product store delegates only to acquireStudioLocalDatabase().kvSet.";
const HISTORY_LEGACY_IDB =
  "Explicit pages-history emergency adapter only; the product factory cannot construct or infer this IndexedDB authority.";
const HISTORY_LEGACY_IDB_PROOF =
  "The default factory accepts only a caller-created legacyRecoveryVault and otherwise selects SQLite, native OPFS, or observable memory-only state.";

const ALLOWANCES: readonly BrowserKvAllowance[] = Object.freeze([
  // Deletion-only cleanup of browser compatibility remnants.
  // Intentional change (2026-09, 984251d8c): the key expression moved into
  // useStudioDocumentAccessRuntime as `const autosaveKey = studioAutosaveKey({ userId:
  // studioAuthUserId, workId, remixId })` and reaches the host destructured. Same value, same
  // single deletion — only the expression at the call site changed.
  allow("apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx", "local-storage-cleanup", "autosaveKey", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx", "local-storage-cleanup", "studioLifecycleAutosaveSidecarKey(autosaveKey)", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx", "local-storage-cleanup", "LEGACY_STUDIO_AUTOSAVE_KEY", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  // Intentional change (2026-08, B-17): the recovery-banner "clear" browser-mirror cleanup moved
  // with clearAutosaveRecord into studio-page-autosave-runtime.ts. Same three deletions, same
  // durable-tombstone-first ordering — only the file changed.
  allow("apps/web/src/domains/creator/studio-page-autosave-runtime.ts", "local-storage-cleanup", "autosaveKey", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-page-autosave-runtime.ts", "local-storage-cleanup", "studioLifecycleAutosaveSidecarKey(autosaveKey)", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-page-autosave-runtime.ts", "local-storage-cleanup", "LEGACY_STUDIO_AUTOSAVE_KEY", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  // Intentional change (2026-08, B-09): the post-save tombstone cleanup moved with
  // the extracted handleSave orchestration into studio-page-save-pipeline.ts.
  allow("apps/web/src/domains/creator/studio-page-save-pipeline.ts", "local-storage-cleanup", "autosaveKey", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-page-save-pipeline.ts", "local-storage-cleanup", "studioLifecycleAutosaveSidecarKey(autosaveKey)", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-page-save-pipeline.ts", "local-storage-cleanup", "LEGACY_STUDIO_AUTOSAVE_KEY", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx", "local-storage-cleanup", "STUDIO_AI_RECENT_PROMPTS_KEY", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  // Intentional change (2026-08): clipboard remnant cleanup moved with poser state
  // into useStudioVrmPoserState.ts. Same two deletions — only the file changed.
  allow("apps/web/src/domains/creator/vrm/useStudioVrmPoserState.ts", "local-storage-cleanup", '"studio_pose_clipboard"', 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/vrm/useStudioVrmPoserState.ts", "local-storage-cleanup", '"studio_vrm_full_clip"', 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-data-destruction.ts", "local-storage-cleanup", "key", 2, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-server-revision-restore-controller.ts", "local-storage-cleanup", "autosaveKey", 1, CLEANUP_ONLY, CLEANUP_PROOF),

  // Legacy injected UI helpers. Product UI settings use SQLite/OPFS, while sensitive clipboard
  // state uses sessionStorage and
  // therefore does not need (and must not gain) a durable-browser-storage allowance.
  allow("apps/web/src/domains/creator/studio-feature-tutorials.ts", "local-storage-write", '"toonspectrum.studio.tutorialProgress.v1"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-asset-favorites.ts", "durable-storage-write", "studioAssetFavoriteStorageKey(userId)", 1, UI_ONLY, UI_PROOF),
  allow("apps/web/src/domains/creator/brush/studio-brush-slots.ts", "durable-storage-write", '"toonspectrum-studio-brush-slots:v2"', 1, UI_ONLY, UI_PROOF),
  allow("apps/web/src/domains/creator/studio-effect-favorites.ts", "durable-storage-write", '"toonspectrum-studio-effect-favorites:v1"', 1, UI_ONLY, UI_PROOF),
  allow("apps/web/src/domains/creator/vrm/studio-vrm-poser-ux.ts", "durable-storage-write", "key", 1, UI_ONLY, UI_PROOF),
  // Realtime collaboration v19 view preferences: remote-cursor visibility mode and trail on/off.
  // Presentation state for one viewer's own overlay — no room, document, or peer data is stored.
  allow("apps/web/src/domains/creator/live/studio-live-viewport-preferences.ts", "local-storage-write", "\"toonspectrum:studio-live:viewport-preferences:v1\"", 1, UI_ONLY, UI_PROOF),
  allow("apps/web/src/domains/creator/studio-workspaces.ts", "durable-storage-write", "studioWorkspaceStorageKey(userId)", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),

  // Injected localStorage-compatible codecs retained outside product authority selection.
  allow("apps/web/src/domains/creator/studio-animatic-timeline.ts", "durable-storage-write", "studioAnimaticStorageKey(document.workScope)", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-autosave.ts", "durable-storage-write", "preservePrimary?studioLifecycleAutosaveSidecarKey(primaryKey):primaryKey", 2, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-lt-preset-storage.ts", "durable-storage-write", '"toonspectrum.studio.bg3d.lt-presets.v1"', 2, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-lt-preset-storage.ts", "durable-storage-write", '"toonspectrum.studio.bg3d.lt-presets.corrupt.v1"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-brand-kit.ts", "durable-storage-write", '"toonspectrum-studio-brand-kits"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/brush/studio-brush-library-repository.ts", "durable-storage-write", "key", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/brush/studio-brush-library-sqlite-repository.ts", "durable-storage-write", '"toonspectrum-studio-v12-brush-library-fallback"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/brush/studio-brush-library.ts", "durable-storage-write", '"toonspectrum-studio-brush-library"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-character-bible.ts", "durable-storage-write", "key", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-checkpoints.ts", "durable-storage-write", "key", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-checkpoints.ts", "durable-storage-write", "durableFallbackKey(key)", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-clips.ts", "durable-storage-write", '"toonspectrum-studio-clips"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-creator-pack-runtime.ts", "durable-storage-write", '"toonspectrum.studio-creator-filter-presets.v1"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-creator-pack-runtime.ts", "durable-storage-write", "key", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-custom-fonts.ts", "durable-storage-write", '"toonspectrum-studio-custom-fonts"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-emeres-library.ts", "durable-storage-write", '"toonspectrum-studio-emeres-library"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/filter/studio-filter-library-sqlite-repository.ts", "durable-storage-write", "storageKey", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-marketplace-packages.ts", "durable-storage-write", '"toonspectrum.studio-marketplace-library.v1"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-palette-library.ts", "durable-storage-write", '"toonspectrum-studio-palette-library"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-pose-material-library.ts", "durable-storage-write", '"toonspectrum-studio-pose-material-library-v1"', 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),
  allow("apps/web/src/domains/creator/studio-translation-memory.ts", "durable-storage-write", "key", 1, INJECTED_COMPATIBILITY, INJECTED_PROOF),

  // Explicit legacy IndexedDB seams. Operation counts prevent a file-level blanket exemption.
  allow("apps/web/src/domains/creator/bg3d/bg3d-model-library.ts", "indexeddb-open", '"toonspectrum-studio-bg3d-model-library"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/bg3d-model-library.ts", "indexeddb-write", "add", 2, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/bg3d-model-library.ts", "indexeddb-write", "put", 3, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/bg3d-model-library.ts", "indexeddb-cleanup", "delete", 2, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/bg3d/bg3d-template-library.ts", "indexeddb-open", '"toonspectrum-studio-bg3d-template-library"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/bg3d-template-library.ts", "indexeddb-write", "put", 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/bg3d-template-library.ts", "indexeddb-cleanup", "delete", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-asset-library.ts", "indexeddb-open", '"toonspectrum-studio-asset-library"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-asset-library.ts", "indexeddb-write", "put", 3, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-asset-library.ts", "indexeddb-cleanup", "delete", 2, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-asset-metadata-store.ts", "indexeddb-open", '"toonspectrum-studio-bg3d-asset-metadata"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-asset-metadata-store.ts", "indexeddb-write", "put", 2, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-asset-metadata-store.ts", "indexeddb-cleanup", "delete", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-shot-batch-recovery-store.ts", "indexeddb-open", '"toonspectrum-studio-bg3d-shot-batch-recovery"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-shot-batch-recovery-store.ts", "indexeddb-write", "put", 2, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/bg3d/studio-bg3d-shot-batch-recovery-store.ts", "indexeddb-cleanup", "delete", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-checkpoints.ts", "indexeddb-open", '"toonspectrum-studio-checkpoints"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-checkpoints.ts", "indexeddb-write", "put", 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/live/studio-crdt-outbox.ts", "indexeddb-open", '"toonspectrum-studio-crdt-outbox"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/live/studio-crdt-outbox.ts", "indexeddb-write", "put", 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/live/studio-crdt-outbox.ts", "indexeddb-cleanup", "delete", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/studio-pages-history-durable-runtime.ts", "indexeddb-open", '"toonspectrum-studio-crdt-recovery-vault"', 1, HISTORY_LEGACY_IDB, HISTORY_LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-pages-history-durable-runtime.ts", "indexeddb-write", "put", 4, HISTORY_LEGACY_IDB, HISTORY_LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-production-bible.ts", "indexeddb-open", '"toonspectrum-studio-production-bible"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-production-bible.ts", "indexeddb-write", "put", 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-production-bible.ts", "local-storage-write", "normalizeStudioProductionBibleStorageKey(key)", 2, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-scene-snapshot-library.ts", "indexeddb-open", '"toonspectrum-studio-scene-snapshot-library"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-scene-snapshot-library.ts", "indexeddb-write", "put", 2, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/studio-scene-snapshot-library.ts", "indexeddb-cleanup", "delete", 1, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/vrm/studio-vrm-texture-paint-library.ts", "indexeddb-open", '"toonspectrum-studio-vrm-texture-paint-library"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/vrm/studio-vrm-texture-paint-library.ts", "indexeddb-write", "put", 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/vrm/studio-vrm-texture-paint-library.ts", "indexeddb-cleanup", "delete", 2, CLEANUP_ONLY, CLEANUP_PROOF),
  allow("apps/web/src/domains/creator/vrm/vrm-library.ts", "indexeddb-open", '"toonspectrum-studio-vrm-library"', 1, LEGACY_IDB, LEGACY_IDB_PROOF),
  allow("apps/web/src/domains/creator/vrm/vrm-library.ts", "indexeddb-write", "put", 6, VRM_LIBRARY_MIXED_PERSISTENCE, VRM_LIBRARY_MIXED_PERSISTENCE_PROOF),
  allow("apps/web/src/domains/creator/vrm/vrm-library.ts", "indexeddb-cleanup", "delete", 2, CLEANUP_ONLY, CLEANUP_PROOF),
]);

function allowanceId(value: Pick<BrowserKvFinding | BrowserKvAllowance, "file" | "kind" | "key">) {
  return `${value.file}\u0000${value.kind}\u0000${value.key}`;
}

function unauthorizedFindings(
  findings: readonly BrowserKvFinding[],
  allowances: readonly BrowserKvAllowance[],
): readonly string[] {
  const allowanceById = new Map(allowances.map((entry) => [allowanceId(entry), entry] as const));
  const grouped = new Map<string, BrowserKvFinding[]>();
  for (const entry of findings) {
    const id = allowanceId(entry);
    const group = grouped.get(id) ?? [];
    group.push(entry);
    grouped.set(id, group);
  }
  const problems: string[] = [];
  for (const [id, entries] of grouped) {
    const allowance = allowanceById.get(id);
    if (!allowance) {
      problems.push(...entries.map((entry) =>
        `${entry.file}:${entry.line} ${entry.kind} key=${entry.key} call=${entry.call}`));
      continue;
    }
    if (entries.length !== allowance.occurrences) {
      problems.push(
        `${allowance.file} ${allowance.kind} key=${allowance.key}: `
        + `expected ${allowance.occurrences} occurrence(s), found ${entries.length}`,
      );
    }
  }
  for (const allowance of allowances) {
    if (!grouped.has(allowanceId(allowance))) {
      problems.push(
        `${allowance.file} ${allowance.kind} key=${allowance.key}: stale allowance (0 found)`,
      );
    }
  }
  return Object.freeze(problems.sort());
}

describe("Studio browser-KV authority boundary", () => {
  it("keeps companion layout and presentation-safe product paths free of localStorage authority", () => {
    for (const source of [COMPANION_PAGE_SOURCE, COMPANION_LAYOUT_HOOK_SOURCE]) {
      expect(source).not.toContain("localStorage");
      expect(source).not.toMatch(/\b(?:getItem|setItem|removeItem)\s*\(/u);
    }
    expect(COMPANION_LAYOUT_HOOK_SOURCE).toContain(
      "createStudioCompanionWindowPreferencesRuntime",
    );
    expect(COMPANION_PAGE_SOURCE).toContain("buildStudioCompanionPresentationSafe");
  });

  it("keeps pages-history IndexedDB behind an explicit legacy vault seam", () => {
    const factoryStart = PAGES_HISTORY_DURABLE_RUNTIME_SOURCE.indexOf(
      "export async function createDefaultStudioPagesHistoryDurableRuntime(",
    );
    expect(factoryStart).toBeGreaterThanOrEqual(0);
    const defaultFactory = PAGES_HISTORY_DURABLE_RUNTIME_SOURCE.slice(factoryStart);

    expect(defaultFactory).not.toContain("createStudioPagesHistoryIndexedDbRecoveryVault(");
    expect(defaultFactory).not.toContain("scope.indexedDB");
    expect(defaultFactory).toContain("existingRecoveryVault: options.legacyRecoveryVault ?? null");
    expect(defaultFactory).toContain("createStudioPagesHistoryMemoryRecovery(identity)");
    expect(defaultFactory).toContain('persistenceKind = "memory-only"');
  });

  it("rejects direct, aliased, key-obscured, native-IDB, and wrapper-IDB durable writes", () => {
    const fixtures = [
      `localStorage.setItem("toonspectrum-studio-autosave", payload);`,
      `window.localStorage.setItem("studio-project-v12", payload);`,
      `globalThis.localStorage.setItem("studio-vrm-calibration", payload);`,
      `window.localStorage.setItem("studio_pose_clipboard", payload);`,
      `const browserKv = globalThis.localStorage; browserKv.setItem("brush-library", payload);`,
      `const typedKv = (globalThis.localStorage as Storage); typedKv["setItem"]("studio-project", payload);`,
      `const AUTOSAVE_KEY = "opaque"; storage.setItem(AUTOSAVE_KEY, payload);`,
      `const key = "toonspectrum-studio-autosave"; storage.setItem(key, payload);`,
      `indexedDB.open("studio-crdt", 1);`,
      `function open(factory: IDBFactory) { return factory.open("studio-filter", 1); }`,
      `function write(store: IDBObjectStore) { store.put(payload); }`,
      `import Dexie from "dexie"; const db = new Dexie("studio-project"); db.table("p").put(payload);`,
      `import { openDB } from "idb"; openDB("studio-scene", 1);`,
      `const { openDB } = await import("idb"); openDB("studio-document", 1);`,
      String.raw`storage.set\u0049tem("studio-project", payload);`,
      String.raw`storage["set\Item"]("studio-project", payload);`,
    ] as const;

    for (const [index, fixture] of fixtures.entries()) {
      expect(mayContainBrowserKvAuthority(fixture), fixture).toBe(true);
      expect(
        analyzeBrowserKvSource(`fixture-${index}-studio-project.ts`, fixture),
        fixture,
      ).not.toHaveLength(0);
    }
  });

  it("skips AST construction only when no detectable browser-KV surface exists", () => {
    const inertSource = `
      export function renderStudioPreview(frame: Uint8Array): number {
        return frame.reduce((sum, value) => sum + value, 0);
      }
    `.repeat(2_000);

    expect(mayContainBrowserKvAuthority(inertSource)).toBe(false);
    expect(analyzeBrowserKvSource("large-inert-studio-source.ts", inertSource)).toEqual([]);
  });

  it("does not classify direct, qualified, or aliased sessionStorage writes as durable authority", () => {
    const fixtures = [
      `sessionStorage.setItem("studio_pose_clipboard", payload);`,
      `window.sessionStorage.setItem("studio_vrm_full_clip", payload);`,
      `globalThis.sessionStorage["setItem"]("studio-project-draft", payload);`,
      `const sessionKv = globalThis.sessionStorage; sessionKv.setItem("studio-scene", payload);`,
      `const typedSessionKv = (window.sessionStorage as Storage); typedSessionKv.setItem("studio-brush", payload);`,
    ] as const;

    for (const [index, fixture] of fixtures.entries()) {
      expect(
        analyzeBrowserKvSource(`fixture-${index}-studio-project.ts`, fixture),
        fixture,
      ).toEqual([]);
    }
  });

  it("accepts an exact UI preference, cleanup, and legacy-import allowance", () => {
    const fixtures = [
      {
        file: "fixture-ui.ts",
        source: `localStorage.setItem("studio-ui-density", "compact");`,
        kind: "local-storage-write" as const,
        key: `"studio-ui-density"`,
        rationale: "UI density only; no project or creative payload.",
        proof: "The key stores one closed enum and is not consumed by an IR repository.",
      },
      {
        file: "fixture-cleanup.ts",
        source: `globalThis.localStorage.removeItem("toonspectrum-studio-autosave");`,
        kind: "local-storage-cleanup" as const,
        key: `"toonspectrum-studio-autosave"`,
        rationale: "Deletion-only cleanup cannot create browser-KV authority.",
        proof: "The source contains removeItem and no setItem call.",
      },
      {
        file: "fixture-legacy.ts",
        source: `function legacy(factory: IDBFactory) { return factory.open("legacy-studio", 1); }`,
        kind: "indexeddb-open" as const,
        key: `"legacy-studio"`,
        rationale: "Explicit legacy import/test seam; product boot cannot call it.",
        proof: "The production factory owns SQLite/OPFS and LEGACY_DATA_MIGRATION is false.",
      },
    ] as const;

    const findings = fixtures.flatMap(({ file, source }) => analyzeBrowserKvSource(file, source));
    const allowances = fixtures.map(({ file, kind, key, rationale, proof }) => ({
      file,
      kind,
      key,
      occurrences: 1,
      rationale,
      proof,
    }));
    expect(unauthorizedFindings(findings, allowances)).toEqual([]);
  });

  it("requires cleanup allowances to match the exact finding kind and occurrence count", () => {
    const file = "fixture-cleanup-count.ts";
    const rationale = "Deletion-only compatibility cleanup cannot establish durable authority.";
    const proof = "The exact key and expected number of removeItem calls are independently pinned.";
    const allowance = allow(
      file,
      "local-storage-cleanup",
      '"legacy-studio-project"',
      1,
      rationale,
      proof,
    );
    const duplicateCleanup = analyzeBrowserKvSource(
      file,
      `localStorage.removeItem("legacy-studio-project");\nlocalStorage.removeItem("legacy-studio-project");`,
    );
    expect(unauthorizedFindings(duplicateCleanup, [allowance])).toContain(
      `${file} local-storage-cleanup key="legacy-studio-project": expected 1 occurrence(s), found 2`,
    );

    const writeInstead = analyzeBrowserKvSource(
      file,
      `localStorage.setItem("legacy-studio-project", payload);`,
    );
    expect(unauthorizedFindings(writeInstead, [allowance])).toEqual(expect.arrayContaining([
      expect.stringContaining("local-storage-write"),
      expect.stringContaining("stale allowance"),
    ]));
  });

  it("keeps every allowance narrow, justified, and reviewable", () => {
    const ids = new Set<string>();
    for (const allowance of ALLOWANCES) {
      expect(allowance.file).toMatch(/^(?:apps\/web\/src\/domains\/creator|src\/domains\/creator|packages\/studio-[^/]+\/src)\//u);
      expect(allowance.file).not.toMatch(/[?*{}[\]]/u);
      expect(allowance.key.length).toBeGreaterThan(0);
      expect(allowance.key).not.toBe("*");
      expect(allowance.occurrences).toBeGreaterThan(0);
      expect(allowance.rationale.length).toBeGreaterThanOrEqual(24);
      expect(allowance.proof.length).toBeGreaterThanOrEqual(24);
      expect(ids.has(allowanceId(allowance))).toBe(false);
      ids.add(allowanceId(allowance));
    }
  });

  it(
    "scans creator plus every discovered studio package and admits no unreviewed authority",
    () => {
      const roots = studioSourceRoots().map((root) => slash(relative(WORKSPACE_ROOT, root)));
      expect(roots).toContain("apps/web/src/domains/creator");
      expect(roots).toContain("packages/studio-project-model/src");
      expect(roots).toContain("packages/studio-brush-platform/src");
      expect(roots.length).toBeGreaterThanOrEqual(8);

      expect(unauthorizedFindings(analyzeWorkspace(), ALLOWANCES)).toEqual([]);
    },
    60_000,
  );
});
