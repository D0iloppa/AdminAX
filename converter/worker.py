"""
worker.py — AdminAX Redis 워커 루프

책임: Redis INPUT_STREAM에서 작업을 수신하고,
     converter.py의 convert()를 호출한 뒤
     결과를 RESULT_STREAM으로 전송한다.
"""

import os
import time
import logging
import redis

from converter import extract_text

# ==========================================
# 로깅 설정
# ==========================================
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("AdminAX-Worker")

# ==========================================
# 환경 변수
# ==========================================
REDIS_HOST    = os.getenv('REDIS_HOST',    'adminax-redis')
REDIS_PORT    = int(os.getenv('REDIS_PORT', 6379))
INPUT_STREAM  = os.getenv('INPUT_STREAM',  'adminax:convert:stream')
RESULT_STREAM = os.getenv('RESULT_STREAM', 'adminax:result:stream')
GROUP_NAME    = os.getenv('GROUP_NAME',    'converter_group')
CONSUMER_NAME = os.getenv('CONSUMER_NAME', 'worker_1')

PROMPT_FILE   = os.getenv('PROMPT_FILE',   '/app/prompt_template.txt')
ADAPTER_URL   = os.getenv('ADAPTER_URL',   'http://adminax-adapter:8000/generate')


# ==========================================
# 유틸리티
# ==========================================

def send_status(r, task_id, doc_uuid, status, json_path='', error_msg=''):
    """Redis RESULT_STREAM에 처리 상태를 전송한다."""
    payload = {
        'task_id':   str(task_id)   if task_id   else 'MISSING_TASK_ID',
        'doc_uuid':  str(doc_uuid)  if doc_uuid  else 'MISSING_DOC_UUID',
        'status':    str(status)    if status    else 'UNKNOWN',
        'json_path': str(json_path) if json_path else '',
        'error_msg': str(error_msg) if error_msg else '',
        'timestamp': str(time.time()),
    }
    logger.debug(f"[>>> REDIS PUSH] {payload}")
    r.xadd(RESULT_STREAM, payload)


# ==========================================
# 메인 워커 루프
# ==========================================

def main():
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

    # Consumer Group 초기화 (이미 있으면 무시)
    try:
        r.xgroup_create(INPUT_STREAM, GROUP_NAME, mkstream=True)
    except Exception:
        pass

    logger.info(f"[*] AdminAX Worker 시작 — Stream: {INPUT_STREAM}, Group: {GROUP_NAME}")

    while True:
        try:
            messages = r.xreadgroup(
                GROUP_NAME, CONSUMER_NAME,
                {INPUT_STREAM: '>'},
                count=1, block=5000
            )
            if not messages:
                continue

            for _stream, payload in messages:
                for msg_id, data in payload:
                    task_id   = data.get('task_id')   or data.get('taskId')
                    doc_uuid  = data.get('doc_uuid')  or data.get('docId') or data.get('docUuid')
                    file_path = data.get('file_path') or data.get('filePath')

                    logger.info(f"[작업 수신] task={task_id}, doc={doc_uuid}, file={file_path}")
                    send_status(r, task_id, doc_uuid, 'PROCESSING')

                    if file_path and os.path.exists(file_path):
                        send_status(r, task_id, doc_uuid, 'CONVERTING')
                        result = extract_text(
                            file_path=file_path,
                            doc_uuid=doc_uuid,
                        )

                        if result['success']:
                            # md_path를 json_path 필드에 넣어 core-engine이 결과 경로를 수신
                            send_status(r, task_id, doc_uuid, 'COMPLETED',
                                        json_path=result['md_path'])
                            logger.info(f"[완료] pages={result['page_count']}, file={result['md_path']}")
                        else:
                            send_status(r, task_id, doc_uuid, 'FAILED',
                                        error_msg=result['error'])
                            logger.error(f"[실패] {result['error']}")
                    else:
                        msg = f"파일 없음: {file_path}"
                        send_status(r, task_id, doc_uuid, 'FAILED', error_msg=msg)
                        logger.error(f"[실패] {msg}")

                    r.xack(INPUT_STREAM, GROUP_NAME, msg_id)

        except Exception as e:
            logger.error(f"Main Loop 예외: {e}", exc_info=True)
            time.sleep(2)


if __name__ == "__main__":
    main()