/**
 * 
 */
package com.adminax.engine.controller;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.adminax.engine.component.ChatSseEmitters;
import com.adminax.engine.dto.ChatRequestDTO;
import com.adminax.engine.service.ChatService;
import com.adminax.engine.service.NormalizationService;

import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 
 */
@RestController
@RequestMapping("/chat")
@RequiredArgsConstructor
@Slf4j
public class ChatController {
	
    private final ChatService chatService;
    private final ChatSseEmitters sseEmitters; // SSE 관리 유틸리티

    @PostMapping(value = "/sendMsg", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> sendMsg(@RequestBody ChatRequestDTO request) {
        
        // 1. 세션 ID 발급 (없을 경우 신규 UUID 생성) [cite: 2026-03-03]
        String sessionId = (request.getSessionId() == null || request.getSessionId().isBlank()) 
                           ? UUID.randomUUID().toString() : request.getSessionId();
        
        request.setSessionId(sessionId);

        // 2. SSE Emitter 등록 (AI 답변용 통로 확보)
        SseEmitter emitter = sseEmitters.subscribe(sessionId);
        
        // 3. 비동기 작업 시작 (Task 대기 -> LLM 트리거) [cite: 2026-03-03]
        chatService.processChatPipeline(request);
        
        log.info("[Chat] New Request - Session: {}, Tasks: {}", sessionId, request.getTaskIds());
        
        // Emitter를 즉시 반환하여 프론트엔드와 SSE 연결 유지
        return ResponseEntity.ok(emitter);
    }

}
