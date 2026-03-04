import os
import json
import time
import redis
import torch
import logging
import traceback
from transformers import AutoModelForCausalLM, AutoTokenizer

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger("AdminAX-ChatWorker")

REDIS_HOST = os.getenv('REDIS_HOST', 'adminax-redis')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
CHAT_INPUT_STREAM = os.getenv('CHAT_INPUT_STREAM', 'adminax:chat:stream')
CHAT_RESULT_STREAM = os.getenv('CHAT_RESULT_STREAM', 'adminax:chat:result')
GROUP_NAME = os.getenv('GROUP_NAME', 'chat_group')
CONSUMER_NAME = os.getenv('CONSUMER_NAME', 'chat_worker_1')

MODEL_NAME = os.getenv('MODEL_NAME', "Qwen/Qwen2.5-1.5B-Instruct")
MAX_TOKENS = int(os.getenv('AI_MAX_TOKENS', 1024))
TEMPERATURE = float(os.getenv('AI_TEMPERATURE', 0.5))

chat_model = None
chat_tokenizer = None

def init_model():
    global chat_model, chat_tokenizer
    try:
        logger.info(f"Loading chat model: {MODEL_NAME}")
        chat_tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
        chat_model = AutoModelForCausalLM.from_pretrained(
            MODEL_NAME, 
            trust_remote_code=True,
            low_cpu_mem_usage=True,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        chat_model.eval()
        logger.info("Chat model loaded.")
    except Exception as e:
        logger.error(f"Chat model load error: {e}")

def generate_chat_response(message, contexts):
    if not chat_model or not chat_tokenizer:
        return "[!] Chat Worker AI 봇이 아직 준비되지 않았습니다."

    context_str = ""
    for idx, ctx in enumerate(contexts):
        title = ctx.get("docName", f"문서{idx+1}")
        content = ctx.get("content", "")
        content_trunc = content[:3000] if len(content) > 3000 else content
        context_str += f"\n--- {title} ---\n{content_trunc}\n"

    system_prompt = "주어진 문서를 기반으로 질문에 답하세요. 문서에 관련 내용이 없으면 모른다고 답변하세요."
    if context_str:
        system_prompt += f"\n\n<문서>{context_str}</문서>"

    prompt = f"<|im_start|>system\n{system_prompt}<|im_end|>\n<|im_start|>user\n{message}<|im_end|>\n<|im_start|>assistant\n"

    try:
        device = chat_model.device
        inputs = chat_tokenizer(prompt, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = chat_model.generate(
                **inputs,
                max_new_tokens=MAX_TOKENS,
                temperature=TEMPERATURE,
                do_sample=True,
                pad_token_id=chat_tokenizer.eos_token_id
            )
        
        input_length = inputs.input_ids.shape[1]
        response = chat_tokenizer.decode(outputs[0][input_length:], skip_special_tokens=True)
        return response.strip()

    except Exception as e:
        logger.error(f"Response generation failed: {e}")
        return "응답을 생성하지 못했습니다."

def main():
    init_model()
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    try: r.xgroup_create(CHAT_INPUT_STREAM, GROUP_NAME, mkstream=True)
    except: pass

    logger.info(f"[*] AdminAX Chat Worker listening on {CHAT_INPUT_STREAM}...")

    while True:
        try:
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {CHAT_INPUT_STREAM: '>'}, count=1, block=5000)
            if not messages: continue

            for stream, payload in messages:
                for msg_id, data in payload:
                    session_id = data.get('session_id')
                    message = data.get('message', '')
                    contexts_json = data.get('contexts', '[]')
                    
                    try:
                        contexts = json.loads(contexts_json)
                    except:
                        contexts = []

                    answer = generate_chat_response(message, contexts)

                    response_payload = {
                        'msg_id': msg_id,
                        'session_id': session_id,
                        'answer': answer,
                        'timestamp': str(time.time())
                    }
                    r.xadd(CHAT_RESULT_STREAM, response_payload)
                    r.xack(CHAT_INPUT_STREAM, GROUP_NAME, msg_id)
        except Exception as e:
            logger.error(f"Worker Loop Error: {e}")
            time.sleep(2)

if __name__ == "__main__":
    main()
