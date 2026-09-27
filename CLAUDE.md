# CLAUDE.md

H Place 매장관리 앱. 개발 규칙 전체는 `CONTRIBUTING.md`, 설치·기능은 `salon/README.md`를 따른다.

- 사용자와는 한국어로 대화하고, 화면 문구도 한국어로 쓴다.
- 앱은 `salon/web`의 빌드 없는 정적 HTML/CSS/JS이고, 백엔드는 Supabase(Postgres + RLS + RPC + Storage)다.
- 변경 후 `cd salon && npm test`를 실행해 모두 통과시킨다. DB 규칙을 바꾸면 `salon/tests/db.test.mjs`에 테스트를 추가한다.
- DB 변경은 `salon/supabase/schema.sql`에만, 여러 번 실행해도 안전하게 쓴다. 쓰기는 security definer 함수로만 하고 권한은 함수 안에서 검사한다.
- `data.js`에 API를 추가할 때는 Supabase 구현과 데모 모드 구현을 둘 다 만든다.
- 지점 데이터를 지우거나 고치는 SQL은 대상 지점만 건드려야 하며, 다른 지점 데이터가 바뀌면 롤백되게 만든다.
- `service_role` 키, 비밀번호, 실제 고객 정보는 저장소·커밋·PR에 절대 넣지 않고, 사용자에게 보내 달라고 요청하지도 않는다.
- `Inventory` 브랜치는 Render 운영 배포 브랜치다. 사용자가 명시적으로 요청하지 않으면 push하지 않는다.
- UI 확인은 `python3 -m http.server`로 `salon/web`을 띄우고 데모 모드('역할 보기'로 세 역할 전환)에서, 1440px과 375px 모두 확인한다.
