# 🤖 AdminAX: AI-Powered Knowledge Platform

AdminAX는 사내 문서를 지능적으로 분석하고 LLM을 통해 최적화된 답변을 제공하는 **RAG(Retrieval-Augmented Generation) 기반 지식 관리 시스템**입니다.

---

## 🛠 1. 사전 설치 요구사항 (Prerequisites)

Rocky Linux(Minimal) 환경에서 Docker 인프라 및 원격 개발 환경을 구축하기 위해 아래 패키지 설치가 반드시 선행되어야 합니다.

```bash
# 1. 인프라 및 원격 접속 필수 패키지 설치
sudo dnf install -y wget tar

# 2. Docker Engine 및 Compose 설치
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
```

---

## 🏗 2. 시스템 아키텍처 및 기술 스택

본 프로젝트는 단일 VM 내에서 **논리적 계층 분리**를 위해 모든 서비스를 컨테이너로 관리합니다.

### **Tech Stack**
* **Language:** Java 17 (Spring Boot)
* **Infrastructure:** Docker, Docker Compose, Nginx
* **Messaging:** Redis Streams (Internal Message Bus)
* **Search Engine:** Elasticsearch 8.x (Vector Search)
* **Database:** PostgreSQL 15

---

## 🖥 3. 개발 환경 구성 (Environment)

| 항목 | 상세 내용 |
| :--- | :--- |
| **운영체제** | Rocky Linux (RHEL 계열) |
| **하드웨어** | **RAM 4GB** / **HDD 32GB** |
| **가상 메모리** | **Swap 4GB** 할당 필수 (OOM 방지용) |
| **SSH 포트** | 외부 `13922` → 내부 `22` |
| **WEB 포트** | 외부 `13943/13980` → 내부 `80` (Nginx) |

---

## 📁 4. 프로젝트 디렉토리 구조

모든 작업은 `/app/adminAX` 경로를 기준으로 수행합니다.

```bash
/app/adminAX/
├── proxy/           # Nginx 설정 파일 (nginx.conf 등)
├── engine/          # 백엔드(Spring Boot) 소스 및 설정
├── presentation/    # 프론트엔드(UI) 소스 및 빌드 파일
└── data/            # 컨테이너 데이터 영속성 유지용 (DB 데이터 등)
    ├── postgres/    # PostgreSQL 실제 데이터 저장소
    └── elasticsearch/ # Elasticsearch 인덱스 데이터 저장소
```

---

## 🚀 5. 실행 및 관리

> **주의:** 4GB 램 환경이므로 각 컨테이너의 메모리 제한(Limit) 설정을 반드시 준수해야 합니다.

```bash
# 서비스 통합 실행
docker compose up -d

# 실시간 리소스 모니터링
docker stats

# DB 접속 (DBeaver)
# SSH 터널링: 121.136.244.39:13922 이용

ssh -L 5432:localhost:5432 -L 6379:localhost:6379 -p ${ssh_port} ${ssh_user}@${ssh_host}

#ex
ssh -L 5432:localhost:5432 -L 6379:localhost:6379 -p 13922 wellconn@121.136.244.39 

```

---

### 💡 운영 팁
* **로그 관리**: 32GB 하드 용량을 지키기 위해 Docker 로그 로테이션 설정이 필수입니다.
* **개발 워크플로우**: 로컬(Eclipse)에서 코드 작성 후 GitHub Actions를 통해 빌드된 이미지를 VM에 배포하는 방식을 권장합니다.
* **배포 방식**: SVN & git 에 모두 반영해야 하므로, git에 모든 작업을 반영한 후, git pull로 최신상태를 유지하여 줍니다. 최신상태의 데이터를 svn에 최종 커밋하여 관리합니다.