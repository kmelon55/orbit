<div align="center">
  <img src="./public/orbit.svg" width="72" alt="Orbit logo" />
  <h1>Orbit</h1>
  <p><strong>Private by default. File first. Agent ready.</strong></p>
  <p>생각은 가볍게 기록하고, 실행과 지식은 한곳에서 관리하는 개인용 워크스페이스.</p>
</div>

> [!IMPORTANT]
> Orbit은 아직 초기 개발 단계입니다. 현재 버전에는 자체 인증이 없으므로 공개 인터넷에 바로 노출하지 말고, 로컬 네트워크나 Cloudflare Access 같은 인증 프록시 뒤에서 사용하세요.

## Orbit이 해결하려는 문제

기존 지식 관리 도구는 사용자가 폴더, 데이터베이스, 속성, 자동화 규칙을 먼저 설계하도록 요구하는 경우가 많습니다. Orbit은 그 반대로 동작합니다.

1. 메모, 링크, 할 일, 일정을 형식 없이 Inbox에 기록합니다.
2. 원본은 사람이 읽을 수 있는 Markdown + YAML 파일로 남습니다.
3. Today에서 오늘의 실행 항목과 일정을 함께 봅니다.
4. 외부 에이전트는 MCP를 통해 같은 파일에 접근합니다.
5. AI 정리는 선택 기능이며, 향후 변경 제안을 사용자가 승인한 뒤 적용합니다.

## 지금 되는 것

- Markdown/YAML vault 읽기
- 메모, 할 일, 일정, 링크를 Inbox 파일로 캡처
- 오늘 할 일 계산 및 완료 처리
- 최근 Inbox와 예정 일정 표시
- MCP `orbit_capture`, `orbit_today`, `orbit_search`
- `ORBIT_DATA_DIR`로 데이터 위치 분리
- 모바일 대응 Today 화면

아직 없는 것: 로그인, AI 자동 분류, 변경 승인 화면, 전체 검색 UI, CalDAV 동기화, Git 자동 백업, SSE 파일 감시. 범위와 순서는 [로드맵](./docs/roadmap.md)에 정리되어 있습니다.

## 빠른 시작

요구 사항: Node.js 22 이상, pnpm 10 이상

```bash
git clone https://github.com/kmelon55/orbit.git
cd orbit
pnpm install
cp .env.example .env
pnpm dev
```

기본 vault는 프로젝트의 `./data`입니다. 개인 데이터와 앱 코드를 분리하려면 `.env`에서 절대 경로를 지정하세요.

```dotenv
ORBIT_DATA_DIR=/data/orbit
```

## 파일 구조

```text
/data/orbit/
├── inbox/
├── projects/
├── areas/
├── resources/
├── events/
└── archive/
```

할 일은 별도 데이터베이스나 `tasks/` 폴더에 갇히지 않습니다. Inbox, Project, Area 안의 Markdown 파일이 `type: task`를 가지며, Orbit이 이를 Today에 모읍니다.

```markdown
---
id: 6c654756-053f-459a-9d73-c8a7c1ff020d
title: 첫 공개 릴리스 준비
type: task
space: project
project: Orbit
status: open
tags:
  - launch
created: 2026-08-23T09:00:00+09:00
updated: 2026-08-23T09:00:00+09:00
---

README와 기본 파일 계약을 검토한다.
```

전체 파일 계약은 [아키텍처 문서](./docs/architecture.md)를 참고하세요.

## MCP 연결

Orbit MCP 서버는 stdio로 실행됩니다.

```bash
ORBIT_DATA_DIR=/absolute/path/to/orbit-data pnpm mcp
```

MCP 클라이언트 설정 예시:

```json
{
  "mcpServers": {
    "orbit": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/orbit", "mcp"],
      "env": {
        "ORBIT_DATA_DIR": "/absolute/path/to/orbit-data"
      }
    }
  }
}
```

Hermes를 포함해 stdio MCP 서버를 지원하는 에이전트에서 같은 방식으로 연결할 수 있습니다. 구체적인 설정 키는 사용하는 클라이언트 문서를 확인해 주세요.

## Docker / Dokploy

```bash
docker build -t orbit .
docker run --rm -p 3000:3000 \
  -e ORBIT_DATA_DIR=/data/orbit \
  -v orbit-data:/data/orbit \
  orbit
```

Dokploy에서는 이 저장소의 `Dockerfile`을 사용하고 `/data/orbit`를 영구 볼륨으로 연결하세요. 외부 공개 전에는 반드시 인증 프록시를 구성하세요.

## 개발

```bash
pnpm test       # Biome + TypeScript
pnpm build      # production build
pnpm mcp        # stdio MCP server
```

기여 방법은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 참고하세요.

## 원칙

- 파일은 제품의 내보내기 형식이 아니라 Source of Truth입니다.
- SQLite는 검색 인덱스, 동기화 상태, 캐시처럼 재생성 가능한 데이터에만 씁니다.
- AI 제공자는 BYOK이며 AI 없이도 기본 기록과 실행 흐름이 동작해야 합니다.
- 에이전트의 파괴적인 변경은 기본적으로 제안 → 검토 → 적용 단계를 거칩니다.

## License

[MIT](./LICENSE)
