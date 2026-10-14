# 검증 재실행

저장소 루트에서 실행합니다. 운영 DB 연결이나 배포는 하지 않습니다.

```sh
npm ci --prefix review
npm run sql --prefix review
npm run regressions --prefix review
npx --prefix review playwright install chromium
npm run browser --prefix review
```

- `run-sql.mjs`: PR 원본 `825ae54ebaaa27bad95632c76304cee2d4c4787c`와 현재 작업 파일의 기존 SQL 테스트 3개를 각각 새 PGlite DB에서 실행합니다. Git에 원본 커밋이 있어야 합니다. 필요시 `BASELINE_REF`로 기준 커밋을 지정합니다.
- `run-regressions.mjs`: 원본에서 회귀검사 실패를 재현하고 수정본에서는 14개 검사가 모두 통과해야 합니다. 기존 테스트와 같은 세션에서 실행해야 하는 `review-regressions.sql`을 사용합니다.
- PGlite 0.5.10은 PostgreSQL 18.6 WASM입니다. 실제 PostgreSQL 16/Supabase 또는 다중 세션 검증을 대체하지 않습니다. psql의 `ON_ERROR_STOP`과 `\gset`만 어댑터가 처리하고 날짜는 문자열로 유지해 마이크로초를 보존합니다.
- 브라우저 검증은 Playwright, 실제 HTML/CSS/JS, 격리 PGlite의 RLS/RPC를 사용합니다. `browser-adapter.js`가 Supabase 전송 계층을 대체하며 가입 인증·메일·비밀번호·JWT·PostgREST 관계 해석을 검증하지 않습니다. 외부 네트워크 요청은 차단합니다. 가입 메타데이터만 모의 인증을 거쳐 auth.users에 넣습니다.
- Chromium 실행 파일을 따로 사용할 경우 `CHROMIUM_PATH`, Playwright 모듈 경로는 `PLAYWRIGHT_MODULE`, PGlite 모듈 디렉터리는 `REVIEW_MODULES`로 지정할 수 있습니다. 기본값은 설치된 review 의존성입니다. 한국어 글꼴이 있는 환경에서 실행하세요.
- 결과와 화면 캡처는 `review/evidence/`에 생성되며 Git에서는 제외됩니다.

네이티브 PostgreSQL 16에서는 빈 로컬 DB마다 아래 순서로 psql을 실행하세요. 세 기존 테스트는 각각 새 DB를 사용해야 하며, 회귀검사는 samplo 테스트와 같은 psql 세션에서 실행합니다.

```sh
psql -v ON_ERROR_STOP=1 "$DISPOSABLE_DATABASE_URL" \
  -f supabase/test/supabase-stub.sql -f supabase/schema.sql \
  -f supabase/billing.sql -f supabase/samplo.sql \
  -f supabase/test/samplo.sql -f supabase/test/review-regressions.sql
```

`audit-live-readonly.sql`은 실제 DB의 RLS/ACL을 확인하기 위한 읽기 전용 자료입니다. 이 검토에서는 운영 DB에 실행하지 않았습니다.
