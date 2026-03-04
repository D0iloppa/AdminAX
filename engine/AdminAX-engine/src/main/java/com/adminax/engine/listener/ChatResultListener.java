/**
 * 
 */
package com.adminax.engine.listener;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.adminax.engine.component.ChatSseEmitters;
import com.adminax.engine.component.SseEmitters;
import com.adminax.engine.entity.Document;
import com.adminax.engine.enums.DocumentStatus;
import com.adminax.engine.parser.DocParser;
import com.adminax.engine.service.ChatService;
import com.adminax.engine.service.NormalizationService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatResultListener implements StreamListener<String, MapRecord<String, String, String>> {

	
	// 컴포넌트
	private final ChatSseEmitters sseEmitters;
	
    private final RedisTemplate<String, String> redisTemplate;

    
    @Value("${adminax.redis.result-stream-key}")
    private String expectedStreamKey;
    
    private final ChatService chatService;

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        var data = message.getValue();
        
        String sessionId = data.get("sessionId");

    }
    
    
    
}