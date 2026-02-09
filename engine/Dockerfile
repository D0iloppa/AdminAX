# 1단계: Build 스테이지
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# Gradle 빌드에 필요한 파일들만 먼저 복사 (캐시 활용)
COPY AdminAX-engine/gradlew .
COPY AdminAX-engine/gradle gradle
COPY AdminAX-engine/build.gradle .
COPY AdminAX-engine/settings.gradle .
COPY AdminAX-engine/src src

# 실행 권한 부여 및 빌드 (테스트는 스킵하여 리소스 절약)
RUN chmod +x ./gradlew
RUN ./gradlew clean bootJar -x test

# 2단계: Run 스테이지 (실행용 가벼운 JRE 사용)
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar

# 4GB 램 환경을 고려한 JVM 옵션 최적화
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]