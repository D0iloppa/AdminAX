# AdminAX 데이터 처리 파이프라인 (Data Processing Pipeline)

## 1. 아키텍처 결정 (Architecture Choice)
**결정 사항**: **Converter (Python)가 Canonical JSON 생성까지 전담합니다.**
- **이유**: Converter는 이미 무거운 임베딩 모델(Qwen-0.6B)을 로드하고 있습니다. 텍스트만 추출해서 Java로 보내고, Java가 다시 파싱해서 임베딩 요청을 보내는 구조는 비효율적입니다. 또한 Python이 텍스트 청킹(Chunking) 및 벡터 연산에 더 적합합니다.
- **Java의 역할**: 철저한 오케스트레이터 & 저장소 관리자 역할만 수행합니다. 최종 구조화된 데이터를 받아 DB/Elasticsearch에 적재하는 역할에 집중합니다.

## 2. 파이프라인 단계 (Pipeline Stages)

### 1단계: 수집 및 요청 (Ingestion) - [Java -> Redis]
- **동작**: 사용자가 API를 통해 파일을 업로드합니다.
- **Java**:
  1. 파일을 공유 볼륨(`shared-docs/raw/{uuid}.hwp`)에 저장합니다.
  2. Redis Stream `adminax:convert:stream`으로 변환 요청 메시지를 보냅니다.
- **메시지 스키마**:
  ```json
  {
    "docId": "b8d5...",
    "filePath": "/app/shared-docs/raw/manual.hwp",
    "fileType": "hwp"
  }
  ```

### 2단계: 변환 및 가공 (Processing) - [Converter]
- **동작**: Worker가 `adminax:convert:stream`을 리스닝하다가 작업을 가져갑니다.
- **Python**:
  1. **변환 (Conversion)**: HWP/PDF -> Markdown (텍스트 추출)
  2. **청킹 (Chunking)**: Markdown을 논리적 단위(예: 500 토큰)로 분할
  3. **임베딩 (Embedding)**: `Qwen3-Embedding` 모델을 사용해 각 청크의 벡터 생성
  4. **구조화 (Construction)**: Canonical JSON 생성
- **출력 스키마 (Canonical JSON)**:
  ```json
  {
    "docId": "b8d5...",
    "status": "SUCCESS",
    "content": {
      "title": "사용자 매뉴얼",
      "chunks": [
        {
          "id": 0,
          "text": "사용자 매뉴얼 1장...",
          "metadata": { "page": 1 },
          "vector": [0.123, -0.456, ...]
        },
        ...
      ]
    }
  }
  ```
- **동작**: 결과를 Redis Stream `adminax:result:stream`으로 전송합니다.
  - *참고*: JSON 크기가 Redis 허용량을 초과할 수 있으므로, **JSON 파일을 공유 볼륨(`shared-docs/json/{uuid}.json`)에 저장하고 그 경로만 Redis로 전달**합니다.

### 3단계: 적재 (Persistence) - [Java]
- **동작**: Java 리스너가 `adminax:result:stream`을 소비합니다.
- **수신 메시지**:
  ```json
  {
    "docId": "b8d5...",
    "status": "SUCCESS",
    "jsonPath": "/app/shared-docs/json/b8d5.json"
  }
  ```
- **Java**:
  1. JSON 파일을 읽습니다.
  2. 메타데이터를 PostgreSQL에 저장합니다.
  3. 청크(텍스트 + 벡터)를 Elasticsearch에 벌크 인서트(Bulk Insert)합니다.

## 3. 테스트 전략 (Test Strategy)

전체 통합 전, 각 단계의 인터페이스를 검증하기 위한 독립형 스크립트를 사용합니다.

| 테스트 스크립트 | 범위 | 목적 |
|:--- |:--- |:--- |
| `test_stage1_mock_java.py` | Java -> Redis | Java가 척하고 변환 요청을 Redis에 보냄. 정상 수신 여부 확인. |
| `test_stage2_worker_logic.py` | Converter 로직 | 가짜 파일을 입력받아 변환, 청킹, 임베딩, JSON 생성까지 전체 로직 검증. |
| `test_stage3_mock_java_consumer.py` | Redis -> Java | Worker가 척하고 결과 메시지를 보냄. Java(Mock)가 정상 수신하는지 확인. |

## 4. Canonical JSON 스키마 정의
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "docId": { "type": "string" },
    "chunks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "vector": { "type": "array", "items": { "type": "number" } }
        }
      }
    }
  }
}
```
