
import redis
import json
import time

import os

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = 6379
RESULT_STREAM = 'adminax:result:stream'
GROUP_NAME = 'java_backend_group'
CONSUMER_NAME = 'java_instance_1'

def test_consumer():
    try:
        r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        
        # Create Group
        try:
            r.xgroup_create(RESULT_STREAM, GROUP_NAME, mkstream=True)
        except redis.exceptions.ResponseError:
            pass
            
        print("[*] [Stage 3] Waiting for results from Converter...")
        
        while True:
            # Read new messages
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {RESULT_STREAM: '>'}, count=1, block=5000)
            
            if not messages:
                print(".", end="", flush=True)
                continue
                
            print("\n[!] Message Received!")
            for stream, payload in messages:
                for msg_id, data in payload:
                    print(f"    MsgID: {msg_id}")
                    print(f"    Data: {json.dumps(data, indent=2, ensure_ascii=False)}")
                    
                    # ACK
                    r.xack(RESULT_STREAM, GROUP_NAME, msg_id)
                    print("    [ACK] Sent")
                    return # Exit after one message for test
                    
    except KeyboardInterrupt:
        print("\n[*] Stopped.")
    except Exception as e:
        print(f"[-] Error: {e}")

if __name__ == "__main__":
    test_consumer()
