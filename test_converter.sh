#!/bin/bash

# 1. 이미지 빌드 (캐시 활용, 이미 docker-compose로 올라가 있지만 테스트용 이미지 갱신)
echo "[*] Building Converter Docker Image (Test)..."
docker build -t adminax-converter:test ./converter

# 2. 캐시 디렉토리 및 테스트 파일 준비
mkdir -p ./data/huggingface
mkdir -p ./shared-docs/raw

# 3. 네트워크 확인 (adminax-network가 존재해야 함 - docker compose up 상태여야 함)
NET_NAME="adminax-network"
if [ -z "$(docker network ls | grep $NET_NAME)" ]; then
    echo "[!] Error: '$NET_NAME' not found. Please run 'sudo docker compose up -d' first."
    exit 1
fi

# 더미 HWP 파일 생성 (파일이 하나도 없을 때만 생성)
EXISTING_HWP=$(find ./shared-docs/raw -maxdepth 1 -name "*.hwp" | head -n 1)

if [ -z "$EXISTING_HWP" ]; then
    echo "[*] No HWP file found. Creating dummy test file..."
    if [ ! -f "./shared-docs/raw/test_manual.hwp" ]; then
        echo "# Hello AdminAX" > ./shared-docs/raw/temp.md
        docker run --rm -v $(pwd)/shared-docs:/data pandoc/core -f gfm -t docx /data/raw/temp.md -o /data/raw/test_manual.docx
        mv ./shared-docs/raw/test_manual.docx ./shared-docs/raw/test_manual.hwp
        rm ./shared-docs/raw/temp.md
    fi
    TARGET_FILE="/app/shared-docs/raw/test_manual.hwp"
else
    # 호스트 경로(./shared-docs/...)를 컨테이너 경로(/app/shared-docs/...)로 변환
    FILENAME=$(basename "$EXISTING_HWP")
    TARGET_FILE="/app/shared-docs/raw/$FILENAME"
    echo "[*] Found existing HWP file: $FILENAME"
fi

echo "[*] Target File for Test: $TARGET_FILE"

echo "---------------------------------------------------------"
echo "[*] Starting Pipeline Integration Test"
echo "---------------------------------------------------------"

# 4. Mock Java Consumer 실행 (백그라운드)
# 결과를 기다리는 역할. 30초 타임아웃 설정.
echo "[1/3] Starting Mock Java Consumer (Waiting for result)..."
timeout 60s docker run --rm \
  --network $NET_NAME \
  --env REDIS_HOST=adminax-redis \
  -v $(pwd)/test_stage3_mock_java_consumer.py:/app/test_consumer.py \
  adminax-converter:test \
  python3 /app/test_consumer.py &
CONSUMER_PID=$!

# 잠시 대기 (Consumer가 Redis 그룹 생성 및 구독할 시간 확보)
sleep 3

# 5. Mock Java Producer 실행
# 일감을 던지는 역할.
echo "[2/3] Starting Mock Java Producer (Sending job)..."
docker run --rm \
  --network $NET_NAME \
  --env REDIS_HOST=adminax-redis \
  --env TARGET_FILE="$TARGET_FILE" \
  -v $(pwd)/test_stage1_mock_java.py:/app/test_producer.py \
  adminax-converter:test \
  python3 /app/test_producer.py

# 6. 결과 확인
# Consumer 프로세스가 종료될 때까지 대기
wait $CONSUMER_PID
EXIT_CODE=$?

echo "---------------------------------------------------------"
if [ $EXIT_CODE -eq 0 ]; then
    echo "[SUCCESS] Pipeline Test Passed!"
else
    echo "[FAIL] Pipeline Test Failed or Timed out."
fi
echo "---------------------------------------------------------"
