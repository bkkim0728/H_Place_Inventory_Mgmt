# SNS 트렌드 주간 보고서

앱의 **SNS 트렌드** 화면이 이 폴더의 JSON 파일을 읽어 보여 줍니다. 매주 월요일 아침에 새 보고서를 추가합니다.

- `index.json` — 보고서 목록. 최신 보고서가 **맨 앞**에 옵니다.
- `YYYY-Www.json` — 한 주의 보고서 (ISO 주차, 예: `2026-W39.json`).

## 보고서 형식

```jsonc
{
  "id": "2026-W39",                        // 파일 이름과 같게
  "title": "2026년 9월 4주차 미용·뷰티 SNS 마케팅 동향",
  "period": { "from": "2026-09-21", "to": "2026-09-27" },  // 월요일 ~ 일요일
  "published": "2026-09-27",
  "headline": "한 줄 요약",
  "summary": ["핵심 3줄", "…", "…"],
  "keywords": [{ "k": "키워드", "why": "짧은 설명", "src": [1, 2] }],
  "platforms": [                             // naver · instagram · youtube · tiktok · meta
    { "id": "naver", "name": "네이버 플레이스", "signal": "up|flat|down",
      "points": ["문장", "…"], "src": [1, 3] }
  ],
  "stats": [                                 // 숫자 인포그래픽 타일 (3~4개)
    { "value": "85.6%", "label": "짧은 설명", "src": [2] }
  ],
  "community": {                             // 커뮤니티·댓글 분석 (정성 요약)
    "overview": "한 줄 요약",
    "platforms": [                           // youtube · instagram · naver · tiktok · meta · stocktwits · benzinga …
      { "id": "youtube", "tone": "neg|mixed|pos", "keywords": ["…"],
        "voices": ["댓글·게시글 요지를 풀어 쓴 문장"], "src": [4] }
    ],
    "note": "분석 방법과 한계"
  },
  "investor": {                              // 투자자 커뮤니티(StockTwits·Benzinga) 동향
    "headline": "한 줄 요약",
    "items": [{ "ticker": "ULTA", "name": "Ulta Beauty", "tone": "neg|mixed|pos",
                "point": "문장", "src": [30] }],
    "takeaway": "H Place에 주는 시사점",
    "note": "투자 조언이 아님"
  },
  "hair": { "colors": [{ "name": "…", "hex": "#b08968" }], "styles": ["…"], "notes": "문장", "src": [15] },
  "global": { "points": ["외국인·해외 동향"], "src": [19] },
  "actions": [                               // H Place가 이번 주에 할 일
    { "title": "…", "detail": "…", "for": "domestic|global", "route": "sns" }
  ],
  "watch": ["다음 주에 지켜볼 것"],
  "sources": [{ "id": 1, "title": "…", "url": "https://…", "publisher": "…", "date": "2026-09" }],
  "method": "자료 수집 방법과 한계"
}
```

## 작성 원칙

- 모든 주장에는 `src`로 출처 번호를 붙이고, `sources`에 실제로 연 링크만 넣습니다.
- 업계 블로그·광고 대행사 자료의 수치는 "업계 블로그 추정"이라고 밝힙니다.
- 플랫폼 내부 데이터를 분석한 것처럼 쓰지 않습니다. 공개 자료 요약입니다.
- 댓글·커뮤니티 분석은 공개 검색 결과와 기사에 나온 반응을 **정성적으로** 요약합니다. 댓글 수를 세거나 감성 점수를 계산한 것처럼 쓰지 않고, 개인을 알아볼 수 있는 닉네임·원문은 옮기지 않습니다.
- StockTwits·Benzinga 등 투자자 커뮤니티 내용은 업계 분위기 참고용이며 투자 조언이 아닙니다.
- 가격·할인·효과를 단정하지 않습니다. 고객 사진·영상은 게시 동의가 필요하다는 점을 실행 제안에 반영합니다.
