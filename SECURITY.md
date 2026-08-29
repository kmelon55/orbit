# Security

## Early-stage warning

Orbit v0.1에는 자체 인증과 멀티테넌시가 없습니다. 서버를 공개 인터넷에 직접 노출하지 마세요. 로컬 네트워크, VPN, 또는 인증 프록시 뒤에서만 실행하세요.

`ORBIT_VAULT_DIR`에는 개인 정보가 포함될 수 있습니다. 해당 디렉터리, 백업 저장소, MCP 클라이언트 설정의 접근 권한을 별도로 관리해야 합니다. Vault를 공개 Orbit 소스 저장소 안에 커밋하거나 Docker 이미지에 포함하지 마세요.

## Reporting

공개 issue에 개인 데이터, vault 경로, access token을 올리지 마세요. 저장소의 Security 탭에서 비공개 vulnerability report를 보내 주세요.
