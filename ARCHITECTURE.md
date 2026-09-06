# 아키텍처 개요

## 저장소 운영 모델

- 루트 `package.json`은 Vite·React 프런트엔드의 단일 툴체인 소유자입니다. `apps/web`은 별도 pnpm 패키지가 아니라 이 루트 패키지가 사용하는 브라우저 소스 루트입니다.
- `apps/api`는 독립된 NestJS workspace package입니다. HTTP, WebSocket, DB, 영속성, 외부 서비스 연동은 서버 전용으로 유지합니다.
- `packages`에는 브라우저와 서버가 함께 사용할 수 있는 런타임 중립 계약·순수 모델·Studio 엔진만 둡니다.
- `api`에는 Vercel 진입점용 얇은 어댑터만 두고 실제 서버 구현은 `apps/api`에 둡니다.
- 루트에는 모노레포·빌드·배포 설정, 횡단 검증, 문서와 운영 자동화를 둡니다. 제품 브라우저 코드는 루트에 두지 않습니다.

`@/*`는 `apps/web/*`, `@/shared/*`는 `apps/web/src/shared/*`를 가리킵니다. 백엔드는 웹 앱을 import하지 않으며, 생성된 QA 결과는 CI artifact로만 보관합니다.

## 디렉터리 책임

```text
apps/web/                         # 루트 package.json이 구동하는 브라우저 애플리케이션
  config/                         # Vite 전용 빌드 정책과 수동 청크 규칙
  index.html                      # 유일한 프로덕션 HTML 진입점
  public/                         # 그대로 배포되는 정적 자산
  src/
    app/                          # 부트스트랩, 라우팅, 서비스 워커, 앱 셸
    domains/                      # 제품 도메인별 UI·유스케이스·모델·어댑터
      creator/                    # Studio와 창작 도구
      catalog/                    # 카탈로그·검색·랭킹
      community/                  # 커뮤니티·리뷰
      auth/                       # 인증 UI와 세션 오케스트레이션
    shared/                       # 도메인·인프라에 의존하지 않는 횡단 코드
      components/                 # 범용 UI primitive와 공용 제품 UI
      lib/                        # 공용 계약·유틸리티·브라우저 안전 런타임
      catalog/                    # 정적 카탈로그 런타임
    components/                   # 앱 셸·오류·브라우저 호환 컴포넌트
    hooks/                        # 웹 공용 훅
    infrastructure/               # API·클라우드 저장소 클라이언트
    styles/                       # 전역 스타일
    types/                        # 브라우저 공용 타입과 외부 모듈 shim
  tests/browser-fixtures/         # Vite가 직접 제공하는 브라우저 fixture
  tools/browser-harnesses/        # 프로덕션 엔트리와 분리된 수동/E2E 하네스
apps/api/                         # 서버 전용 NestJS workspace package
  src/modules/                    # 기능 모듈과 HTTP 경계
  src/infrastructure/             # DB·외부 서비스 어댑터
  src/db/                         # 스키마·마이그레이션·시드
  src/server/                     # 서버 전용 유스케이스와 정책
packages/                         # 웹/API 공용 런타임 중립 계약·엔진
api/                              # Vercel 진입점용 얇은 어댑터
scripts/, tools/, e2e/, tests/    # 저장소 횡단 도구와 검증 코드
```

브라우저 fixture와 하네스는 Vite의 `root: apps/web` 아래에서 URL로 제공되므로 `apps/web/tests`와 `apps/web/tools`가 canonical 위치입니다. 같은 파일을 루트 `tests`나 `tools`에 복제하지 않습니다.

## 의존성 경계

ESLint boundary gate가 다음 규칙을 실행합니다.

- `app`은 조립 지점으로서 `app`, `domains`, `shared`, `infrastructure`를 사용할 수 있습니다.
- `domains`는 제품 기능을 소유하며 `domains`, `shared`, `infrastructure`를 사용할 수 있습니다.
- `infrastructure`는 `shared`와 다른 infrastructure만 사용할 수 있습니다.
- `shared`와 `types`는 도메인·앱·인프라에 역으로 의존할 수 없습니다.

레거시 결합 때문에 필요한 제한적 예외는 파일 단위로 명시하고, `eslint.legacy-exceptions.json`과 테스트를 통해 수가 늘지 않도록 관리합니다. 새 도메인 코드는 `apps/web/src/domains/<domain>`에, 도메인 간 계약과 브라우저 안전 유틸리티는 `apps/web/src/shared`에 둡니다. 웹과 API가 함께 써야 하는 계약은 Node·DOM API에 의존하지 않게 만든 뒤 `packages/*`에서 공개합니다.

## 검증과 생성물 정책

`pnpm run validate:architecture`는 canonical 엔트리, 필수 문서·스크립트, 워크플로 경로, 레거시 루트 디렉터리 재등장과 중복 하네스를 검사합니다. 기본 CI의 lint job은 CSP 원본 검증과 테스트·타입 입력 수 래칫(`verify:toolchain-coverage`)까지 실행하므로 경로 이동이 검증 범위를 조용히 줄일 수 없습니다.

`dist`, `coverage`, `qa-results`, Playwright screenshot과 임시 진단 파일은 소스가 아닙니다. 재현 가능한 명령이나 Actions artifact로 생성하고 Git에는 커밋하지 않습니다.
