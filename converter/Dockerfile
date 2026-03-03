# 1. 베이스 이미지 선택 (안정적인 Ubuntu LTS)
FROM ubuntu:22.04

# 2. 환경 변수 설정 (상호작용 방지 및 타임존 설정)
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Seoul

# 3. 필수 패키지 설치
# libreoffice-writer/java-common/default-jre: 필터 에러 방지 및 자바 환경 구축
# pandoc: DOCX -> MD 변환용
# fonts-nanum: 한글 깨짐 방지
RUN apt-get update && apt-get install -y \
    libreoffice-writer \
    libreoffice-java-common \
    default-jre \
    pandoc \
    fonts-nanum \
    fonts-nanum-coding \
    python3 \
    python3-pip \
    tzdata \
    unzip \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 4. 파이썬 의존성 설치
# CPU 환경 최적화를 위한 PyTorch 및 ML 라이브러리
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip3 install --no-cache-dir \
    redis \
    transformers \
    sentence-transformers \
    einops \
    accelerate \
    pyhwp \
    six

# LibreOffice 프로필 생성을 위한 권한 우회 경로
ENV HOME=/tmp

# 5. 작업 디렉토리 설정 및 소스 복사
WORKDIR /app
COPY . /app

# 6. 공유 폴더 권한 보장 (Java와 파일 공유용)
RUN mkdir -p /app/shared-docs && chmod 777 /app/shared-docs

# 7. 워커 스크립트 실행
CMD ["python3", "-u", "worker.py"]