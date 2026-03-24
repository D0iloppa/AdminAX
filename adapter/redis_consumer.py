import os
import json
import time
import asyncio
import logging
from redis.asyncio import Redis

from config_manager import config_manager
from llm_router import llm_router

logger = logging.getLogger("Adapter-RedisConsumer")

# 환경변수 매핑 (docker-compose의 .env 참조)
REDIS_HOST = os.getenv('REDIS_HOST', 'adminax-redis')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
CHAT_INPUT_STREAM = os.getenv('CHAT_INPUT_STREAM', 'adminax:chat:stream')
CHAT_RESULT_STREAM = os.getenv('CHAT_RESULT_STREAM', 'adminax:chat:result')
GROUP_NAME = os.getenv('GROUP_NAME', 'adapter_chat_group')
CONSUMER_NAME = os.getenv('CONSUMER_NAME', 'adapter_worker_1')

async def start_chat_consumer():
    """Redis Stream에서 비동기로 메시지를 읽고 LLM에 전달하는 소비자 데몬"""
    r = Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    
    try:
        await r.xgroup_create(CHAT_INPUT_STREAM, GROUP_NAME, mkstream=True)
        logger.info(f"Consumer Group '{GROUP_NAME}' created for stream '{CHAT_INPUT_STREAM}'.")
    except Exception as e:
        # 그룹이 이미 존재하는 오류 무시 ("BUSYGROUP Consumer Group name already exists")
        pass

    logger.info(f"[*] Adapter Redis Consumer listening on '{CHAT_INPUT_STREAM}'...")

    while True:
        try:
            # 타임아웃 5초(5000ms), 1개의 메시지 가져오기
            messages = await r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {CHAT_INPUT_STREAM: '>'}, count=1, block=5000)
            if not messages:
                continue

            for stream, payload in messages:
                for msg_id, data in payload:
                    try:
                        session_id = data.get('session_id')
                        message = data.get('message', '')
                        contexts_json = data.get('contexts', '[]')
                        
                        try:
                            contexts = json.loads(contexts_json)
                        except:
                            contexts = []
                            
                        # Context 조립
                        context_str = ""
                        for idx, ctx in enumerate(contexts):
                            title = ctx.get("docName", f"문서{idx+1}")
                            content = ctx.get("content", "")
                            context_str += f"\n--- {title} ---\n{content}\n"
                            
                        system_prompt = "주어진 문서를 기반으로 질문에 답하세요. 문서에 관련 내용이 없으면 문서와 무관한 일반적인 답변을 하세요."
                        if context_str:
                            system_prompt += f"\n\n<문서>{context_str}</문서>"

                        prompt = f"System: {system_prompt}\nUser: {message}\nAssistant:"
                        
                        # [핵심] DB에서 동적 로드한 Config를 사용 ("infer" 인스턴스 기준 호출 예시)
                        infer_config = config_manager.get_instance_config("infer")
                        if not infer_config:
                            logger.error("Instance config 'infer' not found. Ensure DB is populated.")
                            answer = "[!] LLM 어댑터 환경 설정 오류: 'infer' 인스턴스를 찾을 수 없습니다."
                        else:
                            # 라우터를 통해 실제 API 호출
                            answer = await llm_router.generate_response(infer_config, prompt)
                        
                        # 응답 Redis Push
                        response_payload = {
                            'msg_id': msg_id,
                            'session_id': session_id,
                            'answer': answer,
                            'timestamp': str(time.time())
                        }
                        
                        await r.xadd(CHAT_RESULT_STREAM, response_payload)
                        await r.xack(CHAT_INPUT_STREAM, GROUP_NAME, msg_id)
                        logger.info(f"Successfully processed message {msg_id} for session {session_id}")
                        
                    except Exception as e:
                        logger.error(f"Error processing individual message {msg_id}: {e}")
                        # 에러 내용을 답변으로 푸시
                        try:
                            error_payload = {
                                'msg_id': msg_id,
                                'session_id': session_id,
                                'answer': f"[Adapter Error] 응답 생성에 실패했습니다: {e}",
                                'timestamp': str(time.time())
                            }
                            await r.xadd(CHAT_RESULT_STREAM, error_payload)
                            await r.xack(CHAT_INPUT_STREAM, GROUP_NAME, msg_id)
                        except:
                            pass
                        
        except Exception as e:
            logger.error(f"Consumer Loop Error: {e}")
            await asyncio.sleep(2)
