/**
 * 
 */
package com.adminax.engine.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

/**
 * 
 */
@Configuration
public class JacksonConfig {

    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        
        // Java 8 날짜/시간(LocalDateTime 등) 처리를 위한 모듈 등록
        mapper.registerModule(new JavaTimeModule());
        
        // 타임스탬프 대신 ISO-8601 형식으로 날짜 출력
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        
        // JSON에 엔티티에 없는 필드가 있어도 에러 내지 않고 무시
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        
        return mapper;
    }
}
