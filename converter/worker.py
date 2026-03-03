import os
import subprocess
import shutil
import re
import json
import time
import html
import redis
import torch
import logging
import traceback
from transformers import AutoModelForCausalLM, AutoTokenizer

# ==========================================
# 0. 로깅 설정 (Verbose Mode)
# ==========================================
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("AdminAX-Worker")

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
    try:
        logger.info(f"AI 모델 로드 시작: {MODEL_NAME}")
        embedding_tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
        embedding_model = AutoModelForCausalLM.from_pretrained(
            MODEL_NAME, 
            trust_remote_code=True,
            low_cpu_mem_usage=True,
            torch_dtype=torch.float32 
        )
        embedding_model.eval()
        logger.info("AI 모델 로드 완료 및 준비됨.")
    except Exception as e:
        logger.error(f"모델 로드 중 치명적 에러: {e}")
        logger.error(traceback.format_exc())

def get_prompt_templates():
    """템플릿 파일에서 INITIAL과 CONTINUE 모드를 분리 로드"""
    try:
        if os.path.exists(PROMPT_FILE):
            with open(PROMPT_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
                parts = content.split("---")
                logger.debug(f"프롬프트 템플릿 로드 성공 (분할 개수: {len(parts)})")
                return [p.strip() for p in parts]
        else:
            logger.error(f"프롬프트 파일을 찾을 수 없습니다: {PROMPT_FILE}")
    except Exception as e:
        logger.error(f"프롬프트 로드 중 에러: {e}")
    return [None, None]

def repair_json(json_str):
    """잘린 JSON에 닫는 괄호를 추가하여 강제 파싱 시도"""
    json_str = json_str.strip()
    if not json_str.startswith('{'): 
        logger.warning(f"잘못된 JSON 시작 형식: {json_str[:20]}...")
        return None
    
    braces = json_str.count('{') - json_str.count('}')
    brackets = json_str.count('[') - json_str.count(']')
    
    if braces > 0 or brackets > 0:
        logger.debug(f"JSON 복구 시도 (괄호 보정: {braces}, 대괄호 보정: {brackets})")
        repaired = json_str + (']' * brackets) + ('}' * braces)
    else:
        repaired = json_str

    try:
        return json.loads(repaired)
    except Exception as e:
        logger.debug(f"JSON 복구 실패: {e}")
        return None

# ==========================================
# 3. 핵심 추출 로직 (Stateful Multi-turn AI)
# ==========================================

def extract_canonical_json_with_ai(md_path, json_path):
    global embedding_model, embedding_tokenizer
    if not embedding_model: 
        logger.error("AI 모델이 준비되지 않아 추출을 진행할 수 없습니다.")
        return False

    try:
        logger.info(f"AI 구조화 시작: {md_path}")
        with open(md_path, 'r', encoding='utf-8') as f:
            raw_text = f.read()
        
        full_content = html.unescape(raw_text).strip()
        ai_input = re.sub(r'\.[a-zA-Z0-9-]+\s*\{[^}]*\}', '', full_content) # CSS 제거
        ai_input = re.sub(r'\s+', ' ', ai_input).strip()
        
        init_tpl, cont_tpl = get_prompt_templates()
        if not init_tpl: 
            logger.error("초기 프롬프트 템플릿이 없습니다.")
            return False

        all_headings = []
        doc_info = {}
        current_offset = 0
        last_title = "시작"

        max_turns = 5
        for turn in range(max_turns):
            is_initial = (turn == 0)
            template = init_tpl if is_initial else cont_tpl
            
            remaining_text = ai_input[current_offset:]
            if len(remaining_text) < 50: 
                logger.debug(f"남은 텍스트가 너무 적어 분석을 종료합니다. (Turn {turn})")
                break

            chunk_text = remaining_text[:3000]
            prompt = template.replace("{text}", chunk_text)
            if not is_initial:
                prompt = prompt.replace("{last_heading}", last_title)
            
            try:
                logger.debug(f"AI 생성 요청 중... (Turn {turn}, Offset {current_offset})")
                inputs = embedding_tokenizer(prompt, return_tensors="pt").to(embedding_model.device)
                with torch.no_grad():
                    outputs = embedding_model.generate(
                        **inputs, max_new_tokens=MAX_TOKENS, temperature=TEMPERATURE, do_sample=False,
                        pad_token_id=embedding_tokenizer.eos_token_id
                    )
                
                response = embedding_tokenizer.decode(outputs[0], skip_special_tokens=True)
                json_str = response.split("assistant")[-1].strip() if "assistant" in response else response.strip()
                
                if "```json" in json_str:
                    json_str = json_str.split("```json")[1].split("```")[0].strip()
                elif "```" in json_str:
                    json_str = json_str.split("```")[1].split("```")[0].strip()

                ai_data = repair_json(json_str)
                if not ai_data: 
                    logger.warning(f"Turn {turn}: JSON 파싱 실패. 윈도우를 강제 전진합니다.")
                    current_offset += 2000 
                    continue

                if is_initial:
                    doc_info = {
                        "title": ai_data.get("title", "No Title"),
                        "summary": ai_data.get("summary", ""),
                        "doc_type": ai_data.get("doc_type", "기타")
                    }
                
                headings = ai_data.get('canonical_data', {}).get('heading_tree', [])
                if headings:
                    all_headings.extend(headings)
                    last_title = all_headings[-1]['title']
                    title_idx = chunk_text.rfind(last_title)
                    if title_idx != -1:
                        current_offset += (title_idx + len(last_title))
                    else:
                        current_offset += int(len(chunk_text) * 0.7)
                else:
                    current_offset += int(len(chunk_text) * 0.7)

                if ai_data.get("status") == "completed" or len(remaining_text) < 3000:
                    logger.info(f"AI 분석 완료 조건 충족. (Turn {turn})")
                    break
            
            except Exception as e:
                logger.error(f"AI Turn {turn} 추론 중 에러: {e}")
                current_offset += 2000 

        final_json = {
            "docId": os.path.basename(md_path).replace(".md", ""),
            "title": doc_info.get("title", "No Title"),
            "summary": doc_info.get("summary", ""),
            "full_content": full_content, 
            "metadata": {
                "source": "adminax_converter_v2",
                "extracted_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "doc_type": doc_info.get("doc_type", "기타")
            },
            "canonical_data": { "heading_tree": all_headings }
        }

        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(final_json, f, indent=4, ensure_ascii=False)
        
        logger.info(f"최종 JSON 파일 생성 성공: {json_path}")
        return True
    except Exception as e:
        logger.error(f"AI 구조화 과정 중 치명적 에러: {e}")
        logger.error(traceback.format_exc())
        return False

# ==========================================
# 4. 파이프라인 및 워커 루프
# ==========================================

def process_chain(hwp_path):
    logger.info(f"파이프라인 가동: {hwp_path}")
    base_name = os.path.splitext(hwp_path)[0]
    docx_path, md_path, html_output = f"{base_name}.docx", f"{base_name}.md", f"{base_name}.html"
    json_path = f"{base_name}.json"
    
    success = False
    try:
        # Step 1: HWP 전용 변환 시도
        if hwp_path.lower().endswith('.hwp'):
            logger.debug(f"HWP 파일 감지, hwp5html 실행 시도: {hwp_path}")
            try:
                h_res = subprocess.run(["hwp5html", "--output", html_output, hwp_path], 
                                       capture_output=True, text=True, timeout=60)
                if h_res.returncode == 0:
                    xhtml = os.path.join(html_output, "index.xhtml")
                    if os.path.exists(xhtml):
                        with open(xhtml, 'r', encoding='utf-8') as f:
                            txt = re.sub(r'<[^>]+>', '', f.read())
                            with open(md_path, 'w', encoding='utf-8') as f_out: f_out.write(txt)
                        logger.info("hwp5html 변환 성공 (.md 생성됨)")
                        success = True
                else:
                    logger.warning(f"hwp5html 실패 메시지: {h_res.stderr}")
            except Exception as e:
                logger.error(f"hwp5html 실행 중 예외: {e}")

        # Step 2: LibreOffice/Pandoc 폴백 (PDF, DOCX 등 지원)
        if not success:
            logger.debug(f"LibreOffice 폴백 변환 시도: {hwp_path}")
            lo_cmd = [
                "libreoffice", "--headless",
                f"-DUserInstallation=file:///tmp/lo_v_{time.time()}",
                "--convert-to", "docx", hwp_path, 
                "--outdir", os.path.dirname(hwp_path)
            ]
            
            result = subprocess.run(lo_cmd, capture_output=True, text=True, timeout=90)
            
            if result.returncode == 0 and os.path.exists(docx_path):
                logger.info("LibreOffice 변환 성공 (.docx 생성됨)")
                p_res = subprocess.run(["pandoc", docx_path, "-t", "gfm", "-o", md_path], 
                                        capture_output=True, text=True)
                if p_res.returncode == 0:
                    logger.info("Pandoc 변환 성공 (.md 생성됨)")
                    success = os.path.exists(md_path)
                else:
                    logger.error(f"Pandoc 에러: {p_res.stderr}")
            else:
                logger.error(f"LibreOffice 변환 최종 실패. 결과코드: {result.returncode}")
                if result.stderr: logger.error(f"LO 상세 에러: {result.stderr}")

        # Step 3: 최종 AI 구조화 (성공 시)
        if success:
            logger.info("파일 변환 성공, AI 구조화 단계를 시작합니다.")
            success = extract_canonical_json_with_ai(md_path, json_path)

    except Exception as e:
        logger.error(f"파이프라인 실행 중 예외 발생: {e}")
        logger.error(traceback.format_exc())
        success = False

    finally:
        # 임시 중간 파일 정리
        logger.debug("임시 파일 정리 중...")
        if os.path.exists(docx_path): os.remove(docx_path)
        if os.path.exists(html_output) and os.path.isdir(html_output): shutil.rmtree(html_output)
        if os.path.exists(md_path) and not success: os.remove(md_path)
    
    return json_path if success else None

def main():
    init_model()
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    
    logger.info(f"Redis 연결 중 ({REDIS_HOST}:{REDIS_PORT})")
    try: 
        r.xgroup_create(INPUT_STREAM, GROUP_NAME, mkstream=True)
        logger.info(f"Consumer Group '{GROUP_NAME}' 생성 완료.")
    except: 
        logger.debug(f"Group '{GROUP_NAME}'이 이미 존재하여 건너뜁니다.")

    print(f"[*] AdminAX Stateful Worker 가동 중... 스트림: {INPUT_STREAM}")

    while True:
        try:
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {INPUT_STREAM: '>'}, count=1, block=5000)
            if not messages: 
                continue

            for stream, payload in messages:
                for msg_id, data in payload:
                    logger.info(f"새 작업 수신: [ID: {msg_id}]")
                    logger.debug(f"수신 데이터: {data}")
                    
                    hwp_path = data.get('file_path') or data.get('filePath')
                    doc_uuid = data.get('doc_uuid') or data.get('docId')
                    task_id = data.get('task_id')
                    
                    if hwp_path and os.path.exists(hwp_path):
                        logger.info(f"문서 처리 시작 [UUID: {doc_uuid}, Task: {task_id}]")
                        final_json = process_chain(hwp_path)
                        
                        status = 'COMPLETED' if final_json else 'FAILED'
                        r.xadd(RESULT_STREAM, {
                            'task_id': task_id,
                            'doc_uuid': doc_uuid, 
                            'json_path': final_json if final_json else '',
                            'status': status
                        })
                        logger.info(f"결과 전송 완료 [UUID: {doc_uuid}, Status: {status}]")
                    else:
                        logger.error(f"파일을 찾을 수 없습니다: {hwp_path}")
                        if task_id:
                            r.xadd(RESULT_STREAM, {'task_id': task_id, 'doc_uuid': doc_uuid, 'status': 'FAILED'})
                    
                    r.xack(INPUT_STREAM, GROUP_NAME, msg_id)
        except Exception as e:
            logger.error(f"전역 워커 루프 에러: {e}")
            logger.error(traceback.format_exc())
            time.sleep(2)

if __name__ == "__main__":
    main()