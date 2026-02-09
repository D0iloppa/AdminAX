
import redis
import json
import time
import uuid

import os

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = 6379
INPUT_STREAM = 'adminax:convert:stream'

def test_producer():
    try:
        r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        
        # Test Data
        target_file = os.getenv('TARGET_FILE', '/app/shared-docs/raw/test_manual.hwp')
        doc_uuid = str(uuid.uuid4())
        message = {
            "docId": doc_uuid,
            "filePath": target_file,
            "fileType": "hwp"
        }
        
        print(f"[*] [Stage 1] Sending Job to Redis: {message}")
        msg_id = r.xadd(INPUT_STREAM, message)
        print(f"[+] Job Sent. MsgID: {msg_id}")
        
    except Exception as e:
        print(f"[-] Error: {e}")
        print("Note: Ensure Redis is running and port 6379 is exposed to localhost.")

if __name__ == "__main__":
    test_producer()
