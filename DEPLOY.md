# ToonSpectrum 배포 가이드

현재 운영 환경은 작업 유형별로 권위를 분리합니다. Vercel은 정적 SPA와 제한된 NestJS HTTP API를, Neon/호환 PostgreSQL은 동적 데이터와 migration 원장을, Cloudflare Durable Objects는 Studio의 임시 실시간 상태를, Upstash는 분산 제한·조정을, Supabase 비공개 Storage는 원본·파생·내보내기 객체를 담당합니다.
한 제공자가 다른 제공자의 전체 폴백이 되지는 않으며, 각 제공자가 같은 목적의 전체 계약을 충족하는지 반드시 증명해야 합니다.

| 레이어 | 스택 | 기본 호스트 | 배포 산출물 |
| --- | --- | --- | --- |
| 프론트 | Vite + React SPA | Vercel | `dist/` |
| 카탈로그 | 정적 스냅샷 | Vercel CDN | `public/data/*.json` |
| API | NestJS serverless | Vercel Functions | `api/index.js` → `apps/api/dist/.../serverless` |
| DB | PostgreSQL | Neon/호환 Postgres | 동적 데이터 + checksum migration 원장 |
| Studio realtime | Durable Objects | Cloudflare `workers.dev` | presence·comment invalidation·screen-share signaling |
| 분산 제한/조정 | Redis | Upstash | auth rate-limit·lease·coordination |
| object storage | private buckets | Supabase Storage | source·derived·export |

`render.yaml`은 Studio Socket.IO 연결을 검증하기 위한 **선택형 폴백** Blueprint입니다.
`API_RUNTIME_ROLE=studio-live`는 health probe와 Socket.IO만 허용하므로 일반 HTTP API의 대체
호스트가 아닙니다. 현재 `vercel.json`은 `/api/*`를 Vercel 함수로 라우팅하며 이 경계는
Render를 사용해도 유지합니다.

### 운영 검증 스냅샷 (2026-08-02)

- production DB `0001`~`0025` exact ledger와 runtime capability 검증 완료
- Cloudflare realtime `workers.dev` 활성; `realtime.toonstudio.cloud` custom hostname/DNS/TLS는 대기
- Upstash coordination과 Supabase private buckets 활성
- Google OAuth production callback 수정·검증 완료
- AI provider production secret·budget/failover 값은 다음 승인 배포 반영 대기

## 0. 준비물

- Node 24.16+와 pnpm 11 (`corepack enable` 권장)
- Vercel 계정
- Neon 또는 호환 PostgreSQL `DATABASE_URL`
- 소셜 로그인 실연동 시 Google Cloud / Kakao Developers 앱

## 1. 로컬 검증

```bash
pnpm install
pnpm catalog:gen
pnpm run verify
```

`pnpm catalog:gen`은 `apps/api/data/catalog.json.gz`를 읽어 `public/data/*.json`과 `public/data/ranking/*.json`을 만듭니다. 이 산출물은 빌드 시 다시 생성되며, 랭킹 기본 뷰는 `disableLive=true` 스냅샷 산식으로 사전 계산됩니다.

## 2. Vercel 배포

1. Vercel → Add New Project → 이 레포 선택.
2. `vercel.json`의 설정을 그대로 사용합니다.
   - `buildCommand`: `pnpm --filter @webtoon-nest/api build && pnpm run build`
   - `outputDirectory`: `dist`
   - `/api/:path*` → `/api/index`
   - `/title/:slug` → `/api/og?slug=:slug`
3. 환경변수를 설정합니다.
   - `DATABASE_URL`: 동적 API가 사용할 PostgreSQL 연결 문자열.
   - `AUTH_STATE_SECRET`: OAuth state 서명 키. 상용은 고정값 필수.
   - `CANONICAL_HOST=www.toonstudio.cloud`: OG/JSON-LD 정본 hostname.
   - `API_CORS_ALLOWED_ORIGINS=https://www.toonstudio.cloud,https://toonstudio.cloud`: 운영 웹 origin exact allowlist.
   - `OAUTH_REDIRECT_BASE_URL=https://www.toonstudio.cloud`: OAuth callback 기준 URL.
   - `WEB_APP_BASE_URL=https://www.toonstudio.cloud`: 로그인 완료 후 복귀 URL.
   - `WEBDEX_SITE_URL=https://www.toonstudio.cloud`: 알림 스크립트의 기존 호환 키(링크 기준 URL).
   - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`: 선택.
   - `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`: 선택.
   - `ADMIN_EMAILS`: 선택.
   - `CATALOG_INGEST_TRIGGER_TOKEN`: 원격 수동 ingest를 쓸 때만.
   - `CATALOG_INGEST_MODE=off`: 기본 권장.

프론트가 상대경로 `/api/...`를 호출하므로 일반 HTTP API는 같은 origin으로 동작합니다.
`API_CORS_ALLOWED_ORIGINS`는 apex에서 정본으로 전환되는 도중의 preflight와, 별도 장기 실행
Socket.IO 서버의 HTTP/WebSocket origin 검사를 동일하게 유지하기 위한 exact allowlist입니다.
와일드카드나 임의 Vercel preview origin은 운영 기본값에 포함하지 않습니다.

## 3. OAuth 콜백

운영 정본은 `https://www.toonstudio.cloud`입니다. 아래 값을 Vercel 환경변수와 각 OAuth
콘솔에 동일하게 등록합니다.

```env
OAUTH_REDIRECT_BASE_URL=https://www.toonstudio.cloud
WEB_APP_BASE_URL=https://www.toonstudio.cloud
```

콘솔 등록 URI:

- Google: `https://www.toonstudio.cloud/api/auth/oauth/google/callback`
- Kakao: `https://www.toonstudio.cloud/api/auth/oauth/kakao/callback`
- Naver: `https://www.toonstudio.cloud/api/auth/oauth/naver/callback`

Google Identity Services의 승인된 JavaScript origin에는
`https://www.toonstudio.cloud`를 등록합니다. apex는 앱 실행 전에 정본으로 308
리다이렉트하므로 OAuth 기준 URL은 www 하나로 유지합니다.

키가 없으면 로그인 모달은 데모 폴백을 명확히 표시합니다.

## 4. 데이터 갱신

기본 사용자 경로는 정적 카탈로그입니다.

1. 크롤러가 새 `apps/api/data/catalog.json.gz`를 만든다.
2. `pnpm catalog:gen`이 `public/data/*.json`을 생성한다.
3. Vercel 재배포로 CDN 스냅샷이 갱신된다.

로컬 또는 운영 API 폴백 경로에서 DB 스냅샷을 직접 갱신하려면 `pnpm ingest` 또는 `POST /api/catalog/ingest/run`을 사용할 수 있습니다. 운영에서 자동 수집을 켜기 전에는 플랫폼별 robots.txt, 이용약관, API 약관, 호출량 제한, 저장 필드 범위를 별도로 검토해야 합니다.

## 5. 배포 후 점검

- 프론트 도메인 접속 → 홈/검색/랭킹이 로드되는지 확인.
- `GET https://<domain>/api/auth/providers`가 200인지 확인.
- `GET https://<domain>/api/ranking?axis=popular&period=daily&limit=5`가 `meta.source="formula-api"`와 스냅샷 산식 fallback reason을 반환하는지 확인.
- 표지 프록시(`/api/cover?u=...`)가 이미지를 반환하거나 안전하게 폴백하는지 확인.
- 로그인/리뷰/커뮤니티 기능이 DB 연결로 동작하는지 확인.

## 6. Studio 실시간 권위와 선택형 Socket.IO 폴백

현재 ephemeral realtime production 권위는 Cloudflare Durable Objects `workers.dev`
origin입니다. `realtime.toonstudio.cloud`는 DNS zone·custom hostname·TLS가 완료되기 전에
사용하지 않습니다. Cloudflare는 presence, comment invalidation, screen-share signaling을
역할별 ticket으로 처리하며 raster pixel, 작품 ACL, 음성 media 권위가 아닙니다.

아래 Render/Socket.IO 경로는 CRDT fanout·lock에 별도 long-running Nest host가 필요할
때의 선택형 폴백입니다. 현재 Cloudflare 권위를 무시하고 자동 활성하지 않습니다.

`render.yaml`의 Nest 프로세스는 전체 모듈 그래프를 재사용하지만
`API_RUNTIME_ROLE=studio-live`가 공개 표면을 다음으로 제한합니다.

- `GET /api/health/live`, `GET /api/health/ready`: 운영 probe
- `/socket.io`: Studio 실시간 협업 연결
- 그 밖의 `/api/*`: 일반 API로 처리하지 않음

따라서 `vercel.json`의 `/api/:path*` rewrite나 `VITE_API_BASE`를 Render origin으로 바꾸면
안 됩니다. 검색·인증·ACL·리뷰·커뮤니티 등 일반 HTTP 요청은 계속 Vercel `/api/*`를 사용하고,
프런트에는 Socket.IO 전용 `VITE_STUDIO_LIVE_ORIGIN`만 별도로 지정합니다.

### 실시간 협업 Socket.IO를 별도 장기 실행 서버에 배포할 때

Vercel serverless 진입점은 WebSocket 수명주기를 유지하지 않으며 PostgreSQL Socket.IO adapter도
장착하지 않습니다. SPA의 HTTP API가 Vercel에 남아 있어도 실시간 협업만 OCI/Render/Fly의 Nest
서버로 보낼 수 있도록 프런트 빌드에 별도 origin을 지정합니다.

```env
# Vite 빌드 시 공개되는 값 — 경로가 아닌 https origin
VITE_STUDIO_LIVE_ORIGIN=https://realtime.toonstudio.cloud

# 장기 실행 Nest 서버의 비공개 환경변수
STUDIO_LIVE_CLUSTER_ADAPTER=postgres
STUDIO_LIVE_POSTGRES_URL=postgresql://USER:PASSWORD@DIRECT_HOST/toonspectrum?sslmode=verify-full&channel_binding=require
STUDIO_LIVE_POSTGRES_POOL_MAX=2
API_CORS_ALLOWED_ORIGINS=https://www.toonstudio.cloud,https://toonstudio.cloud

# 검증된 원형 펜 래스터 CRDT 파일럿 — 프런트/서버를 같은 릴리스에서 함께 활성화
VITE_STUDIO_RASTER_CRDT_AUTO_PUBLICATION=verified-renderer-handoff-v1
STUDIO_RASTER_ASSET_ADMISSION=verified-renderer-handoff-v1
```

프로세스를 트래픽에 연결하기 전에 numbered SQL migration 전체를
`scripts/production-database-migrations.manifest` 순서로 적용해야 합니다. `0023`의
`toonspectrum_ops.deployment_migration` 원장은 각 파일의 SHA-256 checksum과 적용 상태를 보존해
이미 적용한 과거 constraint/index migration을 다음 release에서 다시 실행하지 않습니다. 운영 DB의
기본 경로는
[production-database-migrations.yml](.github/workflows/production-database-migrations.yml)
수동 실행입니다. 저장소 `production-database` Environment에 required reviewer와
`PRODUCTION_DATABASE_DIRECT_URL` secret, `PRODUCTION_RUNTIME_DATABASE_ROLE` variable을 설정하고,
검토한 정확한 40자리 release SHA와 확인 문구를 입력합니다. direct URL의 사용자는 DDL 전용
migrator이고 variable은 Vercel/Render 앱이 실제 사용하는 별도 최소권한 PostgreSQL role입니다.
두 role이 같거나 runtime role이 migrator를 상속하면 runner가 DDL 전에 거부합니다. runtime
role은 `LOGIN`, 현재 DB `CONNECT`, `public` schema `USAGE`가 있어야 하며 superuser/CREATEROLE이면
안 됩니다. CREATEDB/REPLICATION/BYPASSRLS 같은 elevated role flag도 허용하지 않습니다.

secret은 credentialed direct endpoint여야 하며 query에는
`sslmode=verify-full&channel_binding=require`만 허용합니다. URL parser는 protocol·authority·
canonical effective hostname을 확인하고, pooler/pgbouncer hostname 및 `host`, `hostaddr`,
`service`, `port`, `user`, `dbname`, `options` 같은 libpq override를 거부합니다. DB secret은
checkout/action이 아니라 URL 검증·migration·capability 검증 step에만 주입됩니다.
runner는 runtime role에서 `toonspectrum_ops` schema와 ledger/lock table의 모든 권한을 회수하고,
최종 verifier는 runtime role이 해당 객체의 owner가 아니며 `USAGE`/`CREATE` 및
`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` 권한을 갖지 않는지
구조적으로 재확인합니다.

이 검사는 ops 원장을 앱에서 격리하는 release boundary이며 product DML 권한을 자동으로
과다 부여하지 않습니다. 인프라 준비 단계에서 runtime role에 현재 API가 사용하는 public
relation/sequence의 필요한 `SELECT`/`INSERT`/`UPDATE`/`DELETE`만 별도 GRANT하고, 실제 runtime
`DATABASE_URL` 세션의 `SELECT current_user`가 `PRODUCTION_RUNTIME_DATABASE_ROLE`과 exact
match하는지 required reviewer가 먼저 확인해야 합니다. dummy role 이름으로 ops ACL gate를
대리 통과시키면 안 됩니다. 이어서 같은 runtime 연결로 `/api/health/ready`, 로그인, 저장, 협업,
댓글, Marketplace publish canary를 통과시켜야 합니다. 이 identity+DML canary가 끝나지 않으면
migration이 성공해도 runtime release는 승인하지 않습니다.

workflow mode는 다음처럼 분리됩니다.

- `adopt` + `ADOPT-TOONSPECTRUM-MIGRATION-HISTORY`: 기존 무원장 DB가 reviewed production
  baseline인 0019까지 실제 도달했는지 relation·constraint/index·0017 cutover marker로 먼저
  증명합니다. 증명된 0001~0019는 SQL을 재실행하지 않고 exact checksum과 `adopted` provenance를
  기록하며, 0020~0022와 0024~0025를 genuine pending으로 실행하고 0023 bootstrap을 기록합니다.
- `apply` + `APPLY-TOONSPECTRUM-PRODUCTION-MIGRATIONS`: 원장 이후 새 pending migration만
  실행합니다. 과거 migration은 checksum만 확인하고 건너뜁니다.
- `repair` + `REPAIR-TOONSPECTRUM-MIGRATION-STATE`: 원인을 확인한 운영자가 중단된
  `applying`/`failed` 상태와 stale runner lock을 명시적으로 복구할 때만 사용합니다. 원장이
  없거나 누락된 history/pending row에는 사용할 수 없으므로 adoption/apply의 우회 경로가
  아닙니다. durable lock이 있으면 DB 원장에서 확인한 exact 64자리 `ownerToken`을
  `stale_lock_owner_token` input으로 함께 전달해야 하며, DB 획득 시각이 60분 이상 지난 lock만
  같은 token을 조건으로 원자적 compare-and-delete합니다. 신선한 lock이나 token 불일치는
  fail-closed입니다.

workflow는 production DDL concurrency를 1로 고정하고 manifest가 모든 numbered migration과
정확히 일치하는지 확인합니다. 끝에서는 현재 API health-readiness가 요구하는 relation 전체,
comment reanchor, Marketplace generated search/GIN opclass, `pg_trgm`, `0017` cutover marker,
manifest checksum 원장과 runner-lock 해제를 구조적으로 검증합니다. 이미 provision된 운영 DB
upgrade 전용이므로 base relation이 없으면 DDL 전에 실패하며, 새 production DB bootstrap은 별도
승인 작업으로 먼저 완료해야 합니다. 앱의 build/start/health 명령에서는 DDL이나
`drizzle-kit push`를 실행하지 않습니다.

Vercel production은 `origin/main` push에 자동 배포됩니다(2026-08-14 소유자 결정). **2026-09-02부터
`main`은 브랜치 보호로 PR 전용이며 CI의 `core` 체크(lint·typecheck·마이그레이션 채택·전체 Vitest·빌드 게이트)
성공이 머지 조건**입니다. 2026-09-05부터 `core`는 그 검사들을 직접 돌리는 잡이 아니라 병렬 잡
`lint`·`typecheck`·`build`·`test (1/3..3/3)`·`test (serial lane)`의 결과를 합치는 게이트 잡입니다 — 검사 항목은
같고 배치만 바뀌었으며, 필수 체크 이름 `core`는 그대로입니다. 릴리스 체크 `verify`는 같은 다섯 잡과
`studio-3d-runtime`(3D 런타임 오라클)을 직접 합칩니다 — 판정은 `core` + 3D 증명과 같고, `core` 잡의 러너
배정을 한 번 더 기다리지 않습니다. 적색 커밋은 PR 경로로는 main에 들어가지 못하므로 배포되지 않습니다 — "적색 main도
배포되는 구조"를 배포 경로가 아니라 머지 경로에서 막은 것입니다(Vercel CLI 배포 시크릿이 저장소에 없어
`workflow_run` 게이트는 쓸 수 없었습니다). 정책은 저장소 표준과 같습니다: 승인 0명, `strict=false`(base 최신화
강제 없음), `enforce_admins=false`, 강제 push·삭제 금지. **예외는 하나 — 관리자(소유자)는 PR·`core` 요구를 우회해
직접 push하거나 `--admin` 머지할 수 있습니다.** 이는 게이트 자체가 깨졌을 때를 위한 잠금 사고 방지 탈출구이며,
우회한 커밋은 그대로 배포되므로 반드시 PR이나 커밋 본문에 이유를 남기고 다음 PR에서 core를 다시 녹색으로 돌려야
합니다.
`studio-3d-visual`·`studio-inapp-browser`는 러너 환경 의존이 커서 필수 체크에 넣지 않았습니다. 이전에는
`vercel.json`의 `ignoreCommand`가 `TOONSPECTRUM_APPROVED_PRODUCTION_SHA`와 커밋 SHA의 exact
match를 요구해 릴리스마다 승인 SHA를 수동 회전해야 했습니다. 그 승인 단계는 제거했고, 대신
**migration을 동반하는 release는 반드시 expand/contract 2회 merge로 나눠야 합니다.** 이유는 두 제약이
서로 맞물려 있기 때문입니다. `production-database-migrations.yml`은 release SHA가 **이미
`origin/main`의 ancestor일 것**을 요구하고(ancestor 아니면 즉시 실패), main merge는 곧 배포입니다.
따라서 DDL은 언제나 **새 runtime이 이미 떠 있는 뒤에만** 실행할 수 있습니다. "merge 전에 migration을
끝낸다"는 순서는 이 workflow로 실행이 불가능하므로, 새 runtime은 반드시 **구 schema에서도 동작해야**
합니다.

migration을 동반하는 release 순서는 다음과 같습니다. Render는 `autoDeployTrigger: off`를 유지합니다.

1. reviewed release commit SHA를 확정합니다. 이 커밋의 runtime은 **구/신 schema 양쪽에서 동작하는
   backward-compatible(expand) 단계**여야 합니다 — 새 컬럼·테이블은 optional로 읽고, 없으면 기존
   경로로 동작해야 합니다. 이 조건을 만족하지 못하면 merge하지 않습니다.
2. expand 커밋을 main에 merge합니다. 배포가 따라오지만 구 schema에서 정상 동작합니다.
3. 기존 DB upgrade라면 현재 Studio writer를 모두 drain하고 이전 binary가 새 mutation을 받지
   않는지 확인합니다. 특히 `0017` 최초 cutover와 최초 `adopt`에는 이 단계가 필수입니다.
4. workflow를 **merge된 그 SHA로** 실행합니다(이제 ancestor 조건을 만족합니다).
   `NO-STUDIO-WRITERS`를 입력하고, 최초 원장 채택은 `adopt`, 이후는 `apply`를 선택합니다.
   base schema가 완전히 provision되지 않은 DB는 거부되며 이 workflow를 새 DB bootstrap 수단으로
   사용하지 않습니다.
5. migration과 full capability verification이 성공한 뒤 Cloudflare Worker·Render realtime canary를
   같은 SHA 기준으로 완료합니다.
6. 그 다음에 **contract 단계**(구 schema 호환 경로 제거, 필요하면 컬럼 drop migration)를 별도 커밋으로
   merge합니다. 이 단계는 구 binary가 모두 사라진 뒤에만 안전합니다.

expand 단계로 나눌 수 없는 변경(같은 커밋에서 구 schema를 반드시 깨야 하는 경우)은 자동배포와 양립하지
않습니다. 그 경우 Vercel 대시보드에서 production 배포를 일시 중지하고 수동 순서로 처리한 뒤 재개하십시오
— 이제 그것을 대신 막아 주는 repository gate는 없습니다.

migration·realtime 계약을 건드리지 않는 순수 프론트엔드 release는 1~4단계에 해당 대상이 없으므로
바로 merge하면 됩니다. 반대로 schema나 realtime 계약을 바꾸는 커밋을 canary 없이 main에 올리면
새 runtime이 DB보다 먼저 뜰 수 있다는 위험은 그대로이며, 이제 그것을 막아 주는 자동 장치는 없습니다.

PostgreSQL adapter는 listener와 publisher를 동시에 확보하기 때문에 풀 최솟값이 2이며, `pooler`
호스트나 PgBouncer transaction endpoint는 사용할 수 없습니다. 원격/운영 URL은
`sslmode=verify-full`과 `channel_binding=require`를 각각 정확히 한 번 명시해야 합니다. URL
query는 node-postgres/libpq 해석이 authority·credential·routing을 덮어쓰지 못하도록 이 두 키
외에는 허용하지 않으며, 평문 연결은 production이 아닌 명시적 loopback 테스트 모드에만
허용됩니다. 부팅
사전검사는 별도 세션의 nonce `pg_notify`가 실제 listener에
도착하는지, attachment 임시 행의 `INSERT → SELECT(bytea) → DELETE` 권한과 롤백 정리를 확인한 뒤에만
트래픽을 받습니다.

애플리케이션은 `@socket.io/postgres-adapter`의 cluster/heartbeat semantics를 사용하되, 패키지의
fire-and-forget PubSub lifecycle은 사용하지 않습니다. 로컬 transport가 `/`와 `/studio-live`의 실제
`LISTEN` 완료를 기다린 뒤에만 ready를 기록하고, 동적 namespace 실패나 연결 단절 시 checked-out
client를 폐기한 후 전체 채널을 재구독합니다. 종료는 pending connect/init과 진행 중 작업을 회수하고
PubSub listener를 닫은 다음 pool을 닫습니다. 장기 실행 서버에는 그래도 프로세스 재시작 정책과
교차 노드 broadcast/RPC 모니터링을 두고, adapter 버전 변경 시 CI의 2-node integration을 재검증하세요.

래스터 CRDT의 두 토큰은 비밀이 아니라 정확한 운영 opt-in입니다. 둘 중 하나라도 누락되면 원형 펜
자동 타일 게시가 실행되지 않으며 기존 Yjs 벡터 원본이 계속 화면·내보내기의 권위가 됩니다. 활성화한
배포에서는 먼저 실제 PostgreSQL migration과 래스터 에셋 업로드 권한을 확인하고, 두 브라우저에서
동일 획의 `append → broadcast → replay → handoff`와 스크롤·내보내기 즉시 벡터 복구를 점검하세요.

### Render 무료 Blueprint와 운영 승격 게이트

현재 `render.yaml`의 `plan: free`는 미리보기·저비용 검증 전용입니다. Render 무료 web service는
production 용도가 아니며 다음 제약이 Studio realtime authority와 맞지 않습니다
([Render Free 공식 문서](https://render.com/docs/free)).

- inbound HTTP 요청이나 기존 WebSocket의 메시지가 15분 동안 없으면 spin down하고, 다음 요청의
  cold start는 약 1분 걸릴 수 있습니다.
- workspace 전체에서 월 750 free instance-hours를 소진하면 다음 달까지 무료 서비스가
  suspend될 수 있습니다.
- 단일 인스턴스만 허용되어 수평 확장과 다중 인스턴스 장애 검증을 할 수 없습니다.
- 무료 web service에는 `preDeployCommand`를 설정할 수 없습니다.

그러므로 무료 Render origin을 production realtime 권위 서버나 SLA 경로로 승격하지 않습니다.
production 출시 전에는 유료 always-on Render web service 또는 동등한 상시 구동·WebSocket 지원
호스트를 확보하고, direct PostgreSQL 연결·health probe·재시작 정책·교차 노드 integration을 다시
검증해야 합니다. 이 인프라 승격이 끝나지 않으면 realtime 기능의 production release gate는
통과하지 않은 것입니다.

Render의 [pre-deploy command](https://render.com/docs/deploys#pre-deploy-command)는 유료 web
service에서 build 이후, 새 버전 시작 이전에 별도
인스턴스로 실행되며 실패하면 새 배포를 중단하고 마지막 성공 버전을 유지하므로 migration 경계로
사용할 수 있습니다. 다만 운영에서는 아래 두 DDL writer 중 **정확히 하나만** 선택합니다.

1. 기본: GitHub의 승인형
   [production-database-migrations.yml](.github/workflows/production-database-migrations.yml)을
   먼저 실행하고 구조 검증 성공 후 Render release를 승인합니다.
2. 유료 Render 대안: 동일한 checksum-led runner의 `apply`와 full capability verifier를
   `preDeployCommand`에서 실행하고 GitHub migration 실행 경로는 사용하지 않습니다. 해당 Render
   service만 sole writer여야 하며 자동 `drizzle-kit push`, start-command migration, 다른 호스트의
   pre-deploy를 모두 금지합니다. 최초 `adopt`나 `repair`는 pre-deploy 자동 경로에서 실행하지
   않습니다.

현재 무료 Blueprint에는 지원되지 않는 `preDeployCommand`를 일부러 넣지 않았습니다. 유료 플랜
전환과 DDL writer 변경은 비용·운영 경계를 바꾸므로 별도 리뷰에서 함께 승인해야 합니다.
