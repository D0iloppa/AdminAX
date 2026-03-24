# Converter 모듈 고도화 계획

## 현재 구조 (As-Is)

현재 모든 로직이 `converter/worker.py` 단일 파일에 혼재되어 있습니다.

```
converter/
├── worker.py          ← 변환 로직 + Redis 워커 루프 + AI 호출이 전부 여기에
├── test_pipeline.py   ← Redis에 직접 메시지를 push하는 통합 테스트 (단위 테스트 불가)
└── prompt_template.txt
```

### 현재 `worker.py` 내부 구조

| 섹션 | 함수 | 역할 |
|------|------|------|
| 유틸 | `send_status` | Redis에 상태 Push |
| 유틸 | `repair_json` | AI 응답 JSON 복구 |
| 유틸 | `get_prompt_templates` | 프롬프트 파일 로드 |
| **변환** | `convert_to_pdf` | LibreOffice PDF 변환 |
| **변환** | `split_pdf_to_md_pages` | PDF → 페이지별 MD |
| **변환** | `extract_hwp_text` | HWP 네이티브 텍스트 추출 |
| **변환** | `extract_hwpx_text` | HWPX 네이티브 텍스트 추출 |
| **AI** | `extract_canonical_json_with_ai` | Adapter API 호출, JSON 생성 |
| **파이프라인** | `process_chain` | 변환 + AI 전체 조율 |
| **워커** | `main` | Redis 루프 (메시지 수신 → 처리 → 응답) |

### 현재 문제점

1. **낮은 테스트 가능성**: 단위 테스트를 하려면 Redis 서버와 Adapter 서버가 함께 떠 있어야 함
2. **책임 혼재**: 파일 하나에 "변환 로직", "AI 호출", "Redis 메시징"이 섞여서 유지보수 어려움
3. **재사용 불가**: 다른 컴포넌트가 변환 기능만 쓰고 싶어도 worker 전체를 import해야 함

---

## 목표 구조 (To-Be)

```
converter/
├── converter.py       ← [NEW] 변환 전용 모듈 (외부 의존 없음: 파일 I/O, subprocess만)
├── worker.py          ← [MODIFY] Redis 워커 루프만 담당 (converter.py 호출)
└── test_converter.py  ← [NEW] CLI 단위 테스트 (인자로 파일 경로 받아 변환 결과 stdout 출력)
```

---

## To-Be 파일별 책임

### 1. `converter.py` — 순수 변환 엔진

**책임**: 파일을 받아 Canonical JSON을 만드는 것까지 담당. Redis / 네트워크 없이 독립 실행 가능.

```python
# 주요 공개 인터페이스
def convert(file_path: str, doc_uuid: str, adapter_url: str, prompt_file: str) -> dict:
    """
    단일 진입점. 파일 경로를 받아 결과 dict를 반환.
    
    Returns:
        {
          "success": bool,
          "json_path": str,     # 성공 시 저장된 JSON 경로
          "error": str          # 실패 시 에러 메시지
        }
    """
```

내부 private 함수:
- `_extract_text(file_path, doc_uuid)` → 포맷별 텍스트 추출 (HWP, HWPX, PDF, 기타)
- `_convert_to_pdf(input_path)` → LibreOffice PDF 변환
- `_split_pdf_to_md_pages(pdf_path, doc_uuid)` → PDF → 페이지별 MD
- `_extract_hwp_text(hwp_path)` → pyhwp 직접 추출
- `_extract_hwpx_text(hwpx_path)` → zipfile/XML 직접 추출
- `_call_ai(full_content, json_path, adapter_url, prompt_file)` → Adapter API 호출 및 JSON 저장

---

### 2. `worker.py` — Redis 워커 루프

**책임**: Redis 스트림만 수신/송신. 변환 처리는 `converter.py`에 위임.

```python
from converter import convert  # converter 모듈만 호출

def main():
    # Redis 연결 및 스트림 그룹 초기화
    # while True: xreadgroup → convert() 호출 → send_status()
```

변경 후 `worker.py`에 남을 것:
- `send_status(r, ...)` — Redis 상태 전송 함수
- `main()` — Redis 루프. `convert()` 결과로 상태 결정

---

### 3. `test_converter.py` — CLI 단위 테스트

**책임**: Redis 없이 파일 하나를 직접 변환하고 결과를 stdout으로 출력.

```bash
# 사용 예시
python3 test_converter.py /app/shared-docs/20260318/sample.hwp
python3 test_converter.py /app/shared-docs/raw/report.pdf
```

```python
import sys
from converter import convert

if __name__ == "__main__":
    file_path = sys.argv[1]
    doc_uuid = "test-" + str(int(time.time()))
    result = convert(file_path, doc_uuid, adapter_url=..., prompt_file=...)
    print(json.dumps(result, indent=2, ensure_ascii=False))
```

---

## 의존성 다이어그램

```
test_converter.py ─┐
                   ├──► converter.py ──► LibreOffice, pyhwp, pdfplumber, Adapter HTTP API
worker.py ─────────┘
                   │
                   └──► Redis (INPUT_STREAM / RESULT_STREAM)
```

---

## 파일별 변경 요약

| 파일 | 작업 | 내용 |
|------|------|------|
| `converter/converter.py` | **[NEW]** | 순수 변환 로직 이전 (텍스트 추출 + AI 분석) |
| `converter/worker.py` | **[MODIFY]** | Redis 루프 + `convert()` 호출로 간소화 |
| `converter/test_converter.py` | **[NEW]** | CLI 단위 테스트 (sys.argv로 파일 경로 수신) |
| `converter/test_pipeline.py` | 유지 또는 제거 | 기존 통합 테스트 (Redis 의존성 있음, 선택) |

---

## 구현 순서

1. `converter.py` 작성 (기존 worker.py에서 변환/AI 함수 이전)
2. `worker.py` 수정 (converter.py import, 루프 간소화)
3. `test_converter.py` 작성 (CLI 진입점)
4. Docker 컨테이너 재시작 후 통합 테스트
