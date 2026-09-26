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
  "hair": { "colors": ["…"], "styles": ["…"], "notes": "문장", "src": [15] },
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
- 가격·할인·효과를 단정하지 않습니다. 고객 사진·영상은 게시 동의가 필요하다는 점을 실행 제안에 반영합니다.
