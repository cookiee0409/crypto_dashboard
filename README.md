# 코인 프로젝트 수익·바이백 대시보드 MVP

정적 HTML/CSS/JS 기반 대시보드입니다. 샘플 데이터를 기본 폴백으로 두고, 브라우저에서 공개 API 호출이 가능한 경우 실제 데이터로 갱신합니다.

## 실행 방법

정적 파일 서버로 실행하는 것을 권장합니다.

```bash
python -m http.server 4173
```

이후 브라우저에서 `http://127.0.0.1:4173`을 엽니다.

## 데이터 구조

- `lib/defillama.js`: DefiLlama fees/revenue/buyback summary API 연동
- `lib/hyperliquid.js`: Hyperliquid info API 연동
- `src/data/projects.js`: 프로젝트 mock data 및 추후 API 매핑 대상 데이터 구조
- `src/utils/calculations.js`: 매수압 점수, 바이백 수익률, 언락 압력, 밸류에이션 계산
- `app.js`: 데이터 병합, 렌더링, CSV 내보내기, 설정 저장

## 포함 기능

- 프로젝트별 24h / 7d / 30d 수익 및 바이백 지표
- DefiLlama protocol slug 기반 공개 수익 데이터 갱신
- Hyperliquid Assistance Fund 주소와 DefiLlama Token Buy Back / Holder Net Income 지표 연동
- 프로젝트 수익성, 토큰 가치 연결, 언락 및 매도 압력, 실사용 성장, 신뢰도/리스크 섹션
- FDV/Revenue, MCAP/Holder Revenue, FDV/TVL, 바이백 수익률, 언락 위험도 자동 계산
- 매출, 바이백, 바이백 수익률, FDV/Revenue, 언락 위험도, TVL 기준 비교 테이블 정렬
- 실제/추정 바이백 구분 및 txHash 포함 CSV 내보내기
- 요청서 기준 매수압 점수 산식 반영
- 상시 투자 조언 아님 면책 문구 표시

## 주의

브라우저 CORS, 네트워크 제한, API 응답 변경이 있으면 실데이터 갱신이 실패할 수 있으며, 이 경우 샘플/이전 데이터가 유지됩니다. 운영 단계에서는 서버 사이드 프록시, DB 저장, Cron 갱신, 지갑 검증 로직을 추가하는 것이 좋습니다.

## Hyperliquid Assistance Fund

- 기본 Assistance Fund 주소는 `0xfefefefefefefefefefefefefefefefefefefefe`입니다.
- Hyperliquid 공개 `info` API의 `portfolio`, `spotClearinghouseState`, `spotMeta`, `userFillsByTime`을 함께 사용합니다.
- 바이백 규모는 DefiLlama `hyperliquid` parent protocol의 `dailyRevenue` 집계를 Token Buy Back / Token Holder Net Income 기준값으로 사용합니다.
- `spotMeta`에서 HYPE 토큰 index를 찾아 `@107` 같은 spot pair 심볼을 HYPE 매수 체결로 매핑합니다.
- 공식 메커니즘 URL: `https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees`
- 공식 재단 공지 URL: `https://x.com/HyperFND/status/2001127850754367525`
- 공식/보조 확인 URL: `https://hypurrscan.io/address/0xfefefefefefefefefefefefefefefefefefefefe`, `https://defillama.com/protocol/hyperliquid`
- ASXN buybacks API 후보도 확인했지만 현재 DNS 해석이 실패해 기본 데이터 소스로 사용하지 않습니다.
