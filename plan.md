# AdminAX RAG 시스템 구현 계획 (Implementation Plan)

## 1. 개요 (Overview)
본 문서는 AdminAX의 RAG(Retrieval-Augmented Generation) 시스템 아키텍처 및 구현 계획을 기술합니다. 핵심 목표는 효율적이고 정확한 문서 검색과 토큰 비용을 최소화한 AI 기반 답변 제공입니다.

## 2. 핵심 질문 및 타당성 분석 (Core Questions & Feasibility)

### Q: 검색 부분을 AI(LLM) 없이 구현 가능한가?
**답변: 가능합니다 (YES).**
- **기존 방식의 문제점:** 모든 문서를 LLM에게 일일이 스캔시키는 방식(MCP 등)은 속도가 매우 느리고 토큰 비용이 과다하게 발생하여 비현실적입니다.
- **올바른 접근 방식:** 검색(Retrieval) 단계에서는 전문 검색 엔진인 **Elasticsearch**를 활용해야 합니다.
  - **키워드 검색 (BM25):** 전통적인 검색 방식으로 속도가 빠르고 AI 비용이 전혀 없습니다.
  - **벡터 검색 (Vector Search):** 문서를 벡터화하여 의미 기반 검색을 수행합니다. 임베딩 모델(예: `fastembed`, `sentence-transformers`)은 로컬 CPU에서도 충분히 구동 가능하며, LLM 생성 비용 대비 매우 저렴합니다.

### Q: 자체 필터링 후 프롬프트 구성 방식이 AI 직접 스캔보다 나은가?
**답변: 그렇습니다 (YES).**
- **컨텍스트 윈도우 한계:** LLM은 처리 가능한 토큰 수에 한계가 있어 기업의 방대한 문서를 한 번에 입력할 수 없습니다.
- **속도 및 비용:** 쿼리당 수십만 토큰을 처리하면 응답 속도 저하와 비용 문제가 심각해집니다.
- **정확도:** "Lost in the Middle" 현상(긴 문맥 중간의 정보를 망각하는 현상)을 방지하기 위해, 검색 엔진을 통해 **가장 관련성 높은 정보만 선별하여 제공**하는 것이 답변 품질을 높이는 핵심입니다.

## 3. 아키텍처 매핑 (Architecture Mapping)
제공해주신 아키텍처 다이어그램은 **AdminAX**의 현재 기술 스택과 완벽하게 일치하며, 실현 가능한 구조입니다.

| 다이어그램 구성요소 | Docker 서비스 (컨테이너) | 역할 및 구현 내용 |
| :--- | :--- | :--- |
| **게이트웨이 (Proxy Gateway)** | `gateway` (Nginx) | 외부 요청을 내부 서비스로 라우팅, SSL 처리, 정적 파일 서빙 |
| **채팅 UI (모델 래퍼)** | `presentation` (React/Vue) | 사용자 인터페이스, LLM 응답 스트리밍 표시 |
| **관리자 UI (Admin Console)** | `presentation` (React/Vue) | 문서 업로드, 사용자 관리, 시스템 설정 |
| **엔진 (Core Engine)** | `core-engine` (Spring Boot) | 비즈니스 로직, 인증/인가, API 서버 |
| **Orchestrator & Hub Adapter** | `core-engine` 내부 모듈 | 요청 처리 흐름 제어, 외부 LLM 및 내부 에이전트 연결 |
| **문서 분석 Agent** | `converter-worker` (Python) | 문서 파싱, 텍스트 추출, 임베딩 생성 (Background Worker) |
| **검색/답변 Agent** | `core-engine` 서비스 로직 | Elasticsearch 검색 수행, 프롬프트 구성, LLM 호출 |
| **AI 지식베이스** | `elasticsearch` | 벡터(Vector) 및 키워드 인덱스 저장소 |
| **RDB (메타데이터)** | `db` (PostgreSQL) | 문서 메타정보, 사용자 정보, 채팅 기록 저장 |
| **파일 저장소** | `shared-docs` (Volume) | 원본 문서 파일 저장 |
| **AI 모델 서버 (Inference Server)** | `ollama` (Optional in Dev) | 로컬 LLM 및 임베딩 모델 실행 (Qwen, Llama 등) |
| **외부 LLM API** | 외부 서비스 (OpenAI/Anthropic) | (옵션) 고성능 모델 필요 시 사용 |

## 4. 상세 워크플로우 (Detailed Workflow)

### 1단계: 데이터 수집 및 분석 (Ingestion Pipeline) - "문서 분석 Agent"
1.  **문서 업로드**: 사용자 -> Gateway -> **Core Engine** -> File Storage
2.  **분석 요청**: Core Engine -> Redis (Message Queue) -> **Converter Worker**
3.  **데이터 추출 및 가공**:
    -   *상세 로직은 `pipeline.md` 참조*
    -   **Converter Worker**가 문서를 가져와 텍스트 추출
    -   **Ollama (또는 로컬 라이브러리)** API를 호출하여 임베딩 생성
    -   *개발 환경(4GB RAM)에서는 Worker 내부에서 경량 라이브러리(FastEmbed) 사용 권장, 운영 환경에서는 Ollama 서버 사용*
4.  **저장**:
    -   메타데이터 -> **RDB**
    -   텍스트 및 벡터 -> **Elasticsearch (AI 지식베이스)**

### 2단계: 검색 및 답변 (Retrieval & Generation) - "검색/답변 Agent"
1.  **질문 수신**: 사용자 -> Gateway -> **Core Engine**
2.  **하이브리드 검색 (Orchestrator)**:
    -   **Core Engine**이 질문을 벡터화
    -   **Elasticsearch**에 키워드 + 벡터 검색 요청
    -   상위 관련 문서(Context) 획득
3.  **답변 생성 (Hub Adapter)**:
    -   검색된 문맥을 포함한 프롬프트 생성
    -   **Ollama (Local LLM)** 또는 **외부 LLM API** 호출 (설정에 따라 선택)
4.  **응답 반환**: 생성된 답변을 사용자에게 전달

## 5. 구현 단계 (Implementation Steps)

### Step 1: 데이터베이스 & Elasticsearch 스키마 설정
- PostgreSQL: 문서 및 청크 테이블 설계
- Elasticsearch: `dense_vector`를 포함한 인덱스 템플릿 설정

### Step 2: 문서 분석 에이전트 (Converter) 구현
- `converter/worker.py` 고도화: 텍스트 추출 및 임베딩 생성 로직 추가
- Redis Stream을 통한 비동기 작업 처리 구현

### Step 3: 코어 엔진 (Orchestrator/Adapter) 구현
- 파일 업로드 및 관리 API
- 검색 로직 (Elasticsearch Query Builder)
- LLM 클라이언트 (LangChain 또는 자체 구현)

### Step 4: 프레젠테이션 계층 연동
- 채팅 인터페이스 및 문서 관리 UI 구현

## 6. 기술 스택 추천
- **모델 서버:** `Ollama` (표준 호환성, 모델 교체 용이)
- **임베딩 모델:** `Qwen/Qwen3-Embedding-0.6B` (Ollama 등에서 구동)
- **벡터 DB:** Elasticsearch 8.x (기존 컨테이너 활용)
- **LLM 인터페이스:** Spring AI 또는 LangChain4j (Java 기반 통합 용이)
