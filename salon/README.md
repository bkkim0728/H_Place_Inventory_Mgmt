# H Place 살롱 재고관리 — 프로토타입

헤어살롱 1개 지점의 재고를 관리하는 웹 앱입니다. 12개 지점으로 넓히는 것을 전제로 설계했습니다.

- **화면**: 정적 웹 앱 (`web/`) → Render Static Site (무료)
- **데이터·로그인**: Supabase (Postgres + Auth, 무료 플랜)
- **코드**: GitHub

Supabase를 연결하지 않으면 **데모 모드**로 실행됩니다. 샘플 데이터가 브라우저에만 저장되어서 설치 없이 화면과 흐름을 확인할 수 있습니다.

## 기능

| 화면 | 내용 |
|---|---|
| 대시보드 | 관리 품목 수, 재고 금액(매입가), 재고 부족·품절 수, 입고·출고 추이 그래프, 발주 필요 목록, 최근 입출고 |
| 재고 목록 | 검색, 카테고리·상태 필터, 정렬, 품목별 입출고 등록 |
| 입출고 내역 | 기간·구분·검색 필터, 등록 취소 |
| 품목 관리 | 품목 추가·수정, 안전재고·보관 위치 설정 (점장 이상) |

**입출고 구분**: 입고 · 시술 사용 · 판매 · 폐기 · 재고 실사(점장 이상, 실제 센 수량으로 맞춤)

**권한**

| 역할 | 할 수 있는 일 |
|---|---|
| 직원 (`staff`) | 자기 지점 조회, 입고·시술 사용·판매·폐기 등록, 본인이 10분 안에 등록한 기록 취소 |
| 점장 (`manager`) | 직원 권한 + 재고 실사, 모든 기록 취소, 품목 추가·수정 |
| 본사 관리자 (`admin`) | 모든 지점 조회·관리 (화면 상단에서 지점 선택) |

## 데이터 설계

```
branches ─┬─ profiles (사용자 ↔ 지점·역할)
          ├─ inventory (지점별 현재고·안전재고·위치) ── products (전 지점 공용 품목)
          └─ stock_movements (모든 재고 변동 기록)
```

- 모든 테이블에 **Row Level Security**를 적용해서 사용자는 배정된 지점의 데이터만 봅니다.
- 앱은 테이블을 직접 수정할 수 없습니다. 재고 변경은 `record_movement()` 함수로만 하므로 **모든 변동이 기록**되고, 재고가 0 밑으로 내려가지 않습니다.
- 취소는 기록을 지우지 않고 **반대 기록을 추가**합니다. 이력은 수정되지 않습니다.
- 지점 간 이동(`transfer_in` / `transfer_out`)은 다음 단계를 위해 자리만 만들어 두었습니다.

## 설치 순서

### 1. Supabase 프로젝트 만들기

1. <https://supabase.com> 에서 가입 후 **New project**를 만듭니다. 지역은 `Northeast Asia (Seoul)`을 권장합니다.
2. 왼쪽 메뉴 **SQL Editor**에서 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여 넣고 **Run**을 누릅니다.
3. 이어서 [`supabase/seed.sql`](supabase/seed.sql)을 실행합니다. 1호점과 샘플 품목 30개, 14일치 샘플 입출고가 들어갑니다. (실제 운영 전에는 생략하거나 품목을 바꿔서 실행하세요.)
4. **Authentication → Sign In / Providers → Email**에서 **Allow new users to sign up**을 끕니다. 계정은 관리자가 직접 만듭니다.

### 2. 계정 만들고 지점 배정하기

1. **Authentication → Users → Add user → Create new user**에서 이메일과 비밀번호로 계정을 만듭니다. (**Auto Confirm User** 체크)
2. **SQL Editor**에서 지점과 역할을 배정합니다.

```sql
-- 점장으로 1호점에 배정
update public.profiles
   set branch_id = (select id from public.branches where code = 'BR01'),
       role      = 'manager',
       full_name = '홍길동'
 where user_id = (select id from auth.users where email = 'manager@example.com');

-- 직원은 role = 'staff', 본사 관리자는 role = 'admin' (branch_id 없어도 전 지점 조회)
```

지점이 배정되지 않은 계정은 로그인해도 "지점 배정을 기다리고 있어요" 화면만 보입니다.

### 3. Render에 배포하기

**Render → New → Static Site**에서 이 저장소를 연결하고 아래처럼 설정합니다.

| 항목 | 값 |
|---|---|
| Branch | 배포할 브랜치 |
| Build Command | `node salon/scripts/build-config.mjs` |
| Publish Directory | `salon/web` |
| Environment | `SUPABASE_URL` = Project URL, `SUPABASE_ANON_KEY` = anon public key |

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
│   └── seed.sql            1호점 샘플 데이터
├── scripts/
│   └── build-config.mjs    Render 빌드 시 config.js 생성
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
- 점장이 앱에서 직원 계정을 초대·배정하는 화면

## 테스트

DB 설계(권한, 재고 규칙, 샘플 데이터 정합성)는 PGlite(WASM Postgres)로 검증합니다.

```bash
cd salon
npm install
npm test   # 37 passed, 0 failed
```
