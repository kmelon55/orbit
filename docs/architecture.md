# Orbit architecture

## 1. 제품 경계

Orbit의 코어는 노트 에디터나 AI 채팅이 아니라 다음 네 가지 계약이다.

```text
Capture → Markdown files → Today/Search → Agent interface
```

- Capture: 입력 형식을 강요하지 않고 먼저 저장한다.
- Markdown files: 데이터베이스가 없어도 모든 핵심 데이터가 유지된다.
- Today/Search: 지식과 실행 항목을 같은 파일 집합에서 투영한다.
- Agent interface: UI와 외부 에이전트가 동일한 저장 계약을 사용한다.

AI Organizer, Calendar Sync, Git Backup은 이 코어 위의 어댑터다. 없어도 Orbit은 기록·열람·실행 도구로 동작해야 한다.

## 2. Vault 규칙

```text
ORBIT_VAULT_DIR/
├── inbox/       # 아직 정리되지 않은 모든 입력
├── projects/    # 완료 조건이 있는 유한한 결과물
├── areas/       # 지속적으로 관리하는 책임 영역
├── resources/   # 참고 자료와 관심 주제
├── events/      # 달력에 표시할 일정
└── archive/     # 활성 상태가 아닌 파일
```

하위 폴더는 자유롭게 만들 수 있다. 파일의 위치가 기본 `space`를 결정하지만, frontmatter의 명시적 `space`가 있으면 이를 우선한다.

## 3. 최소 frontmatter

| 필드 | 필수 | 값 |
| --- | --- | --- |
| `id` | 권장 | 변경되지 않는 문자열 또는 UUID |
| `title` | 필수 | 사람이 읽는 제목 |
| `type` | 필수 | `note`, `task`, `event`, `link` |
| `space` | 선택 | `inbox`, `project`, `area`, `resource`, `event`, `archive` |
| `status` | task | `open`, `in_progress`, `done`, `cancelled` |
| `project` | 선택 | 프로젝트의 표시 이름 |
| `due` | 선택 | ISO 8601 날짜 또는 시각 |
| `start`, `end` | event | ISO 8601 시각 |
| `url` | link | 원본 URL |
| `tags` | 선택 | 문자열 배열 |
| `created`, `updated` | 권장 | ISO 8601 시각 |

알 수 없는 frontmatter 필드는 보존해야 한다. 외부 편집기가 추가한 필드를 Orbit이 삭제하면 안 된다.

## 4. 쓰기 원칙

- 신규 캡처는 항상 `inbox/`에 쓴다.
- 같은 디렉터리에 임시 파일을 만든 뒤 `rename`하여 원자적으로 교체한다.
- 파일명은 의미 있는 slug와 ID 일부를 결합한다.
- 앱이 이해하지 못하는 Markdown 파일은 삭제하거나 이동하지 않고 건너뛴다.
- 향후 동시 쓰기는 파일 단위 충돌 감지(`updated` 또는 content hash)로 보호한다.

## 5. AI Organizer 계약

AI는 파일을 곧바로 옮기거나 덮어쓰지 않는다. 제안은 별도 재생성 가능 상태에 저장하고 다음 구조를 가진다.

```json
{
  "itemId": "...",
  "baseHash": "sha256:...",
  "operations": [
    { "op": "move", "to": "projects/orbit" },
    { "op": "set", "field": "type", "value": "task" }
  ],
  "reason": "첫 공개 릴리스라는 완료 조건이 있습니다."
}
```

사용자가 승인할 때 현재 파일 hash가 `baseHash`와 같은 경우에만 적용한다. 다르면 제안을 폐기하고 다시 분석한다. 이 경계가 UI, MCP, API 모두에 동일하게 적용되어야 한다.

## 6. 재생성 가능한 상태

SQLite를 도입할 경우 다음 데이터만 허용한다.

- 전문 검색 및 임베딩 인덱스
- 파일 hash와 watcher cursor
- CalDAV 동기화 토큰 및 remote ID 매핑
- Git 작업 큐와 마지막 성공 상태
- AI 분석 캐시와 승인 대기 제안

SQLite 파일을 지워도 Markdown에서 핵심 상태를 복원할 수 있어야 한다.

## 7. 저장소와 백업 경계

GitHub API나 S3 API는 Orbit의 실시간 데이터베이스가 아니다. 웹 UI와 MCP는 같은 로컬 vault에 원자적으로 쓰고, Git snapshot과 S3 호환 백업은 해당 vault를 비동기로 복제한다. 백업 장애가 캡처와 편집을 막지 않아야 하며, 복원할 때도 Markdown/YAML만으로 핵심 상태가 재구성되어야 한다.

`OrbitItem.path`는 로컬 상대 경로이면서 미래 object key다. 새 경로는 `/` 구분자와 Unicode NFC를 사용하며 `s3://<bucket>/vaults/<vault-name>/<item.path>`로 직접 매핑할 수 있다. S3 adapter를 추가하더라도 앱의 개별 저장 요청이 Git commit이나 원격 object PUT을 기다리게 만들지 않는다.

## 8. 현재 모듈

- `src/lib/orbit/schema.ts`: 공유 데이터 계약
- `src/lib/orbit/store.ts`: filesystem 읽기/쓰기
- `src/lib/orbit/vault-key.ts`: portable filename과 object key 계약
- `src/lib/orbit/functions.ts`: 웹 UI용 server functions
- `src/mcp/server.ts`: 외부 에이전트용 stdio MCP
- `src/routes/index.tsx`: Today vertical slice
- `src/routes/inbox.tsx`: 빠른 캡처와 PARA 분류
- `src/routes/projects.tsx`, `areas.tsx`, `resources.tsx`, `archive.tsx`: PARA 폴더 탐색
- `src/routes/calendar.tsx`: 월간 캘린더
- `src/routes/notes.tsx`: Markdown 노트 탐색, 편집, 미리보기, 보관
- `src/components/ui/`: shadcn/ui 기반 공통 컴포넌트

웹 UI와 MCP는 별도 저장 구현을 만들지 않고 `store.ts`를 공유한다.
