import redis
import time
import os
import json

# Configuration (inside container network)
REDIS_HOST = "adminax-redis"
REDIS_PORT = 6379
INPUT_STREAM = "adminax:convert:stream"
RESULT_STREAM = "adminax:result:stream"

# Input Data
TEST_FILE_PATH = "/app/shared-docs/raw/test_manual.hwp"
DOC_UUID = f"test-manual-{int(time.time())}"

def main():
    print(f"[*] Connecting to Redis at {REDIS_HOST}:{REDIS_PORT}...")
    try:
        r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        r.ping()
        print("[+] Redis Connection Successful.")
    except Exception as e:
        print(f"[!] Redis Connection Failed: {e}")
        return

    # 1. Clean up old result stream consumer for clean test
    # (Optional, skipping to keep it simple)

    # 2. Push Job
    print(f"[*] Pushing job to {INPUT_STREAM}...")
    job_data = {
        "docId": DOC_UUID,
        "filePath": TEST_FILE_PATH,
        "fileType": "hwp" 
    }
    msg_id = r.xadd(INPUT_STREAM, job_data)
    print(f"[+] Job pushed. MsgID: {msg_id}")
    print(f"    Payload: {job_data}")

    # 3. Wait for Converted Result
    print(f"[*] Waiting for result in {RESULT_STREAM}...")
    start_time = time.time()
    response_found = False

    while time.time() - start_time < 30:  # 30 second timeout
        # Reading from stream from last ID ($) or specific point is tricky without group in simple script.
        # Just reading range from now-ish. Or we can XREAD with block.
        # Let's try simple XREAD from 0 first to see if anything pops up since we just pushed? 
        # Actually proper way: XREAD block=1000 streams={RESULT_STREAM: '$'} before pushing? No, simple polling.
        
        # We'll read last entry.
        response = r.xrevrange(RESULT_STREAM, count=1)
        if response:
            msg_id, data = response[0]
            if data.get("doc_uuid") == DOC_UUID or data.get("docId") == DOC_UUID: # Handle inconsistency in keys if any
                print(f"[+] Result Received!")
                print(f"    MsgID: {msg_id}")
                print(f"    Data: {json.dumps(data, indent=2)}")
                
                # Verify File Existence
                md_path = data.get("md_path") or data.get("jsonPath") # supporting both future/curr
                if md_path and os.path.exists(md_path):
                     print(f"[+] Output File Verified at: {md_path}")
                else:
                     print(f"[!] Output file path missing or not found: {md_path}")
                
                response_found = True
                break
        
        time.sleep(1)
        print(".", end="", flush=True)

    if not response_found:
        print("\n[!] Timeout waiting for result.")

if __name__ == "__main__":
    main()
