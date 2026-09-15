# Contributing to Orbit

Orbit은 작은 코어와 명확한 저장 계약을 우선합니다. 기능을 제안하거나 구현할 때 다음 질문을 먼저 확인해 주세요.

1. AI나 외부 서비스가 없어도 기본 흐름이 유지되는가?
2. 사용자의 핵심 상태가 SQLite에 안전하게 저장되고 Markdown으로 내보내지는가?
3. 저장 변경이 트랜잭션과 스키마 이관으로 보호되고 백업·복원 가능한가?
4. 외부 에이전트의 변경이 사용자 승인 경계를 우회하지 않는가?
5. 기존 파일의 알 수 없는 frontmatter를 보존하는가?

## Local checks

```bash
pnpm install
pnpm test
pnpm build
```

Pull request는 한 가지 제품 경계만 다루고, 파일 포맷 변경이 있으면 `docs/architecture.md`와 예제 파일을 함께 갱신해 주세요.
