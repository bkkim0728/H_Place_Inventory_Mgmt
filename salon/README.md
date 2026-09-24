# H Place 살롱 재고관리 — 프로토타입

헤어살롱 1개 지점의 재고를 관리하는 웹 앱입니다. 12개 지점으로 넓히는 것을 전제로 설계했습니다.

- **화면**: 정적 웹 앱 (`web/`) → Render Static Site (무료)
- **데이터·로그인**: Supabase (Postgres + Auth + Edge Function 1개, 무료 플랜)
- **코드**: GitHub

Supabase를 연결하지 않으면 **데모 모드**로 실행됩니다. 샘플 데이터가 브라우저에만 저장되어서 설치 없이 화면과 흐름을 확인할 수 있고, 화면 위쪽 **역할 보기**로 전체 관리자·지점 관리자·직원 화면을 바꿔 볼 수 있습니다.

## 기능

| 화면 | 내용 |
|---|---|
| 대시보드 | 관리 품목 수, 재고 금액(매입가), 재고 부족·품절 수, 입고·출고 추이 그래프, 발주 필요 목록, 최근 입출고 |
| 재고 목록 | 검색, 카테고리·상태 필터, 정렬, 품목별 입출고 등록 |
| 입출고 내역 | 기간·구분·검색 필터, 등록 취소 |
| 품목 관리 | 전체 관리자: 공용 품목 추가·수정 · 지점 관리자: 자기 지점 안전재고·보관 위치 |
| 사용자 관리 | 전체 관리자: 사용자 추가(아이디·비밀번호 발급), 아이디·이름·역할·지점·사용 여부·비밀번호 수정 · 지점 관리자: 자기 지점 사용자의 역할·사용 여부 |
| 지점 관리 | 전체 관리자: 지점 추가·수정·운영 중지 · 지점 관리자: 자기 지점 이름·연락처·주소 |

**입출고 구분**: 입고 · 시술 사용 · 판매 · 폐기 · 재고 실사(지점 관리자 이상, 실제 센 수량으로 맞춤)

## 권한 체계

| | 전체 관리자 (`admin`) | 지점 관리자 (`manager`) | 직원 (`staff`) |
|---|---|---|---|
| 지점 | 추가·수정·운영 중지 (전 지점) | 자기 지점 이름·연락처·주소 수정 | — |
| 사용자 | 사용자 추가, 모든 사용자의 아이디·이름·역할·지점·사용 여부·**비밀번호** 수정 | 자기 지점 사용자의 이름·역할(직원↔지점 관리자)·사용 여부, 지점에서 제외 | — |
| 품목 | 공용 품목 목록 추가·수정 | 자기 지점 안전재고·보관 위치 | — |
| 재고 | 전 지점 (상단에서 지점 선택) | 자기 지점, 재고 실사, 모든 기록 취소 | 자기 지점 입고·사용·판매·폐기, 본인 기록 10분 안 취소 |

**계정은 전체 관리자가 만듭니다.** 가입 화면은 없습니다.

1. 전체 관리자가 **사용자 관리 → 사용자 추가**에서 아이디, 이름, 비밀번호, 역할, 지점을 정합니다. **자동 생성** 버튼으로 읽기 쉬운 10자 비밀번호를 만들 수 있습니다.
2. 아이디와 비밀번호를 본인에게 전달하면, 로그인 화면에서 **아이디**로 바로 로그인합니다.
3. 비밀번호를 잊으면 전체 관리자가 **사용자 관리 → 수정 → 비밀번호 재설정**에서 새 비밀번호를 정해 줍니다.

아이디는 내부적으로 `<아이디>@hplace.local` 이메일 계정입니다. 아이디를 바꾸면 이 이메일도 함께 바뀝니다.

**잠김 방지 규칙**: 누구도 자기 자신의 역할·지점·사용 여부를 바꿀 수 없고(아이디·이름·비밀번호는 바꿀 수 있음), 마지막 전체 관리자는 강등하거나 중지할 수 없습니다. 사용 중지된 계정은 로그인해도 아무것도 볼 수 없습니다.

모든 규칙은 화면이 아니라 **DB 함수와 RLS**, 그리고 **Edge Function**에서 검사합니다. 화면을 조작해도 권한 밖의 작업은 거부됩니다.

**왜 Edge Function이 필요한가요?** 다른 사람의 계정을 만들거나 비밀번호를 바꾸려면 Supabase의 `service_role` 키가 필요합니다. 이 키는 모든 보안을 우회하므로 브라우저에 두면 안 됩니다. [`supabase/functions/admin-users`](supabase/functions/admin-users/index.ts)는 Supabase 안에서 실행되며, 요청한 사람이 **사용 중인 전체 관리자인지 확인한 뒤에만** 계정 생성·아이디 변경·비밀번호 변경을 합니다. 키는 함수 밖으로 나가지 않습니다.

## 데이터 설계

```
branches ─┬─ profiles (사용자 ↔ 아이디·지점·역할·사용 여부)
          ├─ inventory (지점별 현재고·안전재고·위치) ── products (전 지점 공용 품목)
          └─ stock_movements (모든 재고 변동 기록)
```

- 모든 테이블에 **Row Level Security**를 적용해서 사용자는 배정된 지점의 데이터만 봅니다.
- 앱은 테이블을 직접 수정할 수 없습니다. 모든 변경은 역할을 검사하는 DB 함수(`record_movement`, `revert_movement`, `save_product`, `set_branch_item`, `save_branch`, `update_user`, `list_users`)와 `admin-users` Edge Function으로만 합니다. 그래서 재고 변동은 **모두 기록**되고 재고가 0 밑으로 내려가지 않습니다.
- 취소는 기록을 지우지 않고 **반대 기록을 추가**합니다. 이력은 수정되지 않습니다.
- 지점 간 이동(`transfer_in` / `transfer_out`)은 다음 단계를 위해 자리만 만들어 두었습니다.

## 설치 순서

### 1. Supabase 프로젝트 만들기

1. <https://supabase.com> 에서 가입 후 **New project**를 만듭니다. 지역은 `Northeast Asia (Seoul)`을 권장합니다.
2. 왼쪽 메뉴 **SQL Editor**에서 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여 넣고 **Run**을 누릅니다.
3. 이어서 [`supabase/seed.sql`](supabase/seed.sql)을 실행합니다. 1호점과 샘플 품목 30개, 14일치 샘플 입출고가 들어갑니다. (실제 운영 전에는 생략하거나 품목을 바꿔서 실행하세요.)
4. **Authentication → Sign In / Providers → Email**에서 **Allow new users to sign up**을 **끕니다**. 계정은 전체 관리자만 만듭니다.
5. **Edge Functions → Deploy a new function → Via Editor**에서 함수를 만듭니다.
   - 이름: `admin-users` (정확히 이 이름)
   - 코드: [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts) 전체를 붙여 넣고 **Deploy**
   - **Verify JWT**는 켜 둡니다 (기본값). 로그인한 사용자만 호출할 수 있습니다.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 자동으로 넣어 주므로 따로 설정하지 않습니다.
   - 아이디 도메인을 `hplace.local`이 아닌 값으로 쓰면 **Edge Functions → Secrets**에 `LOGIN_DOMAIN`을 같은 값으로 추가합니다.

   CLI를 쓴다면 `supabase functions deploy admin-users`로도 배포할 수 있습니다.

### 2. 첫 전체 관리자 만들기 (한 번만)

로그인 화면은 **아이디** 또는 이메일을 받습니다. 아이디 `h001`은 내부적으로 `h001@hplace.local` 계정으로 로그인합니다. (도메인은 Render 환경 변수 `LOGIN_DOMAIN`으로 바꿀 수 있습니다.)

1. **Authentication → Users → Add user → Create new user**
   - Email: `h001@hplace.local`
   - Password: 사용할 비밀번호 (이 저장소에는 비밀번호를 적지 않습니다. 6자 이상)
   - **Auto Confirm User** 체크 — 실제로 없는 메일 주소라 인증 메일을 받을 수 없습니다.
2. **SQL Editor**에서 전체 관리자로 지정합니다.

```sql
update public.profiles
   set role = 'admin', branch_id = null, login_id = 'h001', full_name = '본사 관리자'
 where user_id = (select id from auth.users where email = 'h001@hplace.local');
```

3. 앱 로그인 화면에서 아이디 `h001`과 비밀번호로 로그인합니다.

> **비밀번호 권장**: 전체 관리자는 모든 지점의 데이터와 사용자를 바꿀 수 있고 사이트는 인터넷에 공개됩니다. 숫자만 6자리인 비밀번호는 추측 공격에 약하니, 운영 전에는 영문·숫자·기호를 섞은 12자 이상으로 바꾸세요. 로그인한 뒤 **사용자 관리 → 내 계정 수정 → 비밀번호 재설정**에서 바꿀 수 있습니다.

> Supabase가 `hplace.local` 주소를 받지 않으면 회사가 가진 도메인(예: `hplace.co.kr`)으로 계정을 만들고 Render 환경 변수와 Edge Function Secret의 `LOGIN_DOMAIN`을 같은 값으로 설정하세요.

이후 사용자는 모두 앱의 **사용자 관리 → 사용자 추가**로 만듭니다.

### 3. Render에 배포하기

**Render → New → Static Site**에서 이 저장소를 연결하고 아래처럼 설정합니다.

| 항목 | 값 |
|---|---|
| Branch | 배포할 브랜치 |
| Build Command | `node salon/scripts/build-config.mjs` |
| Publish Directory | `salon/web` |
| Environment | `SUPABASE_URL` = Project URL, `SUPABASE_ANON_KEY` = anon public key, (선택) `LOGIN_DOMAIN` = 아이디 로그인용 도메인, 기본 `hplace.local` |

두 값은 Supabase **Project Settings → API**(또는 **Connect**)에서 확인합니다. anon key는 브라우저에 공개되도록 만들어진 키이고 데이터는 RLS로 보호됩니다. **`service_role` 키는 절대 넣지 마세요.**

환경 변수를 비워 두면 데모 모드로 배포됩니다.

### 4. 로컬에서 실행하기

```bash
cd salon/web
python3 -m http.server 8000   # http://localhost:8000
```

Supabase에 연결하려면 `web/config.js`에 URL과 anon key를 넣습니다. (배포 시에는 빌드 명령이 이 파일을 환경 변수로 다시 만듭니다.)

## 파일 구조

```
salon/
├── README.md
├── supabase/
│   ├── schema.sql          테이블, RLS, 함수, 뷰 (여러 번 실행해도 안전)
│   ├── seed.sql            1호점 샘플 데이터
│   └── functions/
│       └── admin-users/    계정 생성·아이디 변경·비밀번호 변경 (Edge Function)
├── scripts/
│   └── build-config.mjs    Render 빌드 시 config.js 생성
├── tests/
│   ├── db.test.mjs         DB 권한·재고 규칙 테스트 (PGlite)
│   └── admin-users.test.mjs  Edge Function 로직 테스트
└── web/                    배포되는 정적 파일
    ├── index.html
    ├── styles.css          공용 디자인 (재고 대시보드와 동일)
    ├── app.css             이 앱 전용 스타일
    ├── config.js           Supabase 연결 정보 (비어 있으면 데모 모드)
    ├── data.js             데이터 계층 (Supabase / 데모)
    ├── app.js              화면 로직
    ├── fonts/              Paperlogy (SIL OFL 1.1)
    └── vendor/             supabase-js 2.117.1 (MIT)
```

## 다음 단계 (12개 지점 확장)

- 지점 간 재고 이동 (`transfer_in` / `transfer_out`)
- 본사용 전 지점 비교 대시보드
- 발주서 작성·거래처 관리
- 유통기한·로트 관리 (염모제, 펌제)
- 비밀번호 변경 이력, 첫 로그인 시 비밀번호 변경 강제

## 테스트

DB 설계(권한, 재고 규칙, 샘플 데이터 정합성)는 PGlite(WASM Postgres)로, Edge Function은 가짜 Supabase 객체로 검증합니다. Node 22.18 이상이 필요합니다(TypeScript를 그대로 실행).

```bash
cd salon
npm install
npm test   # DB 81 passed · admin-users 23 passed
```
