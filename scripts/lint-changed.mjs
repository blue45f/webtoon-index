import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const LINTABLE_EXTENSION = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/u;
const args = process.argv.slice(2);
const fix = args.includes("--fix");
const staged = args.includes("--staged");
const baseArgument = args.find((argument) => argument.startsWith("--base="));
const base = baseArgument?.slice("--base=".length).trim();

if (staged && fix) {
  process.stderr.write(
    "lint:quick — --staged와 --fix는 함께 사용할 수 없습니다. ESLint --fix는 Git 인덱스가 아니라 작업 트리를 수정합니다.\n" +
    "먼저 작업 트리에 --fix를 실행한 뒤 변경을 다시 스테이징하세요.\n"
  );
  process.exit(2);
}

function gitLines(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.split("\0").filter(Boolean);
}

let diffArgs;
if (staged) diffArgs = ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z", "--"];
else if (base) diffArgs = ["diff", "--name-only", "--diff-filter=ACMR", "-z", `${base}...HEAD`, "--"];
else diffArgs = ["diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD", "--"];

const candidates = new Set(gitLines(diffArgs));
if (staged) {
  const worktreeChanges = new Set(gitLines([
    "diff",
    "--name-only",
    "-z",
    "--",
  ]));
  const partiallyStaged = [...candidates]
    .filter((file) => worktreeChanges.has(file))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (partiallyStaged.length > 0) {
    const partiallyStagedText = partiallyStaged.map((file) => `  ${file}`).join("\n");
    process.stderr.write(
      `lint:quick:staged — 부분 스테이징 파일은 작업 트리와 인덱스 내용이 다릅니다:\n${partiallyStagedText}\n` +
      "커밋 검증에는 lint-staged를 사용하거나, 변경을 완전히 스테이징한 뒤 다시 실행하세요.\n"
    );
    process.exit(2);
  }
}
if (!staged) {
  for (const file of gitLines(["ls-files", "--others", "--exclude-standard", "-z"])) {
    candidates.add(file);
  }
  if (base) {
    // A branch comparison does not include the developer's current unstaged edits.
    for (const file of gitLines([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      "-z",
      "HEAD",
      "--",
    ])) {
      candidates.add(file);
    }
  }
}

const files = [...candidates]
  .filter((file) => LINTABLE_EXTENSION.test(file) && existsSync(file))
  .sort((left, right) => left.localeCompare(right, "en"));

if (files.length === 0) {
  process.stdout.write("lint:quick — 검사할 변경 파일이 없습니다.\n");
  process.exit(0);
}

process.stdout.write(`lint:quick — 변경 파일 ${files.length}개를 검사합니다.\n`);
const eslintArgs = [
  "exec",
  "eslint",
  "--max-warnings=0",
  // 변경 목록에는 의도적으로 전역 ignore 된 설정/생성 파일이 섞일 수 있다. ESLint 10의
  // ignored-file 경고만 숨기고, 실제 검사 대상의 경고는 max-warnings=0으로 계속 실패시킨다.
  "--no-warn-ignored",
  "--cache",
  "--cache-strategy",
  "content",
  "--cache-location",
  "node_modules/.cache/eslint/quick/",
  ...(fix ? ["--fix"] : []),
  "--",
  ...files,
];
const result = spawnSync("pnpm", eslintArgs, {
  cwd: process.cwd(),
  stdio: "inherit",
});
process.exit(result.status ?? 1);
