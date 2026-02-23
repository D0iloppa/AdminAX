FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
# --production을 제거하여 nodemon을 포함한 모든 패키지를 설치합니다.
RUN npm install

COPY . .
EXPOSE 8080
CMD ["npm", "run", "start"]