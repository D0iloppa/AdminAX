/**
 * 
 */
package com.adminax.engine.config;

import com.adminax.engine.listener.NormalizationResultListener;

import lombok.RequiredArgsConstructor;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.Subscription;

import java.time.Duration;

/**
 * 
 */
@Configuration
@RequiredArgsConstructor
public class RedisStreamConfig {

	private final NormalizationResultListener normalizationResultListener;

    @Bean
    public Subscription subscription(RedisConnectionFactory factory) {
        // 1. 컨테이너 옵션 설정 (1초 간격으로 Redis 확인)
        StreamMessageListenerContainer.StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
            StreamMessageListenerContainer.StreamMessageListenerContainerOptions
                .builder()
                .pollTimeout(Duration.ofSeconds(1))
                .build();

        // 2. 메시지 리스너 컨테이너 생성
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> container =
            StreamMessageListenerContainer.create(factory, options);

        // 3. 리스너가 감시할 스트림 주소와 리스너 연결
        // ReadOffset.from("0")으로 설정하면 이전에 쌓인 데이터부터 긁어옵니다.
        Subscription subscription = container.receive(
            StreamOffset.create("adminax:result:stream", ReadOffset.from("0")),
            normalizationResultListener
        );

        // 4. 컨테이너 가동 (가장 중요)
        container.start();
        return subscription;
    }
}
