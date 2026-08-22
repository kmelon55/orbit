# Orbit roadmap

로드맵은 기능 수보다 파일 소유권과 안전한 변경 흐름을 먼저 완성하는 순서다.

## v0.1 — File loop

- [x] TanStack Start 기반
- [x] Markdown/YAML vault scanner
- [x] Universal Inbox의 텍스트 캡처
- [x] Today task projection과 완료 처리
- [x] MCP capture/today/search
- [x] 반응형 Today UI
- [ ] Inbox, Projects, Areas, Resources 상세 화면
- [ ] Markdown 편집기와 파일 이동
- [ ] 파일 watcher + SSE 갱신
- [ ] 전체 텍스트 검색
- [ ] 단일 사용자 인증 또는 trusted-proxy 계약

완료 조건: AI 없이도 기록 → 파일 확인 → Today 실행 → 검색이 끊기지 않는다.

## v0.2 — Safe organizer

- [ ] AI provider BYOK
- [ ] 수동 분석 버튼과 폴더별 opt-in
- [ ] 분류/태그/날짜 추출 제안
- [ ] diff 기반 승인·거절·일괄 적용
- [ ] content hash 충돌 감지
- [ ] 규칙 기반 정리(무AI 대안)

완료 조건: AI가 원본 파일을 사용자 승인 없이 변경하지 않는다.

## v0.3 — Time and sync

- [ ] 내부 Calendar 주/월 보기
- [ ] iCalendar import/export
- [ ] CalDAV adapter
- [ ] Apple Calendar 양방향 동기화
- [ ] timezone, recurrence, conflict 정책
- [ ] Git snapshot과 복구 UI

완료 조건: Orbit event, remote event, Git backup의 성공 상태를 각각 확인할 수 있다.

## v0.4 — Agent platform

- [ ] MCP resources와 prompts
- [ ] 제안 생성/조회/승인 도구
- [ ] 최소 권한 API token
- [ ] webhook/SSE event stream
- [ ] Hermes 연결 가이드와 검증 fixture

완료 조건: 외부 에이전트가 읽기, 캡처, 변경 제안을 수행하고 사용자가 Orbit에서 승인할 수 있다.

## 지금 하지 않는 것

- 팀 협업과 복잡한 권한 모델
- Notion 호환 데이터베이스 빌더
- 자체 AI 모델 호스팅
- 핵심 상태를 관계형 DB에만 저장
- 승인 없는 상시 AI 재분류

이 항목들은 사용자 검증으로 필요성이 드러나기 전까지 범위에 넣지 않는다.
