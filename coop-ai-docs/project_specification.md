# AdminAX 프로젝트 기획 및 구현 명세서

## 1. 프로젝트 개요
AdminAX는 AI 기반의 문서 분석 및 지식 검색 시스템으로, HWP/PDF 등 다양한 문서를 정규화하여 Knowledge Base를 구축하고, LLM을 활용한 고품질 RAG(Retrieval-Augmented Generation) 채팅 인터페이스를 제공하는 것을 목표로 합니다.

## 2. 주요 아키텍처 모델
* **Frontend (UI/UX)**: Vanilla JS 기반 `chat.js`
  - 파일 다중 첨부 및 Pre-upload 처리
  - SSE(Server-Sent Events)를 활용한 개별 문서 정규화 프로그레스 실시간 트래킹
  - Fetch API Stream 방식 기반의 답변 타이핑 이펙트 렌더링
* **Backend (API Gateway & Manager)**: Java Spring Boot
  - 클라이언트-서버 간 HTTP 연결 및 SSE 롱폴링 세션 관리
  - `@Async` 기반의 비동기 채널 운용을 통해 메인 쓰레드 블로킹 방지
  - 정규화 Task 및 LLM Chat Task 관리 및 모니터링
* **Message Broker (MQ)**: Redis Streams
  - Spring Boot와 Python AI 워커 간 비동기 Pub/Sub 큐 역할
  - 대용량 트래픽에 대한 버퍼링 및 시스템 결합도(Coupling) 완화
* **Worker (AI/Engine)**: Python 
  - Ingestion (문서 구조/텍스트/표/이미지 추출 및 Markdown 정규화)
  - LLM Integration (분석 및 질의응답 텍스트 생성)

## 3. 핵심 동작 흐름 (채팅 파이프라인)
1. **[UI] 문서 선-업로드 (Pre-upload)**:
   - 사용자가 채팅창에 문서를 드래그 앤 드롭 하거나 첨부 시, `/api/norm/normDocs` 앤드포인트로 문서를 전송합니다.
   - 백엔드는 임시 작업 ID(`taskId`)를 반환하며, 프론트는 이를 `pendingTaskIds` 버퍼에 기록합니다.
   - 발급된 `taskId` 기준으로 프론트는 `/api/norm/subscribe/{taskId}` (SSE)를 열어, 실시간 문서 처리율 데이터를 받아와 프로그레스 바 UI를 갱신합니다.
2. **[UI -> BE] 질의 요청 전송**:
   - 사용자가 메시지를 입력 후 전송하면, 입력된 텍스트와 현재 대기 중인 `pendingTaskIds` 배열을 묶어 `/api/chat/sendMsg` 로 POST 요청을 보냅니다.
3. **[BE] 지식 재료 분석 대기 (WAITING)**:
   - 백엔드(`ChatService`)는 질의 요청에 포함된 `task_ids`를 넘겨받습니다.
   - 프론트엔드에 `WAITING_TASKS` 상태를 내려주고, Redis 폴링을 통해 모든 문서가 정규화 완료 상태(`COMPLETED`)가 될 때까지 코드 상에서 폴링/대기합니다.
4. **[BE -> Python] LLM 생성 대기 (GENERATING)**:
   - 정규화가 완료되면 해당 문서에서 추출된 Context(내용, JSON 덤프 등)를 질의 메시지와 함께 Redis Stream(`adminax:chat:stream`)에 적재합니다.
   - 동시에 프론트엔드에 `GENERATING` 이벤트를 내려주고, 결과 큐(`adminax:chat:result`)에 Python 워커의 답변이 도달할 때까지 대기합니다.
5. **[Python -> BE -> UI] 응답 반환 (COMPLETED)**:
   - 워커로부터 답변을 전달받으면 프론트엔드에 `COMPLETED` 상태 데이터와 답변 텍스트를 발송한 뒤 SseEmitter를 정상 완료(`complete()`)시킵니다.
   - 프론트는 받은 텍스트를 UI에 타이핑 효과로 출력합니다.
