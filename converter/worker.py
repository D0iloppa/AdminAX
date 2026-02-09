import os
import subprocess
import shutil
import re
import json
import time
import html
import redis
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# ==========================================
# 1. 환경 설정 (Environment Variables)
# ==========================================
REDIS_HOST = os.getenv('REDIS_HOST', 'adminax-redis')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
INPUT_STREAM = os.getenv('INPUT_STREAM', 'adminax:convert:stream')
RESULT_STREAM = os.getenv('RESULT_STREAM', 'adminax:result:stream')
GROUP_NAME = os.getenv('GROUP_NAME', 'converter_group')
CONSUMER_NAME = os.getenv('CONSUMER_NAME', 'worker_1')

MODEL_NAME = os.getenv('MODEL_NAME', "Qwen/Qwen2.5-0.5B-Instruct")
PROMPT_FILE = os.getenv('PROMPT_FILE', '/app/prompt_template.txt')
MAX_TOKENS = int(os.getenv('AI_MAX_TOKENS', 1024))
TEMPERATURE = float(os.getenv('AI_TEMPERATURE', 0.1))

# 전역 객체 초기화
embedding_model = None
embedding_tokenizer = None

# ==========================================
# 2. 유틸리티 및 AI 초기화
# ==========================================

def init_model():
    """로컬 AI 모델 초기화 (CPU 최적화)"""
    global embedding_model, embedding_tokenizer
    print(f"[*] Loading AI Model: {MODEL_NAME}...")
    embedding_tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    embedding_model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME, 
        trust_remote_code=True,
        low_cpu_mem_usage=True,
        torch_dtype=torch.float32 # 8GB RAM 환경 고려
    )
    embedding_model.eval()
    print("[+] AI Model Ready.")

def get_prompt_templates():
    """템플릿 파일에서 INITIAL과 CONTINUE 모드를 분리 로드"""
    try:
        if os.path.exists(PROMPT_FILE):
            with open(PROMPT_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
                parts = content.split("---")
                return [p.strip() for p in parts]
    except Exception as e:
        print(f"[!] Prompt Load Error: {e}")
    return [None, None]

def repair_json(json_str):
    """잘린 JSON에 닫는 괄호를 추가하여 강제 파싱 시도"""
    json_str = json_str.strip()
    if not json_str.startswith('{'): return None
    
    # 괄호 밸런싱
    braces = json_str.count('{') - json_str.count('}')
    brackets = json_str.count('[') - json_str.count(']')
    
    repaired = json_str + (']' * brackets) + ('}' * braces)
    try:
        return json.loads(repaired)
    except:
        return None

# ==========================================
# 3. 핵심 추출 로직 (Stateful Multi-turn)
# ==========================================

def extract_canonical_json_with_ai(md_path, json_path):
    global embedding_model, embedding_tokenizer
    if not embedding_model: return False

    try:
        with open(md_path, 'r', encoding='utf-8') as f:
            raw_text = f.read()
        
        # 원본 보존 및 분석용 정제
        full_content = html.unescape(raw_text).strip()
        ai_input = re.sub(r'\.[a-zA-Z0-9-]+\s*\{[^}]*\}', '', full_content) # CSS 제거
        ai_input = re.sub(r'\s+', ' ', ai_input).strip()
        
        init_tpl, cont_tpl = get_prompt_templates()
        if not init_tpl: return False

        all_headings = []
        doc_info = {}
        current_offset = 0
        last_title = "시작"

        # 최대 3턴까지 이어서 생성 시도
        # 최대 5턴까지 이어서 생성 시도 (Default 3 -> 5 for safety)
        max_turns = 5
        for turn in range(max_turns):
            is_initial = (turn == 0)
            template = init_tpl if is_initial else cont_tpl
            
            # 남은 텍스트가 너무 적으면 중단
            remaining_text = ai_input[current_offset:]
            if len(remaining_text) < 50: 
                print("[*] Remaining text too short, finishing extraction.")
                break

            # 프롬프트 조립
            # 윈도우 사이즈: 3000자 (토큰 수 고려하여 조정)
            chunk_text = remaining_text[:3000]
            prompt = template.replace("{text}", chunk_text)
            if not is_initial:
                prompt = prompt.replace("{last_heading}", last_title)
            
            # AI 추론
            try:
                inputs = embedding_tokenizer(prompt, return_tensors="pt").to(embedding_model.device)
                with torch.no_grad():
                    outputs = embedding_model.generate(
                        **inputs, max_new_tokens=MAX_TOKENS, temperature=TEMPERATURE, do_sample=False,
                        pad_token_id=embedding_tokenizer.eos_token_id # Suppress warnings
                    )
                
                response = embedding_tokenizer.decode(outputs[0], skip_special_tokens=True)
                # Parse JSON
                if "assistant" in response:
                    json_str = response.split("assistant")[-1].strip()
                else:
                    json_str = response.strip()
                
                # Clean up markdown code blocks if present
                if "```json" in json_str:
                    json_str = json_str.split("```json")[1].split("```")[0].strip()
                elif "```" in json_str:
                    json_str = json_str.split("```")[1].split("```")[0].strip()

                # JSON 수습 및 파싱
                ai_data = repair_json(json_str)
                if not ai_data: 
                    print(f"[!] Turn {turn}: JSON parsing failed. Skipping chunk.")
                    # 강제 전진 (무한 루프 방지)
                    current_offset += 2000 
                    continue

                # 메타데이터 저장 (최초 턴만)
                if is_initial:
                    doc_info = {
                        "title": ai_data.get("title", "No Title"),
                        "summary": ai_data.get("summary", ""),
                        "doc_type": ai_data.get("doc_type", "기타")
                    }
                
                # 목차 데이터 병합
                headings = ai_data.get('canonical_data', {}).get('heading_tree', [])
                if headings:
                    all_headings.extend(headings)
                    # Update last title found
                    last_title = all_headings[-1]['title']
                    
                    # 제목 위치 기반으로 오프셋 이동 (더 정확하게)
                    # chunk_text 안에서 last_title을 찾는다.
                    title_idx = chunk_text.rfind(last_title)
                    if title_idx != -1:
                        # 제목이 발견된 위치 + 제목 길이 + 여유분(100자) 만큼 전진
                        # 전체 오프셋 업데이트
                        current_offset += (title_idx + len(last_title))
                    else:
                        # 제목을 못 찾았으면 안전하게 윈도우의 70%만큼 전진 (Overlap)
                        current_offset += int(len(chunk_text) * 0.7)
                else:
                    # 목차가 안 나왔다면? 내용만 있는 구간일 수 있음. 강제 전진.
                    current_offset += int(len(chunk_text) * 0.7)

                # 종료 조건 확인
                # 1. JSON이 닫혔고 status가 completed이면 종료
                # 2. 또는 추출할 텍스트가 끝났으면 종료
                if ai_data.get("status") == "completed" or len(remaining_text) < 3000:
                    print(f"[*] Extraction completed at turn {turn}.")
                    break
            
            except Exception as e:
                print(f"[!] Turn {turn} Error: {e}")
                current_offset += 2000 # Error fallback forward


        # 최종 JSON 조립 (AI 분석 결과 + 메모리 내 원본 전체)
        final_json = {
            "docId": os.path.basename(md_path).replace(".md", ""),
            "title": doc_info.get("title", "No Title"),
            "summary": doc_info.get("summary", ""),
            "full_content": full_content, # AI를 거치지 않은 100% 원문
            "metadata": {
                "source": "adminax_converter_v2",
                "extracted_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "doc_type": doc_info.get("doc_type", "기타")
            },
            "canonical_data": { "heading_tree": all_headings }
        }

        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(final_json, f, indent=4, ensure_ascii=False)
        
        return True
    except Exception as e:
        print(f"[!] AI Extraction Critical Error: {e}")
        return False

# ==========================================
# 4. 파이프라인 및 워커 루프
# ==========================================

def process_chain(hwp_path):
    """변환 파이프라인 및 중간 파일 클린업"""
    base_name = os.path.splitext(hwp_path)[0]
    docx_path, md_path, html_output = f"{base_name}.docx", f"{base_name}.md", f"{base_name}.html"
    json_path = f"{base_name}.json"
    
    success = False
    try:
        # Step 1: HWP -> MD (pyhwp -> LibreOffice/Pandoc Fallback)
        if hwp_path.lower().endswith('.hwp'):
            try:
                subprocess.run(["hwp5html", "--output", html_output, hwp_path], check=True, timeout=60)
                xhtml = os.path.join(html_output, "index.xhtml")
                if os.path.exists(xhtml):
                    with open(xhtml, 'r', encoding='utf-8') as f:
                        txt = re.sub(r'<[^>]+>', '', f.read())
                        with open(md_path, 'w', encoding='utf-8') as f_out: f_out.write(txt)
                    success = True
            except: pass

        if not success:
            subprocess.run(["libreoffice", "--headless", "--convert-to", "docx", hwp_path, "--outdir", os.path.dirname(hwp_path)], check=True)
            subprocess.run(["pandoc", docx_path, "-t", "gfm", "-o", md_path], check=True)
            success = os.path.exists(md_path)

        # Step 2: AI 구조화
        if success:
            success = extract_canonical_json_with_ai(md_path, json_path)

    finally:
        # Step 3: 원본과 최종 JSON을 제외한 모든 중간 파일 삭제
        for item in [docx_path, html_output, md_path]:
            if os.path.exists(item):
                if os.path.isdir(item): shutil.rmtree(item)
                else: os.remove(item)
    
    return json_path if success else None

def main():
    init_model()
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    try: r.xgroup_create(INPUT_STREAM, GROUP_NAME, mkstream=True)
    except: pass

    print(f"[*] AdminAX Stateful Worker is listening on {INPUT_STREAM}...")

    while True:
        try:
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {INPUT_STREAM: '>'}, count=1, block=5000)
            if not messages: continue

            for stream, payload in messages:
                for msg_id, data in payload:
                    hwp_path, doc_uuid = data.get('filePath'), data.get('docId')
                    if hwp_path and os.path.exists(hwp_path):
                        final_json = process_chain(hwp_path)
                        if final_json:
                            r.xadd(RESULT_STREAM, {'doc_uuid': doc_uuid, 'json_path': final_json, 'status': 'SUCCESS'})
                            print(f"[>] Pipeline Success: {doc_uuid}")
                    r.xack(INPUT_STREAM, GROUP_NAME, msg_id)
        except Exception as e:
            print(f"[!] Worker Loop Error: {e}")
            time.sleep(2)

if __name__ == "__main__":
    main()