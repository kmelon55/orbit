# Orbit Mail

Orbit의 단일 사용자 로그인 아래 Gmail·iCloud·네이버 계정을 연결하는 개인용 웹 메일 클라이언트입니다. 노트·할 일·일정은 기존 Markdown vault를 계속 사용합니다.

## 사용

사이드바 **Mail → 메일 설정**에서 계정을 연결합니다. 모바일에서는 왼쪽 상단 메뉴로 Mail에 들어갑니다.

- 모든 계정의 받은 메일을 모아 보거나 계정 하나를 선택할 수 있습니다.
- 받은 메일·보낸 메일·휴지통·보관함, 검색, 계정별 이전 메일 페이지를 지원합니다. 통합 목록은 계정별 최근 50개씩을 보여줍니다. 검색은 제공자 서버에 요청하며 계정별로 추가 페이지를 가져올 수 있습니다.
- 작성·답장·전체 답장·전달, 참조·숨은 참조, 파일 첨부, 읽음·읽지 않음, 휴지통 이동·보관을 지원합니다. 휴지통에서 영구 삭제는 제공하지 않습니다. iCloud·네이버의 보관함은 해당 서버에 실제 폴더가 있어야 합니다.
- 답장은 수신 계정과 Reply-To를 사용하고 본인 주소·중복 수신자를 제외합니다. 전달은 원본 첨부파일을 포함합니다.
- 작성 내용과 첨부파일은 800ms 후 서버에 암호화해 임시저장합니다. 브라우저에는 초안 ID만 남깁니다. 초안은 Orbit 전용이며 제공자의 Drafts 폴더와 동기화하지 않습니다. 같은 초안을 두 창에서 수정하면 오래된 쓰기는 거절합니다.
- 발송 요청 ID를 영구 기록합니다. 발송 결과가 불확실하면 자동 재발송하지 않습니다. 보낸 메일함에서 확인한 후 필요하면 초안을 삭제하고 새 메일을 작성하세요.
- 이미지·PDF·텍스트·지원되는 음성/동영상은 브라우저에서 열고, 나머지 파일은 다운로드합니다. Office/HWP 변환 뷰어는 포함하지 않습니다. 원본 메일은 최대 35MiB, 발송 첨부 합계는 15MiB·15개까지입니다.

## Gmail 최초 연결

1. Google Cloud에서 프로젝트를 선택하고 **Gmail API**를 사용 설정합니다.
2. Google Auth Platform에서 앱 이름과 대상 사용자를 설정합니다. Testing으로 시작한다면 본인 Gmail을 테스트 사용자로 추가합니다.
3. **웹 애플리케이션** 유형의 OAuth 클라이언트를 만들고, 승인된 리디렉션 URI에 다음 형식의 주소를 등록합니다.

   ```text
   https://YOUR-ORBIT-HOST/api/mail/oauth/callback
   ```

   `orbit.lab-42.xyz` 배포에서는 `https://orbit.lab-42.xyz/api/mail/oauth/callback`입니다. 로컬 개발 서버 주소로 대체하면 운영 연결에 사용할 수 없습니다.
4. Orbit **메일 설정 → 서버 연결 설정**에 Orbit HTTPS 주소·클라이언트 ID·클라이언트 보안 비밀번호를 입력하고 저장합니다. 이 값은 서버에 암호화됩니다. 환경변수로 설정한 값이 있으면 환경변수가 우선합니다.
5. **Google로 Gmail 연결**을 누르고 본인 계정으로 승인합니다. 요청 범위는 읽기·발송·읽음·라벨·휴지통 처리를 위한 `gmail.modify`입니다.

OAuth Testing 상태의 Gmail refresh token은 7일 후 만료될 수 있습니다. 장기 개인 사용은 Google의 앱 게시 상태와 개인 사용 예외 조건을 확인해야 합니다. 공개 서비스로 전환하면 사용자 격리·OAuth 검증 등의 범위가 별도로 필요합니다. [Google OAuth 토큰 만료 조건](https://developers.google.com/identity/protocols/oauth2), [제한 범위 검증과 개인 사용 예외](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

## iCloud·네이버

- iCloud: Apple 계정의 **앱 전용 비밀번호**를 생성하고 전체 메일 주소와 함께 입력합니다. 수신 `imap.mail.me.com:993` TLS, 발송 `smtp.mail.me.com:587` STARTTLS를 사용합니다. [Apple 공식 설정](https://support.apple.com/102525)
- 네이버: 2단계 인증·애플리케이션 비밀번호를 설정하고, 메일 환경설정에서 IMAP/SMTP 사용을 켭니다. 수신 `imap.naver.com:993` TLS, 발송 `smtp.naver.com:587` STARTTLS를 사용합니다. [네이버 공식 설정](https://help.naver.com/service/30029/contents/21344?osType=COMMONOS)

연결 시 IMAP 로그인과 SMTP 인증을 모두 확인합니다. 임의 SMTP 호스트·인증서 검증 해제는 제공하지 않습니다. 재연결은 같은 주소로 연결 정보를 다시 입력하면 됩니다.

## 폰·웹 알림

**메일 설정 → 이 기기 알림 켜기**를 누르고 브라우저 권한을 허용한 후 **테스트 알림**으로 확인합니다. 기본 알림에는 보낸 사람과 제목이 표시되며 설정에서 숨길 수 있습니다. 계정별 알림 끄기도 지원합니다.

아이폰은 iOS 16.4 이상에서 홈 화면에 Orbit을 추가한 뒤 그 아이콘으로 열어야 합니다. 안드로이드·PC는 Web Push 지원 브라우저에서 사용할 수 있습니다. HTTPS, 기기의 알림 권한, 계속 실행 중인 Orbit 서버가 필요합니다. OS 절전·집중 모드에 따라 지연될 수 있습니다. [Apple Web Push 안내](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

- Gmail 기본 동작은 60초 간격 확인입니다. 즉시 감지가 필요하면 아래 Pub/Sub 설정을 추가합니다.
- iCloud·네이버는 별도 IMAP 연결로 IDLE 지원 여부를 확인해 실시간 변경을 감지하며, 미지원·연결 끊김에 대비해 60초 간격 확인을 병행합니다.
- 첫 동기화의 기존 메일에는 알림을 보내지 않습니다. 이후 새로 발견한 읽지 않은 수신 메일만 알립니다. 동일 메일 ID를 기록해 반복 알림을 막습니다.
- 푸시 전송 실패는 SQLite 큐에서 최대 1시간 동안 재시도합니다. 만료된 구독은 제거합니다. 발송된 푸시의 최종 기기 표시까지 보장하는 것은 아닙니다.
- 로그아웃 시 해당 브라우저 구독을 해제하고, 비밀번호 변경·세션 만료 뒤의 구독은 전송 시 제거합니다. 서버·네트워크 오류로 구독 해제가 실패한 경우 기기 설정에서 알림을 끌 수 있습니다.

### Gmail 즉시 감지 (선택)

Google Cloud Pub/Sub 주제를 만들고 `gmail-api-push@system.gserviceaccount.com`에 해당 주제의 Pub/Sub Publisher 권한을 부여합니다. **인증된 push subscription**의 endpoint와 OIDC audience를 모두 다음 주소로 지정합니다.

```text
https://YOUR-ORBIT-HOST/api/mail/gmail/push
```

OIDC용 서비스 계정을 지정하고 다음 환경변수를 설정합니다.

```dotenv
ORBIT_GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/orbit-mail
ORBIT_GMAIL_PUSH_EMAIL=SERVICE_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com
```

서버는 Google 서명·audience·서비스 계정 이메일을 검증합니다. Gmail watch를 자동 갱신하고, 알림 누락과 watch 오류에도 주기적 동기화를 유지합니다. Pub/Sub 과금·할당량은 본인의 Google Cloud 프로젝트를 따릅니다. [Gmail push 설정](https://developers.google.com/workspace/gmail/api/guides/push)

## 운영·데이터

Node.js 22.16 이상과 영구 쓰기 가능한 디스크가 필요합니다. 기존 Docker의 Node 22 이미지에서 실행합니다. **단일 컨테이너/단일 프로세스**를 대상으로 하며 같은 mail DB를 여러 replica가 동시에 운영하는 구성은 지원하지 않습니다. Nitro startup plugin이 서버 시작 시 worker를 시작하므로 Mail 화면을 열어둘 필요가 없습니다.

기본 저장 경로는 `${ORBIT_VAULT_DIR}/.orbit/mail`입니다. 호환 `ORBIT_DATA_DIR`도 지원합니다.

- `mail.sqlite`: 계정 메타데이터, 암호화된 인증정보·메일 목록 캐시·초안·푸시 구독, 발송 요청 기록, 알림 큐. 메일 본문과 수신 첨부파일은 요청 시 제공자에서 가져오며 디스크에 캐시하지 않습니다.
- `secret.key`: 최초 사용 시 생성하는 32바이트 암호화 키. 디렉터리 0700, 키와 DB 0600. 키와 DB가 같은 디스크에 있으므로 디스크 전체 유출에 대한 방어를 뜻하지는 않습니다.
- `mail.sqlite-wal`, `mail.sqlite-shm`: SQLite WAL 상태. 가동 중 백업은 SQLite backup API를 사용하거나 서버를 멈춘 후 디렉터리 전체를 백업합니다. `secret.key`도 반드시 보존합니다. 기존 DB의 키를 잃어버리면 자동 재생성하지 않습니다.
- `ORBIT_MAIL_ENCRYPTION_KEY`를 설정하면 별도 관리한 64자리 hex 키를 사용합니다. 이미 생성된 키를 임의로 바꾸면 기존 암호화 데이터를 읽을 수 없습니다.
- 계정 연결 해제는 해당 계정의 인증정보·캐시·발송 기록·초안·알림 큐만 제거합니다. 제공자에 있는 원본 메일은 유지합니다.
- 브라우저 서비스워커는 정적 아이콘만 캐시하며 개인 페이지·메일 API·첨부파일을 캐시하지 않습니다. 메일 HTML은 서버에서 정리한 뒤 스크립트와 같은 출처 권한이 없는 iframe에 표시합니다. 외부 이미지는 기본 차단합니다.

```dotenv
# Optional: UI settings can supply these values instead.
ORBIT_PUBLIC_URL=https://YOUR-ORBIT-HOST
ORBIT_GMAIL_CLIENT_ID=
ORBIT_GMAIL_CLIENT_SECRET=
# Optional overrides (normally leave unset)
# ORBIT_MAIL_DIR=/persistent/path/mail
# ORBIT_MAIL_ENCRYPTION_KEY=<64 hex characters>
# ORBIT_MAIL_WORKER=off
```

## 검증 경계

`pnpm test`는 인증·CSRF·OAuth PKCE/nonce·MIME·첨부·HTML 격리·중복 발송·IMAP UID 변경·초안 충돌·푸시 처리를 외부 발송 없이 검증합니다. 실제 제공자 계정으로의 로그인, 수신·발송, IMAP IDLE와 폰 잠금화면 수신은 운영 설정 후 별도 확인해야 합니다.

`pnpm build && pnpm test:mail-runtime`는 임시 vault로 실제 프로덕션 서버를 실행해 인증·메일 API·CSRF를 확인한 뒤 테스트 서버만 종료합니다. 개발 서버는 건드리지 않습니다. Nitro의 SSR 재분할에서 발생한 초기화 순서 오류를 피하기 위해 서버 번들은 하나로 묶으며, 브라우저의 라우트별 코드 분할은 유지합니다.
