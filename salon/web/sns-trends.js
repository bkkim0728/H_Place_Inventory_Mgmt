/* SNS 홍보 — 트렌드 콘텐츠 라이브러리.
 * 초안의 70%를 채우는 "요즘 반응이 좋은" 콘텐츠 형식과 헤어 스타일 모음입니다.
 * 실시간으로 수집한 트렌드가 아니라, 헤어·뷰티 SNS에서 자주 쓰이는 형식(전후 전환 릴스,
 * GRWM, ASMR, 투표·Q&A 스토리, 카드뉴스 등)과 계절별 컬러·스타일을 정리한 것입니다.
 * 분기마다(또는 유행이 바뀔 때) 아래 SEASONS·STYLES·항목 문구를 고쳐 주세요.
 *
 * 각 항목은 ctx(지점·디자이너·계절 정보)를 받아 게시물 초안 하나를 돌려줍니다.
 * theme은 'trend', origin은 'trend'로 저장됩니다.
 */
(() => {
  'use strict';

  // 계절별 컬러 (월 → 계절). ko: 국내용, en: 해외용
  const SEASONS = {
    spring: { ko: '봄', en: 'spring', months: [3, 4, 5],
      colors: { ko: ['밀크 베이지', '피치 브라운', '라벤더 애쉬', '허니 베이지', '소프트 핑크 브라운'], en: ['milk beige', 'peach brown', 'lavender ash', 'honey beige', 'soft pink brown'] },
      moment: { ko: '졸업·입학·웨딩 시즌', en: 'wedding & graduation season' } },
    summer: { ko: '여름', en: 'summer', months: [6, 7, 8],
      colors: { ko: ['쿨 애쉬 브라운', '블루 블랙', '애쉬 그레이 하이라이트', '샌드 베이지', '라이트 카키'], en: ['cool ash brown', 'blue black', 'ash grey highlights', 'sand beige', 'light khaki'] },
      moment: { ko: '장마철 곱슬·부스스함 관리', en: 'humid-season frizz care' } },
    fall: { ko: '가을', en: 'fall', months: [9, 10, 11],
      colors: { ko: ['초코 브라운', '모카 브라운', '카키 브라운', '와인 레드', '카멜 브라운'], en: ['chocolate brown', 'mocha brown', 'khaki brown', 'wine red', 'camel brown'] },
      moment: { ko: '환절기 두피·모발 케어', en: 'seasonal scalp care' } },
    winter: { ko: '겨울', en: 'winter', months: [12, 1, 2],
      colors: { ko: ['다크 초콜릿', '블랙 체리', '애쉬 블랙', '버건디', '딥 모카'], en: ['dark chocolate', 'black cherry', 'ash black', 'burgundy', 'deep mocha'] },
      moment: { ko: '연말 모임·파티 헤어', en: 'year-end party hair' } },
  };
  // 요즘 많이 찾는 커트·펌 (국내 / 해외 표기)
  const STYLES = {
    cuts: { ko: ['레이어드컷', '허쉬컷', '태슬컷', 'C컬 단발'], en: ['layered cut', 'hush cut', 'tassel cut', 'C-curl bob'] },
    perms: { ko: ['빌드펌', '히피펌', '젤리펌', '글램펌'], en: ['build perm', 'hippie perm', 'jelly perm', 'glam perm'] },
  };
  const seasonOf = (month) => Object.values(SEASONS).find((x) => x.months.includes(month));
  const pick = (list, seed, n = 1) => Array.from({ length: n }, (_, i) => list[(seed + i) % list.length]);

  // ---------------------------------------------------------------- 국내용
  const DOMESTIC = [
    (c) => ({ platform: 'instagram', format: 'reels', slot: '12:00', needs_consent: true,
      title: '3초 전후 전환 릴스',
      caption: `손가락 한 번에 달라지는 분위기 ✨\n${c.style.cut} + ${c.color}\n\n같은 스타일이 궁금하면 저장하고 DM 주세요!`,
      tags: `#전후 #헤어변신 #${c.style.cut.replace(/\s/g, '')} #${c.color.replace(/\s/g, '')}`,
      shoot_note: '세로 영상 7~10초: 시술 전 → 손가락 튕기기(또는 손으로 가리기) 전환 → 시술 후. 고객 얼굴이 나오면 동의를 연결하세요.' }),
    (c) => ({ platform: 'instagram', format: 'carousel', slot: '19:30',
      title: `요즘 많이 찾는 ${c.season.ko} 컬러 ${c.colors.length}`,
      caption: `${c.season.ko}에 어울리는 컬러, 저장해 두세요 🍂\n\n${c.colors.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n피부 톤에 맞는 컬러는 ${c.place} 디자이너와 상담해 보세요.`,
      tags: `#${c.season.ko}컬러 #염색추천 #${c.colors[0].replace(/\s/g, '')}`,
      shoot_note: `컬러별 결과 사진 ${c.colors.length}장 + 컬러칩 1장 (여러 장으로 올리기). 고객 사진이면 동의를 연결하세요.` }),
    (c) => ({ platform: 'instagram', format: 'reels', slot: '13:30',
      title: `얼굴형별 어울리는 ${c.style.cut}`,
      caption: `둥근형·긴형·각진형, 나에게 맞는 ${c.style.cut}은? 🤔\n\n· 둥근형: 옆 볼륨은 줄이고 정수리 볼륨\n· 긴형: 앞머리·옆 레이어로 길이 분산\n· 각진형: 턱선 아래로 떨어지는 부드러운 레이어\n\n내 얼굴형 진단은 ${c.place}에서!`,
      tags: `#${c.style.cut.replace(/\s/g, '')} #얼굴형별헤어 #헤어추천`,
      shoot_note: `${c.josa(c.des, '이', '가')} 마네킹이나 일러스트로 3가지 얼굴형을 설명하는 세로 영상 20초` }),
    (c) => ({ platform: 'tiktok', format: 'video', slot: '08:30',
      title: '디자이너 GRWM: 출근 전 5분 스타일링',
      caption: `디자이너는 출근 전에 머리 어떻게 할까? ⏱️\n드라이부터 마무리 제품까지 5분 루틴 공개!\n\n#GRWM`,
      tags: '#GRWM #출근준비 #5분스타일링 #헤어루틴',
      shoot_note: `${c.josa(c.des, '이', '가')} 직접 출연하는 세로 영상 30초: 드라이 → 볼륨 → 마무리 제품. 디자이너만 나오게` }),
    (c) => ({ platform: 'instagram', format: 'reels', slot: '21:30', needs_consent: true,
      title: '샴푸 ASMR',
      caption: '오늘 하루 수고한 당신에게 🫧\n헤드 스파 샴푸 ASMR, 소리 켜고 들어 보세요.',
      tags: '#샴푸ASMR #헤드스파 #두피케어 #ASMR',
      shoot_note: '세로 영상 15~30초, 물소리·거품 소리 위주. 고객은 뒷모습만(얼굴 제외). 동의를 연결하세요.' }),
    (c) => ({ platform: 'instagram', format: 'story', slot: '12:30',
      title: '투표 스토리: 다음 달 추천 컬러',
      caption: `다음 달 ${c.place} 추천 컬러를 골라 주세요! 🗳️\n\n[투표 스티커] ${c.colors[0]} vs ${c.colors[1]}`,
      tags: '#투표 #컬러추천',
      shoot_note: '두 컬러 결과 사진을 반씩 배치 + 인스타그램 투표 스티커' }),
    (c) => ({ platform: 'instagram', format: 'carousel', slot: '17:00',
      title: '손상모 자가진단 체크리스트',
      caption: '내 머리, 얼마나 손상됐을까? ✅\n\n□ 끝이 갈라지고 엉킨다\n□ 젖으면 고무줄처럼 늘어난다\n□ 염색이 금방 빠진다\n□ 드라이해도 부스스하다\n\n2개 이상이면 클리닉 상담을 추천해요.',
      tags: '#손상모 #헤어클리닉 #자가진단 #모발관리',
      shoot_note: '체크리스트 카드뉴스 4~5장 (브랜드 색상 배경 + 큰 글씨)' }),
    (c) => ({ platform: 'tiktok', format: 'video', slot: '19:00',
      title: '미용실에서 이렇게 말하면 원하는 머리 나온다',
      caption: '미용실 가기 전 꼭 보고 가세요 💬\n1. 원하는 사진 + 싫은 사진 둘 다 보여 주기\n2. 평소 손질 시간 말하기\n3. "조금만"은 cm로 말하기',
      tags: '#미용실꿀팁 #헤어상담 #미용실',
      shoot_note: `${c.josa(c.des, '이', '가')} 설명하는 세로 영상 20~30초 (자막 크게)` }),
    (c) => ({ platform: 'instagram', format: 'reels', slot: '16:00',
      title: `${c.style.perm} vs ${c.style.perm2} 차이`,
      caption: `헷갈리는 ${c.josa(c.style.perm, '과', '와')} ${c.style.perm2}, 한 번에 정리 🌀\n\n어떤 컬이 나에게 맞는지 댓글로 물어보세요!`,
      tags: `#${c.style.perm.replace(/\s/g, '')} #${c.style.perm2.replace(/\s/g, '')} #펌추천`,
      shoot_note: '두 펌 결과 사진을 나란히 + 컬 크기·유지 기간·손질법 자막' }),
    (c) => ({ platform: 'instagram', format: 'story', slot: '15:30',
      title: 'Q&A 스티커: 디자이너에게 물어보세요',
      caption: `${c.des}에게 헤어 고민을 물어보세요! 💬\n[질문 스티커] 답변은 내일 스토리로 올려 드려요.`,
      tags: '#헤어고민 #QnA',
      shoot_note: '디자이너 사진 + 인스타그램 질문 스티커' }),
    (c) => ({ platform: 'instagram', format: 'carousel', slot: '20:30',
      title: '퍼스널 컬러별 추천 염색',
      caption: `웜톤·쿨톤, 나에게 맞는 ${c.season.ko} 컬러는? 🎨\n\n· 웜톤: ${c.colors[0]}, ${c.colors[4] || c.colors[1]}\n· 쿨톤: ${c.colors[2]}, ${c.colors[3]}\n\n정확한 진단은 매장에서 함께해요.`,
      tags: '#퍼스널컬러 #웜톤염색 #쿨톤염색',
      shoot_note: '웜톤/쿨톤 컬러 결과 사진 각 2장 + 컬러칩' }),
    (c) => ({ platform: 'tiktok', format: 'video', slot: '18:30',
      title: '미용실 브이로그: 오픈부터 마감까지',
      caption: `${c.place}의 하루를 1분에 담았어요 🎬\n오픈 준비 → 시술 → 마감 청소까지!`,
      tags: '#미용실브이로그 #미용사일상 #브이로그',
      shoot_note: '직원·매장 위주로 촬영, 고객은 나오지 않게. 1분 세로 영상' }),
    (c) => ({ platform: 'facebook', format: 'post', slot: '12:10',
      title: `${c.season.ko} 헤어 트렌드 총정리`,
      caption: `이번 ${c.season.ko} 많이 찾는 스타일을 정리했어요.\n\n✂️ 커트: ${c.cuts.join(', ')}\n🌀 펌: ${c.perms.join(', ')}\n🎨 컬러: ${c.colors.slice(0, 3).join(', ')}\n\n상담·예약: ${c.phone || 'DM'}`,
      tags: '#헤어트렌드 #헤어스타일',
      shoot_note: '대표 스타일 사진 3~4장' }),
    (c) => ({ platform: 'naver', format: 'news', slot: '10:30',
      title: `${c.season.moment.ko} 안내`,
      caption: `안녕하세요, ${c.place}입니다.\n\n${c.josa(c.season.moment.ko, '을', '를')} 맞아 ${c.season.ko}에 많이 찾는 시술을 안내해 드립니다.\n· 컬러: ${c.colors.slice(0, 2).join(', ')}\n· 스타일: ${c.style.cut}, ${c.style.perm}\n\n[이벤트·가격이 있으면 여기에 입력하세요]\n\n${c.contact}`,
      tags: '',
      shoot_note: '시즌 대표 스타일 사진 1장' }),
  ];

  // ---------------------------------------------------------------- 해외용 (English)
  const GLOBAL = [
    (c) => ({ platform: 'instagram', format: 'reels', slot: '19:00', needs_consent: true,
      title: 'Korean head spa at our Seoul salon',
      caption: `What a Korean head spa feels like 🫧\nScalp care, massage and a slow shampoo at ${c.placeEn}.\n\nSave this for your Seoul trip ✈️ DM us to book.`,
      tags: '#koreanheadspa #headspa #seoultravel #scalpcare',
      shoot_note: '세로 영상 20~30초: 두피 진단 → 샴푸 → 마사지. 고객은 뒷모습 위주, 동의를 연결하세요.' }),
    (c) => ({ platform: 'tiktok', format: 'video', slot: '20:00', needs_consent: true,
      title: `Korean ${c.styleEn.cut} transformation`,
      caption: `Korean ${c.styleEn.cut} transformation 🇰🇷✂️\nBefore → after at ${c.placeEn}.`,
      tags: `#koreanhaircut #${c.styleEn.cut.replace(/[\s-]/g, '')} #kbeauty #hairtransformation`,
      shoot_note: '세로 영상 10~15초 전후 전환. 고객 얼굴이 나오면 동의를 연결하세요.' }),
    (c) => ({ platform: 'instagram', format: 'carousel', slot: '11:30',
      title: 'How to book a Korean hair salon',
      caption: `First time at a Korean hair salon? Here's how it works 👇\n\n1. DM us your preferred date & a photo of the style you want\n2. We confirm your designer and time\n3. Consultation before every service\n4. Tipping is not customary in Korea\n\n📍 ${c.addressEn}`,
      tags: '#seoulhairsalon #koreanhairsalon #seoultravel #traveltips',
      shoot_note: '카드뉴스 5장 (영문). 예약 방법(DM, 전화, 메신저 등)은 실제 운영 방식에 맞게 고치세요.' }),
    (c) => ({ platform: 'instagram', format: 'reels', slot: '17:30',
      title: 'Korean perms explained',
      caption: `Korean perms, explained 🌀\n· ${c.styleEn.perms[0]}\n· ${c.styleEn.perms[1]}\n· ${c.styleEn.perms[2]}\n\nWhich one is your vibe? Comment below 👇`,
      tags: '#koreanperm #kbeauty #permhair #koreanhair',
      shoot_note: '세 가지 펌 결과 사진을 차례로 + 영문 자막' }),
    (c) => ({ platform: 'instagram', format: 'story', slot: '13:00',
      title: 'Ask a Seoul hair designer',
      caption: `Ask ${c.desEn} anything about Korean hair 💬\n[Question sticker] We'll answer tomorrow!`,
      tags: '#askme #koreanhair',
      shoot_note: '디자이너 사진 + 질문 스티커 (영문)' }),
    (c) => ({ platform: 'tiktok', format: 'video', slot: '21:00', needs_consent: true,
      title: 'Glass hair treatment ASMR',
      caption: 'Glass hair, Korean style ✨\nTreatment ASMR — sound on 🔊',
      tags: '#glasshair #hairtreatment #asmr #kbeauty',
      shoot_note: '클리닉 시술 과정 세로 영상 15~20초, 소리 위주. 고객은 뒷모습만, 동의를 연결하세요.' }),
    (c) => ({ platform: 'instagram', format: 'carousel', slot: '20:30',
      title: `Korean ${c.season.en} hair colors`,
      caption: `Trending Korean hair colors this ${c.season.en} 🎨\n\n${c.colorsEn.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\nWhich one would you try?`,
      tags: `#koreanhaircolor #${c.season.en}hair #kbeauty #haircolor`,
      shoot_note: `컬러별 결과 사진 ${c.colorsEn.length}장 (여러 장으로 올리기)` }),
    (c) => ({ platform: 'tiktok', format: 'video', slot: '18:00',
      title: 'A day at a Seoul hair salon',
      caption: `A day at ${c.placeEn} 🎬\nOpening → styling → closing, all in one minute.`,
      tags: '#seouldaily #salonlife #seoulvlog',
      shoot_note: '직원·매장 위주 1분 세로 영상, 고객은 나오지 않게' }),
    (c) => ({ platform: 'instagram', format: 'feed', slot: '10:30',
      title: 'Find us in Seoul',
      caption: `Visiting ${c.areaEn}? Come say hi 👋\n\n📍 ${c.addressEn}\n${c.phoneIntl ? `☎ ${c.phoneIntl}\n` : ''}DM us to book your visit.`,
      tags: '#seoultravel #visitseoul #seoulhairsalon',
      shoot_note: '매장 외관 + 가까운 지하철역·랜드마크 사진' }),
    (c) => ({ platform: 'tiktok', format: 'video', slot: '12:30',
      title: 'Before your first Korean salon visit',
      caption: 'Things to know before your first Korean salon visit 🇰🇷\n1. Bring reference photos\n2. Consultation comes first\n3. Services take longer — plan 2–3 hours for perm or color\n4. No tipping needed',
      tags: '#koreatravel #seoultips #koreanhairsalon',
      shoot_note: `${c.josa(c.des, '이', '가')} 설명하는 세로 영상 + 영문 자막` }),
    (c) => ({ platform: 'instagram', format: 'story', slot: '16:30',
      title: 'Poll: next K-hair style',
      caption: `Which K-hair style should we show next? 🗳️\n[Poll] ${c.styleEn.cut} vs ${c.styleEn.perm}`,
      tags: '#khair #poll',
      shoot_note: '두 스타일 사진 + 투표 스티커 (영문)' }),
    (c) => ({ platform: 'facebook', format: 'post', slot: '11:00',
      title: 'Get the K-hair look in Seoul',
      caption: `Planning a trip to Seoul? Get the K-hair look at ${c.placeEn} 💇\n\n✂️ ${c.styleEn.cuts.join(', ')}\n🌀 ${c.styleEn.perms.slice(0, 2).join(', ')}\n🎨 ${c.colorsEn.slice(0, 3).join(', ')}\n\nMessage us to book.`,
      tags: '#kbeauty #seoultravel #koreanhair',
      shoot_note: '대표 스타일 사진 3~4장' }),
  ];

  // Build this day's trend drafts for one audience (rotated by day so each day starts elsewhere)
  function trendDrafts(audience, ctx) {
    const season = seasonOf(ctx.month);
    const seed = ctx.seed;
    const c = {
      ...ctx, season,
      colors: pick(season.colors.ko, seed, 5), colorsEn: pick(season.colors.en, seed, 5),
      color: pick(season.colors.ko, seed)[0],
      cuts: STYLES.cuts.ko, perms: STYLES.perms.ko,
      style: { cut: pick(STYLES.cuts.ko, seed)[0], perm: pick(STYLES.perms.ko, seed)[0], perm2: pick(STYLES.perms.ko, seed + 1)[0] },
      styleEn: { cut: pick(STYLES.cuts.en, seed)[0], perm: pick(STYLES.perms.en, seed)[0], cuts: STYLES.cuts.en, perms: pick(STYLES.perms.en, seed, 3) },
    };
    const list = audience === 'global' ? GLOBAL : DOMESTIC;
    const start = seed % list.length;
    return [...list.slice(start), ...list.slice(0, start)].map((make) => {
      const x = make(c);
      return {
        ...x, theme: 'trend', origin: 'trend', audience, needs_consent: Boolean(x.needs_consent),
        hashtags: ctx.tags(x.tags, audience, x.platform, x.format),
        source_note: `트렌드 콘텐츠 · ${season.ko} 시즌${audience === 'global' ? ' · 해외(영어)' : ''}`,
      };
    });
  }

  window.snsTrends = {
    trendDrafts,
    season: (month) => seasonOf(month),
    styles: STYLES,
  };
})();
