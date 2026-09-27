# 같이 개발하기

H Place 매장관리(`salon/`)를 함께 개발하는 분을 위한 안내입니다. 설치·배포 전체 설명은 [`salon/README.md`](salon/README.md)에 있습니다.

## 1. 시작하기 (10분)

1. 저장소 관리자에게 GitHub 초대를 받고 수락합니다.
2. 코드를 받아 테스트를 실행합니다. Node 22.18 이상이 필요합니다.

   ```bash
   git clone https://github.com/bkkim0728/H_Place_Inventory_Mgmt.git
   cd H_Place_Inventory_Mgmt/salon
   npm install
   npm test          # DB 302 passed · admin-users 23 passed
   ```

3. 앱을 데모 모드로 띄웁니다. Supabase 없이 브라우저 저장소만 씁니다.

   ```bash
   cd web
   python3 -m http.server 8000   # http://localhost:8000
   ```

   화면 위쪽 **역할 보기**로 전체 관리자·지점 관리자·직원 화면을 바꿔 볼 수 있습니다.

Claude Code로 작업한다면 claude.ai에서 GitHub를 연결하고 이 저장소를 골라 세션을 시작하세요. 저장소 맨 위의 `CLAUDE.md`를 읽고 같은 규칙으로 작업합니다.

## 2. 브랜치와 배포

| 브랜치 | 용도 |
| --- | --- |
| `Inventory` | **운영 배포 브랜치.** 여기에 올라가면 Render가 바로 실제 앱에 배포합니다. 직접 push하지 않습니다. |
| `claude/magical-johnson-wkzcch` | 현재 주 개발 브랜치 (PR #1) |
| 내 작업 브랜치 | `이름/기능` 형식으로 새로 만듭니다. 예: `minsu/sns-calendar` |

작업 순서:

1. 최신 개발 브랜치에서 내 브랜치를 만듭니다.
2. 작업하고 `npm test`가 모두 통과하는지 확인합니다.
3. PR을 열고 무엇을, 왜 바꿨는지와 화면 캡처를 붙입니다.
4. 리뷰를 받고 병합한 뒤, 저장소 관리자가 `Inventory`에 반영합니다.

## 3. 꼭 지킬 것

- **비밀 값은 저장소에 넣지 않습니다.** Supabase `service_role` 키, 관리자 비밀번호, 실제 고객 정보는 커밋·PR·이슈·채팅 어디에도 쓰지 않습니다. `anon` 키는 공개용이라 괜찮습니다.
- **DB 변경은 `salon/supabase/schema.sql` 한 파일에서** 합니다. 여러 번 실행해도 안전해야 하고(`if not exists`, `create or replace`), 기존 설치를 업그레이드할 수 있어야 합니다. 바꾸면 PR 설명에 "Supabase에서 schema.sql 다시 실행 필요"라고 적습니다.
- **쓰기는 DB 함수(RPC)로만** 합니다. 테이블에 직접 insert/update하는 정책을 열지 않고, 권한은 함수 안에서 검사합니다.
- **데이터 정리 스크립트는 지정한 지점만** 건드려야 합니다. 다른 지점에 영향이 가면 안 됩니다. `reset_branch_for_launch.sql`처럼 다른 지점 데이터의 지문을 비교해서, 달라지면 롤백하는 방식을 따릅니다.
- **새 기능에는 테스트를 추가합니다.** DB 규칙은 `salon/tests/db.test.mjs`에 넣습니다.
- 화면 문구는 한국어로 씁니다. PC(1440px)와 휴대폰(375px)에서 가로 스크롤이 생기지 않는지 확인합니다.

## 4. 코드 둘러보기

| 파일 | 내용 |
| --- | --- |
| `salon/web/index.html` | 모든 화면과 대화상자 |
| `salon/web/app.js` | 화면 동작 (해시 라우팅 `#/stock`, `#/sns` …) |
| `salon/web/data.js` | 데이터 계층. Supabase API와 데모 모드 API가 같은 모양으로 들어 있습니다. |
| `salon/web/app.css` | 스타일 |
| `salon/web/trends/` | SNS 트렌드 주간 보고서 JSON (형식: `trends/README.md`) |
| `salon/supabase/schema.sql` | 테이블, RLS, 함수, Storage 정책 |
| `salon/tests/` | PGlite DB 테스트, Edge Function 테스트 |

새 기능을 넣을 때는 대개 `schema.sql`(함수) → `data.js`(Supabase + 데모 양쪽) → `index.html`/`app.js`(화면) → 테스트 순서로 작업합니다.
