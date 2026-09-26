-- =============================================================================
-- 한 지점의 테스트 데이터 정리 (베타 테스트 → 실제 운영 전환용)
--
-- 지우는 것 (정한 지점만):
--   · 입출고 기록 (입고·시술 사용·판매·폐기·재고 실사·취소)   stock_movements
--   · 현재고 → 0 (안전재고·보관 위치·지점 가격·사용 여부는 그대로)  inventory.stock
--   · 시술 매출 입력                                             daily_sales
--   · 월 실적 입력·정산 확정                                      staff_monthly, payroll_months
--   · SNS 홍보 게시물·홍보 영상 목록·고객 게시 동의 기록           sns_posts, sns_media, sns_consents
--     (영상 파일 자체는 Storage → sns-media 버킷의 지점 폴더에서 지워 주세요)
--   · (선택) 근무표 기록: 연차·반차·휴무 등                        staff_schedule
-- 그대로 두는 것:
--   지점 정보·사진, 로그인 계정, 카테고리, 제품 목록, 직원 정보·사진, SNS 설정, 다른 지점의 모든 데이터
--
-- 사용 방법 (Supabase → SQL Editor):
--   1) 아래 [1단계]만 선택해 실행 → 정리될 건수를 확인합니다. (아무것도 지우지 않음)
--   2) 백업: Table Editor에서 stock_movements, daily_sales 등을 CSV로 내려받아 둡니다.
--   3) [2단계]의 v_branch와 v_confirm을 고친 뒤 [2단계]를 선택해 실행합니다.
--   4) [3단계]로 0건이 되었는지 확인합니다.
-- 한 번 지우면 되돌릴 수 없습니다.
-- =============================================================================


-- [1단계] 미리 보기 ─ '본사'를 정리할 지점의 지점명 또는 지점 코드로 바꿔 실행하세요.
with t as (
  select id, code, name from public.branches where name = '본사' or code = '본사'
)
select t.code as 지점코드, t.name as 지점명,
       (select count(*) from public.stock_movements m where m.branch_id = t.id)             as 입출고_기록,
       (select count(*) from public.inventory i where i.branch_id = t.id and i.stock <> 0)   as 재고가_있는_품목,
       (select coalesce(sum(i.stock), 0) from public.inventory i where i.branch_id = t.id)   as 현재고_합계,
       (select count(*) from public.daily_sales s where s.branch_id = t.id)                 as 시술매출_입력,
       (select count(*) from public.staff_monthly s where s.branch_id = t.id)               as 월실적_입력,
       (select count(*) from public.payroll_months p where p.branch_id = t.id)              as 정산확정_월,
       (select count(*) from public.sns_posts x where x.branch_id = t.id)                   as SNS_게시물,
       (select count(*) from public.sns_consents x where x.branch_id = t.id)                as SNS_게시동의,
       (select count(*) from public.staff_schedule s where s.branch_id = t.id)              as 근무표_기록
from t;


-- [2단계] 정리 실행
do $$
declare
  v_branch     text    := '본사';     -- 정리할 지점의 지점명 또는 지점 코드
  v_schedule   boolean := false;      -- 근무표(연차·반차·휴무) 기록도 지우려면 true
  v_confirm    text    := '아니오';   -- 확인했으면 '예'로 바꾸세요. '예'가 아니면 아무것도 지우지 않습니다.
  v_id         uuid;
  v_name       text;
  v_n          integer;
  v_mv integer; v_stock integer; v_sales integer; v_monthly integer; v_payroll integer; v_sns integer; v_sched integer := 0;
begin
  select count(*) into v_n from public.branches where name = v_branch or code = v_branch;
  if v_n = 0 then
    raise exception '지점 "%"을(를) 찾을 수 없습니다. 지점 관리 화면의 지점명 또는 지점 코드를 확인하세요.', v_branch;
  elsif v_n > 1 then
    raise exception '지점 "%"에 해당하는 지점이 %곳입니다. 지점 코드로 정확히 지정하세요.', v_branch, v_n;
  end if;
  select id, name into v_id, v_name from public.branches where name = v_branch or code = v_branch;

  if v_confirm <> '예' then
    raise exception '확인 전이라 아무것도 지우지 않았습니다. [2단계]의 v_confirm을 ''예''로 바꾼 뒤 다시 실행하세요. (대상: %)', v_name;
  end if;

  -- 입출고 기록 (취소 기록도 같은 지점에 있으므로 함께 지워집니다)
  delete from public.stock_movements where branch_id = v_id;
  get diagnostics v_mv = row_count;

  -- 현재고 0 (제품별 지점 설정은 유지)
  update public.inventory set stock = 0, updated_at = now() where branch_id = v_id and stock <> 0;
  get diagnostics v_stock = row_count;

  delete from public.daily_sales where branch_id = v_id;
  get diagnostics v_sales = row_count;

  delete from public.payroll_months where branch_id = v_id;
  get diagnostics v_payroll = row_count;

  delete from public.staff_monthly where branch_id = v_id;
  get diagnostics v_monthly = row_count;

  delete from public.sns_posts where branch_id = v_id;
  get diagnostics v_sns = row_count;
  delete from public.sns_media where branch_id = v_id;  -- 파일은 Storage의 sns-media 버킷에서 따로 지워 주세요
  delete from public.sns_consents where branch_id = v_id;

  if v_schedule then
    delete from public.staff_schedule where branch_id = v_id;
    get diagnostics v_sched = row_count;
  end if;

  raise notice '% 정리 완료: 입출고 기록 %건 삭제, 재고 %개 품목 0으로, 시술 매출 %일 삭제, 월 실적 %건·정산 확정 %개월 삭제, SNS 게시물 %건 삭제, 근무표 %건 삭제',
    v_name, v_mv, v_stock, v_sales, v_monthly, v_payroll, v_sns, v_sched;
end;
$$;


-- [3단계] 결과 확인 ─ [1단계]와 같은 지점명을 넣고 실행하세요. 근무표를 빼면 모두 0이어야 합니다.
with t as (
  select id, code, name from public.branches where name = '본사' or code = '본사'
)
select t.code as 지점코드, t.name as 지점명,
       (select count(*) from public.stock_movements m where m.branch_id = t.id)             as 입출고_기록,
       (select coalesce(sum(i.stock), 0) from public.inventory i where i.branch_id = t.id)   as 현재고_합계,
       (select count(*) from public.daily_sales s where s.branch_id = t.id)                 as 시술매출_입력,
       (select count(*) from public.staff_monthly s where s.branch_id = t.id)               as 월실적_입력,
       (select count(*) from public.payroll_months p where p.branch_id = t.id)              as 정산확정_월,
       (select count(*) from public.sns_posts x where x.branch_id = t.id)                   as SNS_게시물,
       (select count(*) from public.sns_consents x where x.branch_id = t.id)                as SNS_게시동의,
       (select count(*) from public.staff_schedule s where s.branch_id = t.id)              as 근무표_기록
from t;
