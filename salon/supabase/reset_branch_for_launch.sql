-- =============================================================================
-- 한 지점 운영 시작 정리 (서초 아크로비스타점: 9월 26일까지 테스트 → 9월 27일 운영)
--
-- 지우는 것 (정한 지점만):
--   · 입출고 기록 전체 (입고·시술 사용·판매·폐기·재고 실사·취소)       stock_movements
--   · 시술 매출 입력                                                   daily_sales
--   · 월 실적 입력·정산 확정                                           staff_monthly, payroll_months
--   · 제품 목록:
--       - 다른 지점에서 한 번도 쓰지 않은 제품 → 제품 자체를 삭제
--       - 다른 지점에서 쓰는 제품 → 제품은 남기고, 이 지점에서만 초기화하고 숨김
--         (재고 0, 안전재고 0, 보관 위치·지점 가격 없음, '사용 안 함')
-- 그대로 두는 것:
--   직원 정보·사진, 근무표, SNS 홍보(게시물·고객 게시 동의·SNS 설정),
--   지점 정보·사진, 로그인 계정, 카테고리, 다른 지점의 모든 데이터
--
-- 다른 지점 보호:
--   · 다른 지점에 재고·입출고 기록이 있거나, 안전재고·보관 위치·지점 가격·사용 여부를
--     바꾼 적이 있는 제품은 삭제하지 않습니다.
--   · 실행 전과 후에 다른 지점의 재고·입출고·매출·실적·제품 데이터를 비교해서,
--     하나라도 달라지면 모든 작업을 취소합니다.
--   · 삭제하는 제품은 다른 지점 목록에서도 사라집니다. 그 지점들에서 한 번도 쓰지 않은
--     (재고 0, 기록 없음, 설정 없음) 줄만 사라지고, 다른 지점의 데이터는 바뀌지 않습니다.
--     이것도 원하지 않으면 [2단계]의 v_products를 false로 두세요. 그러면 제품은
--     삭제하지 않고 이 지점에서만 초기화하고 숨깁니다.
--   · 기준일(v_cutoff) 이후의 입출고·매출 기록이 이 지점에 하나라도 있으면
--     실제 데이터가 섞인 것으로 보고 아무것도 지우지 않고 멈춥니다.
--
-- 사용 방법 (Supabase → SQL Editor):
--   0) 이 파일의 '서초 아크로비스타점'을 지점 관리 화면의 지점명(또는 지점 코드)과
--      똑같이 바꿉니다. (찾아 바꾸기로 모두 바꾸세요: 1단계 2곳, 2단계 1곳, 3단계 1곳)
--   1) [1단계] 두 쿼리를 하나씩 선택해 실행 → 지울 건수와 제품별 처리를 확인합니다.
--      (아무것도 지우지 않음)
--   2) 백업: Table Editor에서 products, inventory, stock_movements, daily_sales,
--      staff_monthly를 CSV로 내려받아 둡니다.
--   3) [2단계]의 v_confirm을 '예'로 바꾸고 [2단계]만 선택해 실행합니다.
--   4) [3단계]로 결과를 확인합니다.
--   5) 앱에서 실제로 쓰는 제품을 등록하고(또는 '사용'으로 켜고), 매장에 있는 실제 수량을
--      재고 실사나 입고로 입력하면 운영 시작 재고가 됩니다.
-- 한 번 지우면 되돌릴 수 없습니다.
-- =============================================================================


-- [1단계-1] 미리 보기: 지울 건수 (아무것도 지우지 않음)
with t as (
  select id, code, name, date '2026-09-27' as cutoff
  from public.branches where name = '서초 아크로비스타점' or code = '서초 아크로비스타점'
),
p as (
  select i.product_id,
         exists (select 1 from public.inventory o
                  where o.product_id = i.product_id and o.branch_id <> t.id
                    and (o.stock <> 0 or o.safety_stock <> 0 or o.location is not null or not o.in_use or o.own_prices))
         or exists (select 1 from public.stock_movements m
                     where m.product_id = i.product_id and m.branch_id <> t.id) as used_elsewhere
  from t join public.inventory i on i.branch_id = t.id
)
select t.code as 지점코드, t.name as 지점명,
       (select count(*) from public.stock_movements m where m.branch_id = t.id)                              as 입출고_기록,
       (select count(*) from public.stock_movements m where m.branch_id = t.id
          and m.created_at >= (t.cutoff::timestamp at time zone 'Asia/Seoul'))                               as 기준일_이후_입출고_0이어야함,
       (select count(*) from public.daily_sales s where s.branch_id = t.id)                                 as 시술매출_입력,
       (select count(*) from public.daily_sales s where s.branch_id = t.id and s.day >= t.cutoff)           as 기준일_이후_매출_0이어야함,
       (select count(*) from public.staff_monthly s where s.branch_id = t.id)                               as 월실적_입력,
       (select count(*) from public.payroll_months x where x.branch_id = t.id)                              as 정산확정_월,
       (select count(*) from p where not p.used_elsewhere)                                                  as 삭제할_제품,
       (select count(*) from p where p.used_elsewhere)                                                      as 남기고_이지점만_숨길_제품,
       (select count(*) from public.staff s where s.branch_id = t.id)                                       as 유지_직원,
       (select count(*) from public.staff_schedule s where s.branch_id = t.id)                              as 유지_근무표,
       (select count(*) from public.sns_posts s where s.branch_id = t.id)                                   as 유지_SNS게시물,
       (select count(*) from public.sns_consents s where s.branch_id = t.id)                                as 유지_게시동의
from t;

-- [1단계-2] 미리 보기: 제품별 처리
with t as (
  select id from public.branches where name = '서초 아크로비스타점' or code = '서초 아크로비스타점'
)
select pr.sku as 품목코드, pr.name as 품목명, pr.category as 카테고리, i.stock as 이지점_재고,
       case when u.branches is null then '삭제 (다른 지점에서 쓴 적 없음)'
            else '남김 · 이 지점에서만 초기화하고 숨김' end as 처리,
       u.branches as 사용중인_다른지점
from t
join public.inventory i on i.branch_id = t.id
join public.products pr on pr.id = i.product_id
left join lateral (
  select string_agg(distinct b.name, ', ') as branches
  from public.branches b
  where b.id <> t.id and (
    exists (select 1 from public.inventory o where o.branch_id = b.id and o.product_id = i.product_id
              and (o.stock <> 0 or o.safety_stock <> 0 or o.location is not null or not o.in_use or o.own_prices))
    or exists (select 1 from public.stock_movements m where m.branch_id = b.id and m.product_id = i.product_id))
) u on true
order by (u.branches is null) desc, pr.category, pr.sku;


-- [2단계] 정리 실행 (하나의 작업으로 실행되어, 중간에 멈추면 아무것도 바뀌지 않습니다)
do $$
declare
  v_branch    text    := '서초 아크로비스타점';  -- 정리할 지점의 지점명 또는 지점 코드
  v_cutoff    date    := date '2026-09-27';      -- 실제 운영 시작일. 이날 이후 기록이 있으면 멈춤
  v_products  boolean := true;                   -- false: 제품은 삭제하지 않고 이 지점에서만 초기화·숨김
  v_confirm   text    := '아니오';               -- 확인했으면 '예'로 바꾸세요. '예'가 아니면 아무것도 지우지 않습니다.
  v_id        uuid;
  v_name      text;
  v_n         integer;
  v_del       uuid[];
  v_before    text;
  v_after     text;
  v_mv integer; v_sales integer; v_monthly integer; v_payroll integer; v_prod integer := 0; v_hidden integer;
begin
  select count(*) into v_n from public.branches where name = v_branch or code = v_branch;
  if v_n = 0 then
    raise exception '지점 "%"을(를) 찾을 수 없습니다. 지점 목록: %', v_branch,
      (select string_agg(format('%s(%s)', name, code), ', ' order by name) from public.branches);
  elsif v_n > 1 then
    raise exception '지점 "%"에 해당하는 지점이 %곳입니다. 지점 코드로 정확히 지정하세요.', v_branch, v_n;
  end if;
  select id, name into v_id, v_name from public.branches where name = v_branch or code = v_branch;

  if v_confirm <> '예' then
    raise exception '확인 전이라 아무것도 지우지 않았습니다. [2단계]의 v_confirm을 ''예''로 바꾼 뒤 다시 실행하세요. (대상: %)', v_name;
  end if;

  -- 실제 운영 데이터가 섞였으면 멈춤
  select count(*) into v_n from public.stock_movements
   where branch_id = v_id and created_at >= (v_cutoff::timestamp at time zone 'Asia/Seoul');
  if v_n > 0 then
    raise exception '%에 %일 이후 입출고 기록이 %건 있어 멈췄습니다. 실제 데이터가 지워질 수 있으니 기준일을 확인하세요.', v_name, v_cutoff, v_n;
  end if;
  select count(*) into v_n from public.daily_sales where branch_id = v_id and day >= v_cutoff;
  if v_n > 0 then
    raise exception '%에 %일 이후 시술 매출 입력이 %건 있어 멈췄습니다.', v_name, v_cutoff, v_n;
  end if;
  -- 다른 지점 기록과 연결된 취소 기록이 있으면 멈춤 (정상적으로는 없음)
  if exists (select 1 from public.stock_movements a join public.stock_movements r on r.reverts_id = a.id
              where (a.branch_id = v_id) <> (r.branch_id = v_id)) then
    raise exception '다른 지점 기록과 연결된 취소 기록이 있어 멈췄습니다. 관리자에게 문의하세요.';
  end if;

  -- 삭제할 제품: 이 지점 외에는 어느 지점도 쓰거나 설정한 적이 없는 제품
  if v_products then
    select coalesce(array_agg(i.product_id), '{}') into v_del
      from public.inventory i
     where i.branch_id = v_id
       and not exists (select 1 from public.inventory o
                        where o.product_id = i.product_id and o.branch_id <> v_id
                          and (o.stock <> 0 or o.safety_stock <> 0 or o.location is not null or not o.in_use or o.own_prices))
       and not exists (select 1 from public.stock_movements m
                        where m.product_id = i.product_id and m.branch_id <> v_id);
  else
    v_del := '{}';
  end if;

  -- 다른 지점 데이터 지문 (삭제할 제품의 빈 줄은 제외)
  v_before := md5(concat_ws('|',
    (select string_agg(format('%s', m.*), ',' order by m.id) from public.stock_movements m where m.branch_id <> v_id),
    (select string_agg(format('%s', i.*), ',' order by i.branch_id, i.product_id) from public.inventory i
      where i.branch_id <> v_id and not (i.product_id = any (v_del))),
    (select string_agg(format('%s', p.*), ',' order by p.id) from public.products p where not (p.id = any (v_del))),
    (select string_agg(format('%s', s.*), ',' order by s.branch_id, s.day) from public.daily_sales s where s.branch_id <> v_id),
    (select string_agg(format('%s', s.*), ',' order by s.staff_id, s.month) from public.staff_monthly s where s.branch_id <> v_id),
    (select string_agg(format('%s', s.*), ',' order by s.branch_id, s.month) from public.payroll_months s where s.branch_id <> v_id),
    (select string_agg(format('%s', c.*), ',' order by c.name) from public.categories c)));

  -- 1) 입출고 기록 (취소 기록도 같은 지점에 있으므로 함께 지워집니다)
  delete from public.stock_movements where branch_id = v_id;
  get diagnostics v_mv = row_count;

  -- 2) 다른 지점에서 쓴 적 없는 제품 삭제 (모든 지점의 빈 재고 줄도 함께 없어짐)
  if cardinality(v_del) > 0 then
    delete from public.products where id = any (v_del);
    get diagnostics v_prod = row_count;
  end if;

  -- 3) 남은 제품: 이 지점에서만 초기화하고 숨김
  update public.inventory
     set stock = 0, safety_stock = 0, location = null, in_use = false, own_prices = false,
         name = null, brand = null, category = null, is_retail = null, unit = null, cost_price = null, retail_price = null,
         updated_at = now()
   where branch_id = v_id;
  get diagnostics v_hidden = row_count;

  -- 4) 매출·실적
  delete from public.daily_sales where branch_id = v_id;
  get diagnostics v_sales = row_count;
  delete from public.payroll_months where branch_id = v_id;
  get diagnostics v_payroll = row_count;
  delete from public.staff_monthly where branch_id = v_id;
  get diagnostics v_monthly = row_count;

  -- 다른 지점이 그대로인지 확인. 달라졌으면 모든 작업을 취소합니다.
  v_after := md5(concat_ws('|',
    (select string_agg(format('%s', m.*), ',' order by m.id) from public.stock_movements m where m.branch_id <> v_id),
    (select string_agg(format('%s', i.*), ',' order by i.branch_id, i.product_id) from public.inventory i
      where i.branch_id <> v_id and not (i.product_id = any (v_del))),
    (select string_agg(format('%s', p.*), ',' order by p.id) from public.products p where not (p.id = any (v_del))),
    (select string_agg(format('%s', s.*), ',' order by s.branch_id, s.day) from public.daily_sales s where s.branch_id <> v_id),
    (select string_agg(format('%s', s.*), ',' order by s.staff_id, s.month) from public.staff_monthly s where s.branch_id <> v_id),
    (select string_agg(format('%s', s.*), ',' order by s.branch_id, s.month) from public.payroll_months s where s.branch_id <> v_id),
    (select string_agg(format('%s', c.*), ',' order by c.name) from public.categories c)));
  if v_after is distinct from v_before then
    raise exception '다른 지점 데이터가 달라져 모든 작업을 취소했습니다. 아무것도 지워지지 않았습니다.';
  end if;

  raise notice '% 정리 완료: 입출고 기록 %건 삭제, 제품 %개 삭제, 남은 제품 %개는 이 지점에서만 초기화·숨김, 시술 매출 %일 삭제, 월 실적 %건·정산 확정 %개월 삭제. 다른 지점 데이터는 바뀌지 않았습니다.',
    v_name, v_mv, v_prod, v_hidden, v_sales, v_monthly, v_payroll;
end;
$$;


-- [3단계] 결과 확인 ─ 입출고·재고·매출·실적은 0, 사용 중 제품 0, 직원·근무표·SNS는 그대로여야 합니다.
with t as (
  select id, code, name from public.branches where name = '서초 아크로비스타점' or code = '서초 아크로비스타점'
)
select t.code as 지점코드, t.name as 지점명,
       (select count(*) from public.stock_movements m where m.branch_id = t.id)                   as 입출고_기록,
       (select coalesce(sum(i.stock), 0) from public.inventory i where i.branch_id = t.id)         as 현재고_합계,
       (select count(*) from public.inventory i where i.branch_id = t.id and i.in_use)             as 사용중_제품,
       (select count(*) from public.daily_sales s where s.branch_id = t.id)                       as 시술매출_입력,
       (select count(*) from public.staff_monthly s where s.branch_id = t.id)                     as 월실적_입력,
       (select count(*) from public.staff s where s.branch_id = t.id)                             as 유지_직원,
       (select count(*) from public.staff_schedule s where s.branch_id = t.id)                    as 유지_근무표,
       (select count(*) from public.sns_posts s where s.branch_id = t.id)                         as 유지_SNS게시물
from t;
