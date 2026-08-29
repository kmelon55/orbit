# Vault and backup

Orbit의 데이터 원본은 로컬 또는 서버 파일시스템의 vault다. GitHub와 S3 호환 스토리지는 원본에 직접 쓰는 백엔드가 아니라, 원본에서 비동기로 생성하는 복구 사본이다.

## 권장 배치

```text
개발 컴퓨터
├── /path/to/orbit                 # 공개 가능한 애플리케이션 저장소
└── /path/to/orbit-vault           # 개인 vault

서버
├── Dokploy가 관리하는 애플리케이션
└── /srv/orbit/vault               # 컨테이너의 /vault에 bind mount
```

배포 서버에서 웹 UI를 주로 사용한다면 `/srv/orbit/vault` 하나를 쓰기 원본으로 정한다. 여러 컴퓨터가 각자 vault를 수정한 뒤 Git push로 합치는 방식은 자동 저장과 충돌하므로 권장하지 않는다.

## Object key 계약

Orbit이 새로 만드는 Markdown 경로는 다음 형태다.

```text
<space>/<optional-folder>/<yyyy-mm-dd>-<title-slug>-<id8>.md
```

- 최상위 space는 `inbox`, `projects`, `areas`, `resources`, `events`, `archive` 중 하나다.
- API에 표시되는 `item.path`는 운영체제와 무관하게 `/`를 사용한다.
- 새 slug는 Unicode NFC로 정규화한다.
- `/`, `\\`, 제어문자, 앞뒤 점은 slug에서 제거한다.
- 제목은 frontmatter에 남으므로 파일명은 식별과 복구를 위한 보조 정보다.

따라서 로컬의 `projects/orbit/2026-08-27-release-a1b2c3d4.md`는 원격에서 아래처럼 일대일로 대응할 수 있다.

```text
s3://<bucket>/vaults/<vault-name>/projects/orbit/2026-08-27-release-a1b2c3d4.md
```

`vault-name`은 `personal`, `work`, `archive-2026`처럼 소문자 영문, 숫자, 하이픈만 사용하는 것을 권장한다.

## Git snapshot

Markdown 위주의 작은 vault는 별도 private Git 저장소로 변경 이력을 남길 수 있다. 공개 Orbit 소스 저장소의 하위 경로나 브랜치로 넣지 않는다.

```bash
git -C /absolute/path/to/orbit-vault init -b main
git -C /absolute/path/to/orbit-vault add -A
git -C /absolute/path/to/orbit-vault commit -m "vault snapshot"
git -C /absolute/path/to/orbit-vault remote add origin <private-repository-url>
git -C /absolute/path/to/orbit-vault push -u origin main
```

자동화는 한 곳에서만 실행하고, 변경이 있을 때만 commit한 뒤 push한다. GitHub private 저장소도 계정 탈취나 실수로 삭제될 수 있으므로 유일한 백업으로 간주하지 않는다.

## S3-compatible backup

R2를 포함한 S3 호환 스토리지에는 복구 가능한 object version history가 항상 있다고 가정하면 안 된다. 가장 단순한 안전장치는 rclone의 `copy`를 실행할 때마다 덮어쓰지 않는 snapshot prefix를 사용하는 것이다. `sync`는 원본 삭제를 원격에도 즉시 반영하므로 백업 기본값으로 사용하지 않는다.

```bash
rclone copy /absolute/path/to/orbit-vault \
  s3:orbit-backup/snapshots/personal/2026-08-27T120000Z \
  --exclude '/.git/**'
```

R2에서는 snapshot prefix에 bucket lock을 적용해 정해진 기간 동안 삭제와 덮어쓰기를 막을 수 있다. 앱이 사용하는 `vaults/personal/current/` prefix에는 계속 저장해야 하므로 같은 lock을 적용하지 않는다.

민감한 vault를 저장 사업자가 읽을 수 없게 하려면 restic 같은 클라이언트 암호화 백업을 추가한다. 인증키는 Orbit 저장소나 vault frontmatter에 두지 않고 서버 secret 또는 비밀번호 관리자에서 관리한다.

권장 최소 주기는 Git snapshot 한 시간, 암호화 백업 하루 한 번이다. 실제 운영 전에는 빈 디렉터리에 복원해 Markdown 수와 주요 첨부파일을 확인하는 복구 테스트를 한 번 수행한다.
