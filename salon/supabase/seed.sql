-- ============================================================================
-- H Place 헤어살롱 재고관리 — sample data for the prototype
--
-- Run after schema.sql. Creates one branch, a product catalog typical for a
-- hair salon, current stock levels, and 14 days of sample history (memo
-- '샘플 데이터') so the dashboard has something to show.
-- Re-running is safe: existing rows are left as they are.
-- ============================================================================

insert into public.branches (code, name)
values ('BR01', '1호점')
on conflict (code) do nothing;

insert into public.products (sku, name, category, unit, cost_price, retail_price, is_retail) values
  -- 염모제 · 탈색
  ('CL-6N',    '새치 염모제 6N 80g',            '염모제',          '개',  6800, null,  false),
  ('CL-5NB',   '새치 염모제 5NB 80g',           '염모제',          '개',  6800, null,  false),
  ('CL-8B',    '멋내기 염모제 8B 80g',          '염모제',          '개',  7200, null,  false),
  ('CL-7AS',   '멋내기 염모제 7Ash 80g',        '염모제',          '개',  7200, null,  false),
  ('CL-BLP',   '탈색 파우더 500g',              '염모제',          '통', 21000, null,  false),
  ('CL-OX6',   '산화제 6% 1000ml',              '염모제',          '병',  8500, null,  false),
  ('CL-OX3',   '산화제 3% 1000ml',              '염모제',          '병',  8500, null,  false),
  -- 펌제
  ('PM-S1',    '셋팅펌 1제 400ml',              '펌제',            '병', 11000, null,  false),
  ('PM-S2',    '셋팅펌 2제 400ml',              '펌제',            '병',  9000, null,  false),
  ('PM-MG1',   '매직 스트레이트 1제 500g',      '펌제',            '통', 18500, null,  false),
  ('PM-NT',    '열펌 중화제 500ml',             '펌제',            '병',  9800, null,  false),
  -- 샴푸 · 트리트먼트 (업소용)
  ('SH-PRO',   '업소용 샴푸 1500ml',            '샴푸·트리트먼트', '병', 19000, null,  false),
  ('SH-TRT',   '업소용 트리트먼트 1000ml',      '샴푸·트리트먼트', '병', 22000, null,  false),
  ('SH-SCP',   '두피 스케일링 샴푸 1000ml',     '샴푸·트리트먼트', '병', 26000, null,  false),
  -- 클리닉
  ('CN-PPT',   'PPT 단백질 앰플 (10개입)',      '클리닉',          '박스', 15000, null, false),
  ('CN-KRT',   '케라틴 클리닉 앰플 (10개입)',   '클리닉',          '박스', 18000, null, false),
  ('CN-SCP',   '두피 토닉 앰플 (10개입)',       '클리닉',          '박스', 16500, null, false),
  -- 판매용 홈케어
  ('RT-ESS',   '헤어 에센스 100ml',             '판매용 홈케어',   '개',  9500, 24000, true),
  ('RT-OIL',   '헤어 오일 50ml',                '판매용 홈케어',   '개',  8800, 22000, true),
  ('RT-SHP',   '홈케어 샴푸 500ml',             '판매용 홈케어',   '개', 11000, 28000, true),
  ('RT-WAX',   '스타일링 왁스 80g',             '판매용 홈케어',   '개',  6200, 16000, true),
  -- 소모품
  ('SP-FOIL',  '염색 호일 롤 (30m)',            '소모품',          '롤',  7500, null,  false),
  ('SP-GLV',   '일회용 니트릴 장갑 (100매)',    '소모품',          '박스',  9000, null, false),
  ('SP-CAPE',  '일회용 염색 케이프 (100매)',    '소모품',          '팩', 12000, null,  false),
  ('SP-NECK',  '넥 페이퍼 (5롤)',               '소모품',          '팩',  6500, null,  false),
  ('SP-CAP',   '비닐 헤어캡 (100매)',           '소모품',          '팩',  4500, null,  false),
  ('SP-TWL',   '페이스 타월 (10매)',            '소모품',          '팩',  8000, null,  false),
  -- 도구
  ('TL-BR',    '롤 브러시 43mm',                '도구',            '개', 14000, null,  false),
  ('TL-CLP',   '섹션 클립 (12개)',              '도구',            '세트', 7000, null, false),
  ('TL-BWL',   '염색 볼 · 브러시 세트',         '도구',            '세트', 5500, null, false)
on conflict (sku) do nothing;

-- Current stock and safety stock for 1호점
insert into public.inventory (branch_id, product_id, stock, safety_stock, location)
select b.id, p.id, v.stock, v.safety, v.location
from (values
  ('CL-6N',   18, 12, '염색실 A'), ('CL-5NB',  9, 10, '염색실 A'), ('CL-8B',  14, 8, '염색실 A'),
  ('CL-7AS',   0,  6, '염색실 A'), ('CL-BLP',  3,  4, '염색실 B'), ('CL-OX6', 11, 6, '염색실 B'),
  ('CL-OX3',   7,  4, '염색실 B'), ('PM-S1',   6,  5, '펌 선반'),  ('PM-S2',   8, 5, '펌 선반'),
  ('PM-MG1',   2,  3, '펌 선반'),  ('PM-NT',   5,  3, '펌 선반'),  ('SH-PRO',  4, 4, '샴푸대'),
  ('SH-TRT',   6,  3, '샴푸대'),   ('SH-SCP',  0,  2, '샴푸대'),   ('CN-PPT',  5, 3, '클리닉장'),
  ('CN-KRT',   3,  3, '클리닉장'), ('CN-SCP',  4, 2, '클리닉장'),  ('RT-ESS', 12, 6, '카운터'),
  ('RT-OIL',   4,  6, '카운터'),   ('RT-SHP',  9, 4, '카운터'),    ('RT-WAX',  7, 4, '카운터'),
  ('SP-FOIL',  6,  4, '창고'),     ('SP-GLV',  3, 4, '창고'),      ('SP-CAPE', 5, 3, '창고'),
  ('SP-NECK',  8,  3, '창고'),     ('SP-CAP',  6, 3, '창고'),      ('SP-TWL', 10, 5, '창고'),
  ('TL-BR',    4,  2, '디자이너 서랍'), ('TL-CLP', 3, 2, '디자이너 서랍'), ('TL-BWL', 6, 3, '염색실 A')
) as v(sku, stock, safety, location)
join public.products p on p.sku = v.sku
cross join public.branches b
where b.code = 'BR01'
on conflict (branch_id, product_id) do nothing;

-- 14 days of sample history ending at the current stock level.
-- Built backwards from today so every row's stock_after is consistent.
do $$
declare
  r        record;
  v_branch uuid;
  v_run    integer;
  v_day    integer;
  v_qty    integer;
  v_type   public.movement_type;
  v_chance numeric;
begin
  select id into v_branch from public.branches where code = 'BR01';
  if exists (select 1 from public.stock_movements where branch_id = v_branch) then
    return;  -- history already present
  end if;

  perform setseed(0.42);
  for r in
    select i.product_id, i.stock, i.safety_stock, p.cost_price, p.is_retail, p.category
    from public.inventory i join public.products p on p.id = i.product_id
    where i.branch_id = v_branch
  loop
    v_run := r.stock;
    -- tools wear out slowly; everything else moves most days
    v_chance := case when r.category = '도구' then 0.1 else 0.55 end;
    for v_day in 0..13 loop
      -- outflow that day (시술 사용 or 판매)
      if random() < v_chance then
        v_qty  := 1 + floor(random() * 2)::int;
        v_type := case when r.is_retail then 'sale' else 'use' end;
        insert into public.stock_movements
          (branch_id, product_id, type, quantity, stock_after, unit_cost, memo, created_at)
        values
          (v_branch, r.product_id, v_type, -v_qty, v_run, r.cost_price, '샘플 데이터',
           date_trunc('day', now()) - make_interval(days => v_day) + interval '11 hours'
             + make_interval(mins => floor(random() * 480)::int));
        v_run := v_run + v_qty;
      end if;
      -- occasional delivery (입고) earlier the same day
      if random() < 0.12 and v_run >= r.safety_stock then
        v_qty := greatest(r.safety_stock, 2);
        if v_run - v_qty >= 0 then
          insert into public.stock_movements
            (branch_id, product_id, type, quantity, stock_after, unit_cost, memo, created_at)
          values
            (v_branch, r.product_id, 'receive', v_qty, v_run, r.cost_price, '샘플 데이터',
             date_trunc('day', now()) - make_interval(days => v_day) + interval '10 hours');
          v_run := v_run - v_qty;
        end if;
      end if;
    end loop;
  end loop;
end $$;
