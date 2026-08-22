# Contributing to Orbit

Orbit은 작은 코어와 명확한 파일 계약을 우선합니다. 기능을 제안하거나 구현할 때 다음 질문을 먼저 확인해 주세요.

1. AI나 외부 서비스가 없어도 기본 흐름이 유지되는가?
2. 사용자의 핵심 상태가 Markdown/YAML에 남는가?
3. SQLite나 캐시는 삭제 후 재생성할 수 있는가?
4. 외부 에이전트의 변경이 사용자 승인 경계를 우회하지 않는가?
5. 기존 파일의 알 수 없는 frontmatter를 보존하는가?

## Local checks

```bash
pnpm install
pnpm test
pnpm build
```

Pull request는 한 가지 제품 경계만 다루고, 파일 포맷 변경이 있으면 `docs/architecture.md`와 예제 파일을 함께 갱신해 주세요.
