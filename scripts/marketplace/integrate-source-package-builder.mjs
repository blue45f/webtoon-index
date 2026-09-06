import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const target = resolve(root, "apps/web/src/domains/market/components/MarketplaceAuthoringWorkshop.tsx");
let source = readFileSync(target, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Missing ${label} anchor.`);
  source = source.replace(before, after);
}

if (!source.includes("creator-marketplace-package-builder")) {
  source = `import { buildCreatorMarketplaceSourcePackage } from "@/shared/lib/creator-marketplace-package-builder";\n\n${source}`;
}
source = source.replace("  buildCreatorMarketplaceAuthoringManifest,\n", "");

const applyPattern = /function applyDraftToPublishForm\([\s\S]*?\n\}\n\nfunction downloadJson/u;
if (!source.includes("packageFile: File")) {
  if (!applyPattern.test(source)) throw new Error("Legacy publish-form bridge anchor changed.");
  source = source.replace(applyPattern, `function applyDraftToPublishForm(
  draft: CreatorMarketplaceAuthoringDraft,
  packageFile: File,
): { applied: number; packageAttached: boolean } {
  const mappings: Array<[RegExp, string]> = [
    [/이름|제목|title/i, draft.title],
    [/요약|summary/i, draft.summary],
    [/설명|description|소개/i, draft.description],
    [/태그|tags/i, draft.tags.join(", ")],
    [/버전|version/i, draft.release.version],
    [/변경|changelog|릴리스 노트/i, draft.release.changelog],
  ];
  let applied = 0;
  for (const [pattern, value] of mappings) {
    if (!value) continue;
    const control = findLabeledControl(pattern);
    if (!control || control.closest('[data-marketplace-authoring-workshop="true"]')) continue;
    setNativeFieldValue(control, value);
    applied += 1;
  }

  const kindControl = findLabeledControl(/종류|유형|kind|category/i);
  if (kindControl instanceof HTMLSelectElement) {
    const option = Array.from(kindControl.options).find((candidate) =>
      candidate.value === draft.kind || candidate.textContent?.includes(KIND_LABELS[draft.kind]),
    );
    if (option) {
      setNativeFieldValue(kindControl, option.value);
      applied += 1;
    }
  }

  const fileInput = Array.from(document.querySelectorAll('input[type="file"]'))
    .find((element): element is HTMLInputElement =>
      element instanceof HTMLInputElement
      && !element.closest('[data-marketplace-authoring-workshop="true"]'),
    );
  if (!fileInput || typeof DataTransfer === "undefined") return { applied, packageAttached: false };
  const transfer = new DataTransfer();
  transfer.items.add(packageFile);
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  return { applied, packageAttached: true };
}

function downloadJson`);
}

if (!source.includes("function downloadFile(file: File)")) {
  const marker = `function diagnosticClass(diagnostic: CreatorMarketplaceAuthoringDiagnostic): string {`;
  const insert = `function downloadFile(file: File): void {\n  const url = URL.createObjectURL(file);\n  const anchor = document.createElement("a");\n  anchor.href = url;\n  anchor.download = file.name;\n  anchor.click();\n  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);\n}\n\n`;
  if (!source.includes(marker)) throw new Error("Download helper anchor changed.");
  source = source.replace(marker, `${insert}${marker}`);
}

replaceOnce(
  `  const fileRef = useRef<HTMLInputElement>(null);\n  const canvasRef = useRef<HTMLCanvasElement>(null);`,
  `  const fileRef = useRef<HTMLInputElement>(null);\n  const canvasRef = useRef<HTMLCanvasElement>(null);\n  const [sourceFiles, setSourceFiles] = useState<readonly File[]>([]);`,
  "source file state",
);

replaceOnce(
  `  const errors = diagnostics.filter((item) => item.severity === "error");\n  const warnings = diagnostics.filter((item) => item.severity === "warning");`,
  `  const errors = diagnostics.filter((item) => item.severity === "error");\n  const warnings = diagnostics.filter((item) => item.severity === "warning");\n  const sourceFileMissing = normalized.source.mode === "file" && sourceFiles.length === 0;\n  const blockingErrorCount = errors.length + (sourceFileMissing ? 1 : 0);`,
  "package blocking state",
);

replaceOnce(
  `  const handleFile = async (file: File): Promise<void> => {\n    if (file.size > 64 * 1024 * 1024) {`,
  `  const handleFile = async (file: File): Promise<void> => {\n    if (file.size > 64 * 1024 * 1024) {`,
  "file handler",
);
if (!source.includes("setSourceFiles([file]);\n    if (/json|brush|toonmarket/iu")) {
  replaceOnce(
    `      return;\n    }\n    if (/json|brush|toonmarket/iu.test(\`\${file.type} \${file.name}\`)) {`,
    `      return;\n    }\n    setSourceFiles([file]);\n    if (/json|brush|toonmarket/iu.test(\`\${file.type} \${file.name}\`)) {`,
    "retain selected source file",
  );
}

const oldApply = `  const applyToForm = (): void => {\n    const result = applyDraftToPublishForm(normalized);\n    setStatus(\n      result.packageAttached\n        ? \`등록 폼 \${result.applied}개 항목과 제작 패키지를 연결했습니다.\`\n        : \`등록 폼 \${result.applied}개 항목을 연결했습니다. 패키지는 내려받아 첨부하세요.\`,\n    );\n  };`;
const newApply = `  const buildPackage = async () => await buildCreatorMarketplaceSourcePackage({\n    draft: normalized,\n    sourceFiles,\n  });\n\n  const downloadPackage = async (): Promise<void> => {\n    try {\n      if (sourceFileMissing) {\n        setStatus("원본 파일을 다시 연결한 뒤 패키지를 만드세요.");\n        return;\n      }\n      const built = await buildPackage();\n      downloadFile(built.file);\n      setStatus(\`원본 \${built.inventory.filter((item) => item.role === "source").length}개와 제작 manifest를 패키징했습니다.\`);\n    } catch (error) {\n      setStatus(error instanceof Error ? error.message : "제작 패키지를 만들지 못했습니다.");\n    }\n  };\n\n  const applyToForm = async (): Promise<void> => {\n    try {\n      if (sourceFileMissing) {\n        setStatus("원본 파일을 다시 연결한 뒤 등록 폼에 적용하세요.");\n        return;\n      }\n      const built = await buildPackage();\n      const result = applyDraftToPublishForm(normalized, built.file);\n      setStatus(\n        result.packageAttached\n          ? \`등록 폼 \${result.applied}개 항목과 원본 포함 패키지를 연결했습니다.\`\n          : \`등록 폼 \${result.applied}개 항목을 연결했습니다. 패키지를 내려받아 직접 첨부하세요.\`,\n      );\n    } catch (error) {\n      setStatus(error instanceof Error ? error.message : "등록 패키지를 만들지 못했습니다.");\n    }\n  };`;
replaceOnce(oldApply, newApply, "async package handoff");

source = source.replace(
  /<Metric label="오류" value=\{errors\.length\} tone=\{errors\.length > 0 \? "danger" : "ok"\} \/>/gu,
  '<Metric label="오류" value={blockingErrorCount} tone={blockingErrorCount > 0 ? "danger" : "ok"} />',
);

if (!source.includes("data-testid=\"market-authoring-source-files\"")) {
  const anchor = `            <div className="grid gap-4 lg:grid-cols-2">`;
  const insert = `            <div\n              data-testid="market-authoring-source-files"\n              className="rounded-xl border border-line bg-raised/30 p-3 text-xs text-fg-2"\n            >\n              {sourceFiles.length > 0\n                ? \`원본 연결: \${sourceFiles.map((file) => \`\${file.name} (\${(file.size / 1024 / 1024).toFixed(1)}MB)\`).join(", ")}\`\n                : normalized.source.mode === "file"\n                  ? "새로고침 후 원본 바이트가 복원되지 않았습니다. 같은 원본 파일을 다시 선택하세요."\n                  : "Brush Studio 원본은 제작 manifest 안에 보존됩니다."}\n            </div>\n`;
  const index = source.indexOf(anchor, source.indexOf('data-testid="market-authoring-source-file"'));
  if (index < 0) throw new Error("Source file summary anchor changed.");
  source = `${source.slice(0, index)}${insert}${source.slice(index)}`;
}

if (!source.includes("원본 파일 바이트가 현재 세션에 없습니다.")) {
  const anchor = `            <div className="space-y-2" data-testid="market-authoring-diagnostics">`;
  const insert = `            {sourceFileMissing && (\n              <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">\n                <strong>원본 파일 바이트가 현재 세션에 없습니다.</strong>\n                <p className="mt-1 text-xs opacity-80">새로고침 후에는 같은 원본을 다시 선택해야 제출 패키지에 포함됩니다.</p>\n              </div>\n            )}\n`;
  if (!source.includes(anchor)) throw new Error("Diagnostics anchor changed.");
  source = source.replace(anchor, `${insert}${anchor}`);
}

const oldPackageButton = `          <button\n            type="button"\n            onClick={() => downloadJson(\n              \`\${normalized.title || "marketplace-asset"}.toonmarket.json\`,\n              buildCreatorMarketplaceAuthoringManifest(normalized),\n            )}\n            className="min-h-11 rounded-lg border border-line bg-card px-4 text-sm font-semibold text-fg"\n          >패키지 내려받기</button>`;
const newPackageButton = `          <button\n            type="button"\n            onClick={() => void downloadPackage()}\n            className="min-h-11 rounded-lg border border-line bg-card px-4 text-sm font-semibold text-fg"\n          >원본 포함 패키지 내려받기</button>`;
replaceOnce(oldPackageButton, newPackageButton, "package download button");

source = source.replace(
  `            onClick={applyToForm}`,
  `            onClick={() => void applyToForm()}`,
);
source = source.replace(
  `            disabled={errors.length > 0}`,
  `            disabled={blockingErrorCount > 0}`,
);

writeFileSync(target, source);
writeFileSync(
  resolve(root, "marketplace-source-package-integration-report.json"),
  `${JSON.stringify({ target: "apps/web/src/domains/market/components/MarketplaceAuthoringWorkshop.tsx", status: "integrated" }, null, 2)}\n`,
);