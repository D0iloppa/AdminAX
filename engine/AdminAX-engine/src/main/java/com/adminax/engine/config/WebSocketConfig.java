/**
 * 
 */
package com.adminax.engine.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import com.adminax.engine.handler.ReceiptSocketHandler;

/**
 * 
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
	
	@Value("${adminax.websocket.max-buffer-size-mb}")
    private int maxBufferSizeMb;
	
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(new ReceiptSocketHandler(), "/ws/receipt").setAllowedOrigins("*");
    }
    
    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        
        long bufferSizeInBytes = (long) maxBufferSizeMb * 1024 * 1024;
        
        container.setMaxTextMessageBufferSize((int) bufferSizeInBytes);
        container.setMaxBinaryMessageBufferSize((int) bufferSizeInBytes);
        
        return container;
    }
}