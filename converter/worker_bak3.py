import os
import subprocess
import shutil
import re
import json
import time
import html
import redis
import requests
import logging
import traceback

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

PROMPT_FILE = os.getenv('PROMPT_FILE', '/app/prompt_template.txt')
ADAPTER_URL = os.getenv("ADAPTER_URL", "http://adminax-adapter:8000/generate")

# ==========================================
# 2. 유틸리티 및 AI 초기화
# ==========================================

def init_model():
    """어댑터 레이어 상태 확인"""
    logger.info("Initializing worker... checking adapter layer health.")
    try:
        health_url = ADAPTER_URL.replace("/generate", "/health")
        res = requests.get(health_url, timeout=5)
        if res.status_code == 200:
            logger.info("Adapter layer is healthy.")
        else:
            logger.warning(f"Adapter layer returned status {res.status_code}")
    except Exception as e:
        logger.warning(f"Could not connect to adapter layer at startup: {e}")

def get_prompt_templates():
    """템플릿 파일에서 INITIAL과 CONTINUE 모드 로드"""
    try:
        if os.path.exists(PROMPT_FILE):
            with open(PROMPT_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
                parts = content.split("---")
                return [p.strip() for p in parts]
    except Exception as e:
        logger.error(f"프롬프트 로드 에러: {e}")
    return [None, None]

def repair_json(json_str):
    """잘린 JSON 복구"""
    json_str = json_str.strip()
    if not json_str.startswith('{'): return None
    braces = json_str.count('{') - json_str.count('}')
    brackets = json_str.count('[') - json_str.count(']')
    repaired = json_str + (']' * brackets) + ('}' * braces)
    try:
        return json.loads(repaired)
    except:
        return None

def send_status(r, task_id, doc_uuid, status, json_path='', error_msg=''):
    """데이터 유실을 방지하는 강제 전송 함수 (중요 필드 절대 누락 안됨)"""
    payload = {
        'task_id': str(task_id) if task_id else "MISSING_TASK_ID",
        'doc_uuid': str(doc_uuid) if doc_uuid else "MISSING_DOC_UUID",
        'status': str(status) if status else "UNKNOWN",
        'json_path': str(json_path) if json_path else "",
        'error_msg': str(error_msg) if error_msg else "",
        'timestamp': str(time.time())
    }
    # 전송 데이터 확인용 디버그 로그
    logger.debug(f"[>>> REDIS PUSH] Payload: {payload}")
    r.xadd(RESULT_STREAM, payload)

# ==========================================
# 3. 핵심 추출 로직 (Dual-Track AI 구조화)
# ==========================================

def extract_canonical_json_with_ai(md_path, json_path, r, task_id, doc_uuid):
    try:
        # AI 분석 시작 알림
        send_status(r, task_id, doc_uuid, 'ANALYZING')

        with open(md_path, 'r', encoding='utf-8') as f:
            raw_text = f.read()
        
        full_content = html.unescape(raw_text).strip()
        
        # AI 전용 정제 (CSS 제거)
        ai_input = re.sub(r'\.[a-zA-Z0-9-]+\s*\{[^}]*\}', '', full_content) 
        ai_input = re.sub(r'<style>.*?</style>', '', ai_input, flags=re.DOTALL)
        ai_input = re.sub(r'<[^>]+>', '', ai_input)
        ai_input = re.sub(r'\s+', ' ', ai_input).strip()
        
        init_tpl, cont_tpl = get_prompt_templates()
        if not init_tpl: return False

        all_headings = []
        doc_info = {"title": os.path.basename(md_path), "summary": "", "doc_type": "기타"}
        current_offset = 0
        last_title = "시작"

        for turn in range(5):
            remaining_text = ai_input[current_offset:]
            if len(remaining_text) < 50: break

            chunk_text = remaining_text[:3000]
            is_initial = (turn == 0)
            template = init_tpl if is_initial else cont_tpl
            prompt = template.replace("{text}", chunk_text)
            if not is_initial:
                prompt = prompt.replace("{last_heading}", last_title)
            
            # AI Inference via Adapter Layer
            try:
                adapter_res = requests.post(
                    ADAPTER_URL,
                    json={"prompt": prompt, "instance_name": "infer"},
                    timeout=120
                )
                adapter_res.raise_for_status()
                response = adapter_res.json().get("answer", "")
            except Exception as e:
                logger.error(f"Adapter API error during inference: {e}")
                current_offset += 2000
                continue
            
            json_str = response.split("assistant")[-1].strip() if "assistant" in response else response.strip()
            json_str = re.sub(r'```json|```', '', json_str).strip()

            ai_data = repair_json(json_str)
            if not ai_data: 
                current_offset += 2000
                continue

            if is_initial:
                doc_info["title"] = ai_data.get("title", doc_info["title"])
                doc_info["summary"] = ai_data.get("summary", "")
                doc_info["doc_type"] = ai_data.get("doc_type", "일반문서")
            
            headings = ai_data.get('canonical_data', {}).get('heading_tree', [])
            if headings:
                all_headings.extend(headings)
                last_title = all_headings[-1]['title']
                title_idx = chunk_text.rfind(last_title)
                current_offset += (title_idx + len(last_title)) if title_idx != -1 else int(len(chunk_text) * 0.7)
            else:
                current_offset += int(len(chunk_text) * 0.7)

            if ai_data.get("status") == "completed": break

        final_json = {
            "docId": doc_uuid,
            "title": doc_info["title"],
            "summary": doc_info["summary"],
            "full_content": full_content,
            "canonical_data": { "heading_tree": all_headings }
        }

        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(final_json, f, indent=4, ensure_ascii=False)
        
        return True
    except Exception as e:
        logger.error(f"AI 에러: {e}")
        return False

# ==========================================
# 4. 파이프라인 (HWP 변환)
# ==========================================

def process_chain(hwp_path, r, task_id, doc_uuid):
    base_name = os.path.splitext(hwp_path)[0]
    docx_path, md_path = f"{base_name}.docx", f"{base_name}.md"
    html_output, json_path = f"{base_name}.html", f"{base_name}.json"
    
    success = False
    try:
        # Step 1: HWP 전용 변환
        if hwp_path.lower().endswith('.hwp'):
            h_res = subprocess.run(["hwp5html", "--output", html_output, hwp_path], capture_output=True, text=True)
            if h_res.returncode == 0:
                xhtml = os.path.join(html_output, "index.xhtml")
                if os.path.exists(xhtml):
                    with open(xhtml, 'r', encoding='utf-8') as f:
                        txt = re.sub(r'<[^>]+>', '', f.read())
                        with open(md_path, 'w', encoding='utf-8') as f_out: f_out.write(txt)
                    success = True

        # Step 2: PDF 처리 (pdftotext)
        if not success and hwp_path.lower().endswith('.pdf'):
            res = subprocess.run(["pdftotext", hwp_path, md_path], capture_output=True, text=True)
            if res.returncode == 0 and os.path.exists(md_path):
                success = True

        # Step 3: LibreOffice 폴백 (DOCX, XLSX 등)
        if not success:
            lo_cmd = ["libreoffice", "--headless", "--convert-to", "docx", hwp_path, "--outdir", os.path.dirname(hwp_path)]
            subprocess.run(lo_cmd, capture_output=True, text=True, timeout=90)
            if os.path.exists(docx_path):
                subprocess.run(["pandoc", docx_path, "-t", "gfm", "-o", md_path], check=True)
                success = os.path.exists(md_path)

        if success:
            send_status(r, task_id, doc_uuid, 'CONVERTED')
            return extract_canonical_json_with_ai(md_path, json_path, r, task_id, doc_uuid)

    except Exception as e:
        logger.error(f"파이프라인 에러: {e}")
    finally:
        if os.path.exists(docx_path): os.remove(docx_path)
        if os.path.exists(html_output) and os.path.isdir(html_output): shutil.rmtree(html_output)
    
    return False

# ==========================================
# 5. 메인 워커 루프
# ==========================================

def main():
    init_model()
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    try: r.xgroup_create(INPUT_STREAM, GROUP_NAME, mkstream=True)
    except: pass

    logger.info(f"[*] AdminAX Worker 가동. 스트림: {INPUT_STREAM}")

    while True:
        try:
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {INPUT_STREAM: '>'}, count=1, block=5000)
            if not messages: continue

            for stream, payload in messages:
                for msg_id, data in payload:
                    # [매우 중요] Java에서 넘어온 날것의 키값 로그 출력 (디버깅용)
                    logger.debug(f"[RECV FROM JAVA] Raw Data: {data}")

                    # Java DTO 필드명에 따른 유연한 매핑
                    task_id = data.get('task_id') or data.get('taskId')
                    doc_uuid = data.get('doc_uuid') or data.get('docId') or data.get('docUuid')
                    file_path = data.get('file_path') or data.get('filePath')

                    # 1. 시작 알림 (이제 여기서 doc_uuid가 비어있어도 MISSING_... 이라고 Redis에 찍힘)
                    send_status(r, task_id, doc_uuid, 'PROCESSING')

                    if file_path and os.path.exists(file_path):
                        if process_chain(file_path, r, task_id, doc_uuid):
                            json_out = file_path.replace(os.path.splitext(file_path)[1], ".json")
                            send_status(r, task_id, doc_uuid, 'COMPLETED', json_path=json_out)
                        else:
                            send_status(r, task_id, doc_uuid, 'FAILED', error_msg="Processing Fail")
                    else:
                        send_status(r, task_id, doc_uuid, 'FAILED', error_msg="File Not Found")
                    
                    r.xack(INPUT_STREAM, GROUP_NAME, msg_id)
        except Exception as e:
            logger.error(f"Main Loop Error: {e}")
            time.sleep(2)

if __name__ == "__main__":
    main()