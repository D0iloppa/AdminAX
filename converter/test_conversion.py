
import os
import shutil
import subprocess
import time

# worker.py의 process_chain 함수 임포트
try:
    from worker import process_chain
except ImportError:
    # 경로 문제 시 현재 디렉토리 추가
    import sys
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from worker import process_chain

def run_test():
    # 테스트 디렉토리 (공유 볼륨 내)
    TEST_DIR = "/app/shared-docs/test_convert"
    if os.path.exists(TEST_DIR):
        shutil.rmtree(TEST_DIR)
    os.makedirs(TEST_DIR, exist_ok=True)
    
    print(f"[*] Test Directory: {TEST_DIR}")
    
    # 1. 더미 소스 생성 (Markdown -> DOCX via Pandoc)
    src_md = os.path.join(TEST_DIR, "source.md")
    with open(src_md, "w", encoding="utf-8") as f:
        f.write("# Hello Converter\n\nThis is a test document.\n- Item 1\n- Item 2\n")
        
    dummy_docx = os.path.join(TEST_DIR, "input.docx")
    print("[*] Generating dummy DOCX using pandoc...")
    try:
        subprocess.run(["pandoc", src_md, "-o", dummy_docx], check=True)
    except FileNotFoundError:
        print("[!] Pandoc not found. Skipping DOCX generation.")
        return

    # 2. HWP 확장자로 복사 (테스트 목적)
    dummy_hwp = os.path.join(TEST_DIR, "input.hwp")
    shutil.copy(dummy_docx, dummy_hwp)
    
    print(f"[*] Validating conversion logic on: {dummy_hwp}")
    
    # 3. 변환 실행
    try:
        result_md = process_chain(dummy_hwp)
        
        if result_md and os.path.exists(result_md):
            print(f"[SUCCESS] Converted file created: {result_md}")
            with open(result_md, 'r', encoding='utf-8') as f:
                print("--- Content Start ---")
                print(f.read())
                print("--- Content End ---")
        else:
            print("[FAIL] Conversion returned None or file missing.")
            
    except Exception as e:
        print(f"[ERROR] Logic failed: {e}")

if __name__ == "__main__":
    run_test()
