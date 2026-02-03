/**
 * 
 */
package com.adminax.engine.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;

/**
 * 
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI adminAXOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("AdminAX Engine API")
                        .description("AI 기반 문서 정규화 및 엔터프라이즈 레거시 통합 엔진")
                        .version("v0.0.1"));
    }
    
}
