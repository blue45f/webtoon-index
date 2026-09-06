import { base, react, plugin, boundaries, defineConfig } from '@heejun/eslint-config'
import js from '@eslint/js'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'

// 린트 예외 원장(ledger). 두 예외 블록의 파일 목록은 여기 단일 소스에 있고,
// scripts/eslint-legacy-exceptions.test.mjs 가 "글롭이 실제 파일과 맞는가 / 개수가
// 늘지 않았는가"를 래칫으로 지킨다. 목록이 설정 파일 안에 흩어져 있으면 "기계적 추출"
// 상태가 영구 동결되는데, 밖으로 빼두면 정리할 때마다 줄어드는 게 diff 로 보인다.
import legacyExceptions from './eslint.legacy-exceptions.json' with { type: 'json' }

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/.vercel/**',
    '**/*.d.ts',
    '**/*.tsbuildinfo',
    '**/*.config.{js,mjs,cjs,ts}',
    // wasm-bindgen가 재현 가능 빌드로 생성하고 별도 SHA-256 release gate가 검증하는 배포물.
    // 생성 JS를 직접 고치면 다음 pinned rebuild에서 덮어써지므로 호스트 ESLint 대상에서 제외한다.
    'packages/studio-hokusai-wasm/pkg/**',
    'crates/studio-engine-vello/pkg/**',
    'crates/studio-engine-vello/pkg-gpu/**',
    // 에이전트 워크플로가 격리 작업용으로 만드는 임시 git worktree(전역 gitignore 대상이라
    // 커밋되진 않지만, eslint 기본 스캔은 gitignore 를 안 따라가므로 이 안에 있는 이 저장소의
    // 사본까지 전부 다시 스캔해버린다 — vitest.config.ts 의 동일 제외와 같은 이유).
    '**/.claude/worktrees/**',
    '**/.codex/**',
    '**/.remember/**',
    '**/scratch/**',
    'scripts/__diag/**',
  ]),

  // 공유 베이스(TS + import 위생 + 커스텀 규칙 + prettier 충돌 비활성).
  base({ files: ['**/*.{ts,tsx,mts,cts}'] }),

  // apps/web/src 아래의 Vite 브라우저 앱 — React 19 + RC + jsx-a11y.
  // 루트 package.json이 프런트엔드 툴체인을 소유하고, NestJS API만 별도 workspace package다.
  react({ files: ['apps/web/src/**/*.{ts,tsx}'] }),

  // The architecture move changed every app import root at once; keep import order diagnostics disabled
  // for the moved surfaces until the shared resolver understands the new workspace aliases.
  {
    files: ["apps/api/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}", "e2e/feedback-community-harness.tsx", "scripts/seed/market-dev-seed.mts", "tests/benchmarks/harness/vrm-surface-brush-browser-page.ts", "vitest.setup.ts"],
    rules: { "import-x/order": "off" },
  },

  // heejun 개인 테스트/목 컨벤션 규칙은 비활성 — 횡단 일관성 대상이 아니라
  // ToonSpectrum 자체 테스트 스타일과 충돌한다(shared base 의 일반 규칙만 채택).
  {
    plugins: { '@heejun': plugin },
    rules: {
      '@heejun/vitest-mock-import': 'off',
      '@heejun/vitest-mock-import-original': 'off',
      '@heejun/mock-response-naming': 'off',
      '@heejun/no-js-interface-direct-access': 'off',
    },
  },

  // 루트 Vite 앱 react-hooks 정책:
  // - exhaustive-deps 는 error 로 강제(공유 react() 는 recommended=warn). OLD 인라인 config 가
  //   error 였고 lint:ci 는 --max-warnings=0 이라 parity 유지.
  // - react-hooks v7 의 신규 "advice" 규칙(set-state-in-effect/refs/immutability/incompatible-library)
  //   은 OLD config 가 활성화하지 않았다(OLD = rules-of-hooks + exhaustive-deps + react-compiler 만).
  //   이들은 정당한 관용구(fetch 직전 setLoading 리셋, latest-ref 패턴, react-hook-form watch)에서
  //   대량 오탐을 낸다. 공유 config 채택이 8000줄 스튜디오에 동작 변경 리스크를 끌고 오지 않도록,
  //   OLD 의 react-hooks 적용 범위와 동일하게 비활성한다(스코프 크립 방지).
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/incompatible-library': 'off',
    },
  },

  // AdminAnnouncements 의 활성 토글은 가시 텍스트와 checkbox 를 감싸는 유효한 wrapping label 이다.
  // 현재 jsx-a11y 판정이 이 동적 편집 폼의 중첩 연결을 놓치므로 해당 파일의 이 규칙만 제한적으로 끈다.
  {
    files: ['apps/web/src/domains/admin/components/AdminAnnouncements.tsx'],
    rules: {
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },

  // StudioPage 예외: StudioCuttoonEditor 는 구조적으로 React Compiler 를 탈락("use no memo"
  // 명시)하고, memo 자식들의 prop 안정성을 위한 수동 useMemo/useCallback 을 대량 유지한다.
  // v7 컴파일러 기반 진단 두 개는 탈락 컴포넌트의 수동 메모를 "보존 불가"로, 이벤트 핸들러의
  // Date.now 등을 "렌더 중 불순 호출"로 오탐하므로 이 파일에서만 끈다(다른 파일은 그대로).
  {
    files: legacyExceptions.compilerOptOutFiles,
    rules: {
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'import-x/order': 'off',
    },
  },

  // Mechanical extract of StudioCuttoonEditor closures: host/session bags are `any`
  // so the original identifiers stay intact. Unused destructure slots are kept
  // because the next handler pass still closes over the same bag.
  {
    files: legacyExceptions.closureBagFiles,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'import-x/order': 'off',
      'react-compiler/react-compiler': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/purity': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    },
  },

  // apps/web/src/ 계층 경계 — 개발가이드의 app/domains/shared/infrastructure 4계층.
  // ToonSpectrum 은 Vite 앱이 apps/web 에 있어 계층은 apps/web/src/ 아래에만 둔다(루트 components/·lib/ 는
  // 대규모 공용 트리이며 apps/web 경계 안에서 함께 관리한다
  // = 분류되지 않으므로 강제 대상 아님). apps/web/src/ 안의 compat/components/hooks/styles 와
  // 횡단 카탈로그 엔진(catalog-static*)은 shared 로 매핑한다.
  ...boundaries({
    files: ['apps/web/src/**/*.{ts,tsx}'],
    elements: [
      { type: 'app', pattern: 'apps/web/src/app/**/*', mode: 'full' },
      { type: 'domains', pattern: 'apps/web/src/domains/*/**/*', mode: 'full' },
      {
        type: 'shared',
        pattern: 'apps/web/src/{components,hooks,styles,compat,catalog-static,catalog-static-engine}*/**/*',
        mode: 'full',
      },
      { type: 'shared', pattern: 'apps/web/src/catalog-static*.ts', mode: 'full' },
      { type: 'infrastructure', pattern: 'apps/web/src/infrastructure/**/*', mode: 'full' },
    ],
    rules: [
      { from: ['app'], allow: ['app', 'domains', 'shared', 'infrastructure'] },
      { from: ['domains'], allow: ['domains', 'shared', 'infrastructure'] },
      { from: ['infrastructure'], allow: ['shared', 'infrastructure'] },
      { from: ['shared'], allow: ['shared'] },
    ],
  }),
  // boundaries 는 TS 임포트를 분류하려면 리졸버가 필요하다(없으면 조용히 no-op).
  // 루트 tsconfig.json 의 paths(@/* -> apps/web/*)로 @/src/* 별칭을 해석한다.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    settings: {
      'import/resolver': { typescript: { project: 'tsconfig.json' }, node: true },
    },
  },
  // 기술부채 완화(차기 패스에서 정리 예정). 페이지 중심으로 자란 앱이라 계층 결합이 광범위하다:
  // - infrastructure/use-api-resource 는 매핑상 infra 지만 React 훅이라 도메인 페이지가 직접 쓴다.
  // - shared(compat/auth) 는 인증 부트스트랩에서 infrastructure(api 클라이언트)를 오케스트레이션한다.
  // - hooks/use-app-config 는 런타임 설정을 공유 api(ky) 클라이언트로 읽는 부트스트랩 훅이다.
  // 이들을 strict 계층으로 분리하는 것은 SiteHeader·CommandPalette 같은 루트 공용 컴포넌트까지
  // 얽힌 대규모 리팩터라 이번 도메인화 범위 밖이다. 순수 shared(hooks·styles)는 계속 strict.
  {
    files: [
      'apps/web/src/infrastructure/use-api-resource.ts',
      'apps/web/src/hooks/use-app-config.ts',
      'apps/web/src/compat/**/*.{ts,tsx}',
    ],
    rules: { 'boundaries/element-types': 'off' },
  },

  // apps/api — NestJS (Node). 데코레이터 + 빈 생성자/클래스 관용.
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  // 서버/DB/스크립트 유틸은 Node 런타임.
  {
    files: ['scripts/**/*.{ts,tsx,mts,cts}'],
    languageOptions: { globals: globals.node },
  },

  // JS/MJS(스크립트·SW 등) — TS 파서 밖이라 js.recommended + Node globals 로 별도 처리.
  {
    files: ['**/*.{js,mjs}'],
    ...js.configs.recommended,
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    rules: {
      'no-useless-escape': 'off',
    },
  },

  // 마켓 이행 스크립트는 정확한 TS/TSX 소스 조각을 template literal 안에 보존한다.
  // 이스케이프를 제거하면 생성되는 소스 계약이 바뀌므로 두 파일에만 규칙을 제한적으로 끈다.
  {
    files: [
      'scripts/marketplace/fix-authoring-contracts.mjs',
      'scripts/marketplace/integrate-source-package-builder.mjs',
    ],
    rules: { 'no-useless-escape': 'off' },
  },

  // 테스트 — Vitest globals; fast-refresh 제약 완화 + any 허용.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': 'off',
    },
  }
)
