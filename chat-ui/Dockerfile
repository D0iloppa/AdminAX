# 1. Base 스테이지: 공통 설정
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./

# 2. Development 스테이지: nodemon 및 모든 의존성 설치
FROM base AS development
# 모든 의존성(devDependencies 포함)을 설치합니다.
RUN npm install
COPY . .
# 개발 시 실행할 기본 명령
CMD ["npm", "run", "dev"]

# 3. Production 스테이지: 최적화 및 배포용
FROM base AS production
# 운영에 필요한 패키지만 설치합니다. (--omit=dev 또는 --production)
RUN npm install --omit=dev
COPY . .
# 운영 환경용 실행 명령
CMD ["npm", "run", "start"]