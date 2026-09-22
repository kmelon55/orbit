<div align="center">
  <img src="./public/orbit.png" width="72" alt="Orbit 로고" />
  <h1>Orbit</h1>
  <p><strong>노트, 할 일, 시간을 한곳에 모은 작은 개인 워크스페이스.</strong></p>
  <p>일단 기록하고, 필요할 때만 정리하고, 내 데이터는 내 서버에 보관합니다.</p>
  <p><a href="./README.md">English</a></p>
</div>

Orbit은 가볍게 셀프호스팅할 수 있는 개인 지식·일정 관리 도구입니다.

개인 지식 관리 시스템을 쓰기 위해 데이터베이스, 속성, 플러그인, 폴더 규칙부터 계속 관리하고 싶지 않은 사람을 위해 만들고 있습니다. Orbit의 흐름은 의도적으로 작습니다. 생각을 바로 기록하고, 필요하면 할 일이나 일정으로 만들고, 의미가 생겼을 때만 PARA로 정리합니다.

노트, 할 일, 일정은 내장 SQLite에 함께 저장되며 Markdown 입출력을 지원합니다. AI 제공자가 없어도 핵심 기능이 동작하며, 다음 큰 단계는 내 정보를 찾고 정리하되 원본을 몰래 바꾸지 않는 선택형 AI입니다.

## 지금 실제로 되는 것

| 영역 | 현재 동작 |
| --- | --- |
| 빠른 기록 | Today, Inbox, 모바일 빠른 기록에서 노트·할 일·일정을 만듭니다. 지원 브라우저에서는 음성 입력도 사용할 수 있습니다. |
| 노트 | Markdown 편집, 백그라운드 자동 저장, GFM 미리보기, 태그, 노트 링크, 선택형 Vim 모드, 보관과 삭제를 지원합니다. |
| 할 일 | 진행 중·완료 항목을 보고 기한 지남·오늘·예정·날짜 없음으로 나눕니다. 완료, 편집, 분류, 오늘/내일로 드래그 이동할 수 있습니다. |
| 캘린더 | 할 일과 일정을 일·주·월 화면에서 함께 봅니다. 시간 일정과 여러 날에 걸친 일정을 만들고, 옮기고, 길이를 바꿀 수 있습니다. |
| Today | 오늘 할 일과 일정을 한 화면에서 보고, 진행 중인 프로젝트 폴더와 빠른 기록에 접근합니다. |
| PARA | 항목을 Projects, Areas, Resources, Archive로 옮깁니다. 데이터베이스 구조를 먼저 만들지 않고도 중첩 폴더를 관리할 수 있습니다. |
| 화이트보드 | Excalidraw 호환 화이트보드 파일을 만들고, 이름을 바꾸고, 편집하고, 자동 저장합니다. 노트에서 화이트보드를 연결할 수 있습니다. |
| 모바일 | 반응형 내비게이션, 전용 빠른 기록 화면, 설치 안내, PWA manifest가 있습니다. 개인 페이지와 노트 데이터는 오프라인 캐시에 저장하지 않습니다. |
| 메일 | Gmail·iCloud·네이버 연결, 읽기·작성·답장·전달, 첨부파일, 웹 푸시를 지원합니다. [연결·운영 안내](./docs/mail.md)를 참고하세요. |
| 셀프호스팅 | Docker 컨테이너 하나, 영구 vault 디렉터리 하나, 내장 단일 사용자 비밀번호 인증으로 동작합니다. SQLite가 내장되어 별도 DB 서버를 설치할 필요가 없습니다. |
| MCP | 웹 앱과 같은 vault를 사용하는 로컬 stdio 서버와 9개 도구가 구현되어 있습니다. |

아직 없는 것: 내장 AI, AI 정리와 변경 검토 화면, 외부 캘린더 동기화, 자동 백업, 다중 사용자 협업, 원격 HTTP MCP endpoint.

## 사용 흐름

```text
기록 -> Today / 할 일 / 캘린더 -> 필요할 때 PARA 정리 -> Archive
                    |
              SQLite + 첨부파일
                    |
                 웹 UI와 MCP
```

PARA는 먼저 완성해야 하는 폴더 체계가 아니라 필요할 때 쓰는 정리 정책입니다. Inbox에는 아직 정리하지 않은 노트와 링크가 남습니다. 할 일이나 일정으로 확정하면 Inbox에서 빠지고 Tasks 또는 Calendar에서 관리합니다. 프로젝트와 날짜가 없는 할 일도 사용할 수 있습니다. 맥락이 분명해진 항목만 Project, Area, Resource로 옮기면 됩니다. 정리함과 할 일의 소속 선택창에서 폴더를 검색하거나 접고 펼칠 수 있고, 최근 사용한 목적지를 선택할 수 있습니다. 폴더 클릭은 탐색만 하며, 경로를 확인한 뒤 ‘여기로 이동’을 누르거나 폴더에 직접 드롭하면 이동합니다. 드래그 중 폴더 위에 잠시 머물면 펼쳐지고, 목록 가장자리에서는 자동으로 스크롤됩니다. 항목 생성·삭제·보관·이동, 완료 상태, 노트·할 일·일정 전환, 날짜·색상 변경은 알림의 ‘되돌리기’ 또는 편집기 밖에서 ⌘Z / Ctrl+Z로 취소할 수 있습니다. 되돌리기는 현재 세션에서 최근 200개 항목 작업을 지원하며, 해당 작업이 바꾼 값만 복원합니다. 본문 입력은 편집기의 실행 취소를 사용합니다.

## 빠른 시작

요구 사항: Node.js 22 이상, pnpm 10 이상

```bash
git clone https://github.com/kmelon55/orbit.git
cd orbit
pnpm install
cp .env.example .env
pnpm dev
```

기본 vault는 Git과 Docker build context에서 제외되는 `./vault`입니다. 실제 사용에서는 소스 저장소 밖의 디렉터리를 지정하세요.

```dotenv
ORBIT_VAULT_DIR=/absolute/path/to/orbit-vault
ORBIT_AUTH_USERNAME=orbit
ORBIT_AUTH_PASSWORD=replace-with-a-long-random-password
```

이전 `ORBIT_DATA_DIR`도 호환을 위해 읽습니다. 로컬 개발에서는 인증을 생략할 수 있지만 운영 모드의 최초 설정에는 두 인증 환경변수가 필요합니다. 기본 로그인 유지 기간은 180일이며 `ORBIT_AUTH_SESSION_DAYS`로 1~365일 사이에서 바꿀 수 있습니다.

서버에 지정한 초기 비밀번호로 로그인한 뒤 **설정 → 계정 → 비밀번호 변경**에서 현재 비밀번호와 새 비밀번호(12자 이상)를 입력하세요. 현재 기기의 로그인은 유지되고 다른 기기의 세션은 즉시 무효화됩니다. 비밀번호 변경은 로그인한 사용자만 할 수 있습니다.

변경한 비밀번호는 scrypt 해시와 별도 세션 키로 `<ORBIT_VAULT_DIR>/.orbit/auth.json`에 저장됩니다(파일 권한 0600). 영구 볼륨을 유지하면 재배포 후에도 적용되며, 저장된 값이 초기 `ORBIT_AUTH_PASSWORD`보다 우선합니다. 아이디 환경변수는 계속 유지해야 합니다. 이 파일은 노트 내보내기에 포함되지 않으므로 서버 볼륨 백업에 별도로 보존하세요. 파일이 손상되면 초기 비밀번호로 되돌아가지 않고 로그인을 차단합니다.

비밀번호를 잊었다면 서버 관리자가 서비스를 중지하고 `auth.json`을 안전한 위치로 옮긴 뒤 새 `ORBIT_AUTH_PASSWORD`를 설정하고 재시작해야 합니다. 이후 로그인하고 설정에서 비밀번호를 다시 변경하세요. 일반 비밀번호 변경에는 서버 재시작이 필요하지 않습니다.

## 내 데이터

`<ORBIT_VAULT_DIR>/.orbit/orbit.sqlite`가 기본 저장소입니다. 노트 본문은 Markdown이며 첨부파일은 별도 파일로 보관합니다. 기존 vault는 처음 열 때 검증 후 자동 이관하고, 원본 파일은 수정하거나 삭제하지 않습니다. 이관 이후 원본 `.md` 파일은 자동으로 갱신되지 않습니다.

```bash
pnpm storage status
pnpm storage export /absolute/new-export
pnpm storage import /absolute/source-export
pnpm storage backup /absolute/new-backup
```

모든 명령은 같은 `ORBIT_VAULT_DIR`를 지정해서 실행하세요. 폴더 색상·순서, 화이트보드, 알 수 없는 frontmatter도 보존합니다. 이관·Docker·복원 절차는 [데이터 운영 안내](./docs/vault-and-backup.md), 저장 계약은 [아키텍처](./docs/architecture.md)를 참고하세요.

## MCP 연결

Orbit에는 로컬 stdio MCP 서버가 있습니다. 문서용 예시가 아니라 웹 앱과 같은 vault를 직접 읽고 쓰는 어댑터입니다. 호스팅된 endpoint가 아니며 웹 로그인 세션도 사용하지 않습니다.

```bash
ORBIT_VAULT_DIR=/absolute/path/to/orbit-vault pnpm mcp
```

MCP 클라이언트 설정 예시:

```json
{
  "mcpServers": {
    "orbit": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/orbit", "mcp"],
      "env": {
        "ORBIT_VAULT_DIR": "/absolute/path/to/orbit-vault"
      }
    }
  }
}
```

현재 도구:

- `orbit_capture`
- `orbit_today`
- `orbit_inbox`
- `orbit_list`
- `orbit_read`
- `orbit_file`
- `orbit_create_folder`
- `orbit_calendar`
- `orbit_search`

MCP 프로세스는 설정한 vault에 직접 읽기·쓰기 권한을 가집니다. 신뢰하는 클라이언트와 컴퓨터에서만 실행하세요.

## Docker

간편 설치는 제공된 `compose.yaml`과 [운영 안내](./docs/vault-and-backup.md)를 사용하세요. 기존 배포는 `/vault` 마운트를 유지합니다.

```bash
docker build -t orbit .
docker run --rm -p 3000:3000 \
  -e ORBIT_VAULT_DIR=/vault \
  -e ORBIT_AUTH_USERNAME=orbit \
  -e ORBIT_AUTH_PASSWORD='replace-with-a-long-random-password' \
  -v orbit-vault:/vault \
  orbit
```

앱 디렉터리는 다시 배포해도 되는 영역이고 `/vault`는 보존해야 하는 데이터 경계입니다. 네트워크에 공개할 때는 컨테이너 앞에 TLS를 두세요.

## 로드맵

다음 목표는 워크스페이스 기능을 계속 늘리는 것이 아니라, 이미 동작하는 개인 시스템 위에 작고 검토 가능한 AI 계층을 붙이는 것입니다.

1. 사용자가 직접 키를 넣는 AI provider 설정
2. 노트·할 일·일정을 함께 검색하고 요약하고 질문하기
3. 제목·태그·날짜·PARA 위치 제안
4. 파일을 바꾸기 전에 모든 변경 내용을 검토하는 화면
5. 백업·복원 경험 개선
6. 로컬 캘린더 계약이 안정된 뒤 import/export와 동기화

자세한 순서는 [로드맵](./docs/roadmap.md)에 정리되어 있습니다.

Orbit은 팀 위키, 데이터베이스 빌더, 플러그인 마켓, 파일을 계속 자동 재정리하는 자율 에이전트를 목표로 하지 않습니다.

## 개발

```bash
pnpm test       # Biome, TypeScript, unit tests
pnpm build      # production build
pnpm mcp        # local stdio MCP server
```

변경을 제안하기 전에 [CONTRIBUTING.md](./CONTRIBUTING.md)를 확인해 주세요.

## 원칙

- 데이터는 내 서버에 보관하고 Markdown으로 가져오고 내보낼 수 있어야 합니다.
- 노트, 할 일, 시간은 하나의 작은 개인 흐름 안에 있어야 합니다.
- 기록은 정리보다 가벼워야 합니다.
- AI는 선택 사항이며 검토할 변경을 제안합니다.
- 셀프호스팅은 앱 하나, 영구 데이터 폴더 하나, 별도 DB 서버 없음으로 이해 가능해야 합니다.

## License

[MIT](./LICENSE)
