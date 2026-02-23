# 1단계: 빌드 스테이지
# Gradle 8.5와 JDK 21이 포함된 이미지를 사용하여 빌드를 수행합니다.
FROM gradle:8.5-jdk21 AS build
WORKDIR /app

# 빌드 효율을 위해 의존성 캐시를 먼저 활용합니다.
COPY gradlew .
COPY gradle gradle
COPY build.gradle .
COPY settings.gradle .

# 의존성 파일을 미리 다운로드합니다.
RUN ./gradlew build -x test --parallel --continue > /dev/null 2>&1 || true

# 소스 코드를 복사하고 실제 빌드를 진행합니다.
COPY src src
RUN ./gradlew bootJar -x test

# 2단계: 실행 스테이지
# 실행 시에는 가벼운 JRE 21 Alpine 이미지를 사용하여 컨테이너 크기를 줄입니다.
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# 빌드 스테이지에서 생성된 jar 파일만 가져옵니다.
COPY --from=build /app/build/libs/*.jar app.jar

# 환경 변수 설정 (docker-compose에서 전달받음)
ENV TZ=Asia/Seoul

# 애플리케이션 실행 (관리자 UI 포트 8081)
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "-Dspring.profiles.active=${SPRING_PROFILES_ACTIVE}", "app.jar"]