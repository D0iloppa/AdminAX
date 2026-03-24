# AdminAX 채팅 파이프라인 구조 보완 및 수정 체크리스트

## 1. 백엔드(Spring Boot) 수정 사항

### [ ] SseEmitter 타임아웃 불일치(Timeout Mismatch) 해결
- **위치**: `ChatController.java` (`sendMessage` 메서드)
- **상세 명세**: 현재 SseEmitter 객체 생성 시 타임아웃이 2분(`120_000L`)으로 하드코딩 되어 있습니다. 하지만 `ChatService` 측에는 `waitForTasks` (최대 5분 폴링), `waitForPythonResponse` (최대 1분 폴링) 로직이 존재하여 총 대기 시간이 2분을 넘길 소지가 다분합니다. 지정된 시간이 초과되면 503 Service Unavailable 오류 또는 파이프파손 에러가 발생하여 클라이언트와의 연결이 끊어집니다.
- **수정 목표**: 
  - `new SseEmitter(-1L)` 또는 `new SseEmitter(600_000L)` (10분) 등 타임아웃을 안전한 길이로 연장해야 합니다.
  - (선택) 초기 생성 시 Nginx나 로드밸런서 계층의 유휴 타임아웃을 방지하기 위해 생성 직후 더미 메시지 `SseEmitter.event().name("CONNECT")` 를 한 번 보내두는 것을 권장합니다.

### [ ] 클라이언트 이탈 시 비동기 루프 종료(자원 누수 방지)
- **위치**: `ChatService.java` (`processChatMessageAsync` 내부의 Polling 메서드들)
- **상세 명세**: 사용자가 채팅창에서 새로고침을 하거나 다른 페이지로 이탈할 경우 SseEmitter 연결은 끊기지만 백엔드 애플리케이션의 `@Async` 쓰레드는 종료된 줄 모르고 `Redis`를 계속해서 조회(Polling)하는 백그라운드 좀비 활동을 이어가 자원을 소모합니다.
- **수정 목표**: 
  - SseEmitter 객체의 `.onCompletion()`, `.onTimeout()`, `.onError()` 콜백을 등록하여 연결 끊김 상태를 감지하는 플래그(`boolean isConnected`)를 선언하세요.
  - `waitForTasks` 및 `waitForPythonResponse`의 `while` 루프 안에서 플래그 상태를 확인하여 끊어졌다면 `break;` 또는 `return;`으로 빠르게 스레드를 종료시키도록 로직을 추가하십시오.

---

## 2. 프론트엔드(UI/JavaScript) 수정 사항

### [ ] 비표준 SSE Fetch Stream 버퍼 파싱 취약점 보완
- **위치**: `chat.js` (`sendMessage` 메서드 내부 파싱 로직 `buffer.split('\n')`)
- **상세 명세**: POST 방식을 사용하기 위해 Fetch Stream `reader.read()`로 바이트 스트림을 수동 파싱 중인데, 기준 문자를 `\n` 으로 삼고 있습니다. 만약 AI가 답변 텍스트 내에 단순 줄바꿈(`\n`)을 포함하여 스트리밍한다면 JSON String 문맥이 파괴되어 `JSON.parse` 단계에서 구문 오류(Syntax Error)가 일어나고 메시지 출력이 멈출 것입니다.
- **수정 목표**:
  - 데이터 블록을 분할하는 기준 문자를 SSE 표준인 빈줄 `\n\n` 로 변경하여 `split('\n\n')` 하는 구조로 알고리즘을 변경해야 합니다.
  - অথবা 파싱 로직의 복잡성을 회피하기 위해 `fetch-event-source` 와 같은 오픈소스 라이브러리를 도입하여 POST 기반 SSE 통신을 안정적으로 리스닝하는 방식도 고려해볼 수 있습니다.

### [ ] 오류 및 예외 발생 시 UI 애니메이션 '무한 로딩(좀비)' 리셋 보장
- **위치**: `chat.js` (`sendMessage` 메서드 `while(!done)` 블록)
- **상세 명세**: 중간에 네트워크 통신 오류가 발생하거나 예상 못한 파싱 에러 등으로 `try` 문 내 루프가 강제 중단될 경우, `isGenerating` 플래그가 `true` 상태로 남아있게 되면서 스피너나 타이핑 애니메이션이 멈추지 않고, 전송 버튼도 영구적으로 비활성 모드에 갇히는 현상이 발생합니다.
- **수정 목표**: Fetch 통신부를 `try-finally` 로 블록 처리하고, `finally` 구문에 `stopGeneration();` 등의 상태 리셋 함수를 명시적으로 삽입하여 프론트엔드가 어떠한 상황에서도 에러 출력 후 대기 모드로 안전히 돌아오게끔 UI 결함을 보완하십시오.

### [ ] 파일만 첨부하고 텍스트를 입력하지 않았을 때의 Edge Case 대응 
- **위치**: `chat.js` (`sendMessage` 메서드 내부 빈 텍스트 무시 조건)
- **상세 명세**: `!text && pendingTaskIds.size === 0` 로직에 따르면 파일만 첨부하고 채팅 내용을 치지 않아도 요청이 처리됩니다. 그런데 이때 `message` 변수에 빈 문자열이 담겨 워커까지 전달되므로, AI 워커 측에서 사용자의 특별한 '명령어' 없이 주어진 파일 Context만 들고 어떤 목표로 응답을 만들어야 하는지 지시가 애매해질 수 있습니다.
- **수정 목표**: 
  - JS 단에서 `message`가 비어있다면 `"첨부된 문서들의 핵심 요약을 제공해줘."` 등의 기본 프롬프트를 주입해서 보내거나,
  - Python 워커의 Prompt Template 단에서 입력된 Question 값이 빈 값일 경우 스스로 요약 동작으로 전환하는 예외 처리 템플릿(Branching)을 갖추어야 합니다.
