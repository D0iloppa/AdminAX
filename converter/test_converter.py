"""
test_converter.py — AdminAX 변환 엔진 CLI 단위 테스트

사용법:
    docker exec adminax-converter python3 test_converter.py <파일경로> [doc_uuid] [--text-only]

옵션:
    --text-only   AI 분석 없이 텍스트 추출(→MD) 단계만 수행하고 결과 출력

예시:
    # 전체 파이프라인 (텍스트 추출 + AI 분석)
    docker exec adminax-converter python3 test_converter.py /app/shared-docs/raw/sample.hwp

    # 텍스트 추출만 (AI 없음, 빠른 테스트)
    docker exec adminax-converter python3 test_converter.py /app/shared-docs/raw/sample.hwp --text-only
"""

import sys
import os
import json
import time
import logging

# 로깅: DEBUG 레벨로 stdout 출력 (테스트 시 파이프라인 과정을 실시간으로 확인)
logging.basicConfig(
    level=logging.DEBUG,
    stream=sys.stdout,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

from converter import convert, extract_text

ADAPTER_URL = os.getenv('ADAPTER_URL', 'http://adminax-adapter:8000/generate')
PROMPT_FILE = os.getenv('PROMPT_FILE', '/app/prompt_template.txt')


def main():
    args = [a for a in sys.argv[1:] if a != '--text-only']
    text_only = '--text-only' in sys.argv

    if not args:
        print("사용법: python3 test_converter.py <파일경로> [doc_uuid] [--text-only]", file=sys.stderr)
        sys.exit(1)

    file_path = args[0]
    doc_uuid  = args[1] if len(args) >= 2 else f"test-{int(time.time())}"

    if not os.path.exists(file_path):
        print(f"[오류] 파일이 존재하지 않습니다: {file_path}", file=sys.stderr)
        sys.exit(1)

    mode_label = "텍스트 추출만 (--text-only)" if text_only else "전체 파이프라인 (텍스트 추출 + AI 분석)"
    print(f"\n{'='*60}")
    print(f"  AdminAX Converter — 단위 테스트")
    print(f"{'='*60}")
    print(f"  파일     : {file_path}")
    print(f"  doc_uuid : {doc_uuid}")
    print(f"  모드     : {mode_label}")
    if not text_only:
        print(f"  Adapter  : {ADAPTER_URL}")
        print(f"  Prompt   : {PROMPT_FILE}")
    print(f"{'='*60}\n")

    if text_only:
        # ── 텍스트 추출만 ──────────────────────────────────────────
        result = extract_text(file_path=file_path, doc_uuid=doc_uuid)

        print(f"\n{'='*60}")
        if result['success']:
            print(f"  [성공] {result['page_count']}페이지 / {result['char_count']:,}자")
            if result['md_path']:
                print(f"  MD 저장 경로 : {result['md_path']}")
            print(f"{'='*60}\n")
            print("=== 내용 미리보기 (상위 2000자) ===\n")
            print(result['text'][:2000])
            if len(result['text']) > 2000:
                print(f"\n... ({len(result['text'])-2000:,}자 생략) ...")
            sys.exit(0)
        else:
            print(f"  [실패] {result['error']}")
            print(f"{'='*60}\n")
            sys.exit(1)

    else:
        # ── 전체 파이프라인 ────────────────────────────────────────
        result = convert(
            file_path=file_path,
            doc_uuid=doc_uuid,
            adapter_url=ADAPTER_URL,
            prompt_file=PROMPT_FILE,
        )

        print(f"\n{'='*60}")
        if result['success']:
            print(f"  [성공] JSON 저장 경로: {result['json_path']}")
            print(f"{'='*60}\n")
            try:
                with open(result['json_path'], 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if 'full_content' in data:
                    data['full_content'] = data['full_content'][:500] + " ...(생략)"
                print(json.dumps(data, indent=2, ensure_ascii=False))
            except Exception as e:
                print(f"[경고] JSON 파일 읽기 실패: {e}", file=sys.stderr)
            sys.exit(0)
        else:
            print(f"  [실패] {result['error']}")
            print(f"{'='*60}\n")
            sys.exit(1)


if __name__ == "__main__":
    main()
