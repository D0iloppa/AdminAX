# 1. 베이스 이미지 선택 (안정적인 Ubuntu LTS)
FROM ubuntu:22.04

# 2. 환경 변수 설정 (상호작용 방지 및 타임존 설정)
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Seoul

# 3. 필수 패키지 설치
# libreoffice: HWP -> DOCX 변환 엔진
# pandoc: DOCX -> MD 변환 엔진 (최종 산출물 제작용)
# fonts-nanum: 한글 깨짐 방지 필수 폰트
# python3-pip: Redis 워커 및 제어 로직 실행용
RUN apt-get update && apt-get install -y \
    libreoffice \
    pandoc \
    fonts-nanum \
    fonts-nanum-coding \
    python3 \
    python3-pip \
    tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 4. 파이썬 의존성 설치 (Redis Streams 라이브러리)
# Qwen3-Embedding 구동을 위한 ML 라이브러리 추가
# 디스크 공간 부족(32GB) 및 CPU 환경을 고려하여 PyTorch CPU 전용 버전 설치
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip3 install --no-cache-dir \
    redis \
    transformers \
    sentence-transformers \
    einops \
    accelerate \
    pyhwp \
    six

# 5. 작업 디렉토리 설정 및 소스 복사
WORKDIR /app
COPY . /app

# 6. 공유 폴더 권한 보장 및 생성 (엔진과 파일 공유용)
RUN mkdir -p /app/shared-docs && chmod 777 /app/shared-docs

# 7. 워커 스크립트 실행
# -u 옵션은 도커 로그 출력을 실시간으로 확인하기 위함입니다.
CMD ["python3", "-u", "worker.py"]