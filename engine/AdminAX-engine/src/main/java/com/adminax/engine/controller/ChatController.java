package com.adminax.engine.controller;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.adminax.engine.service.ChatService;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/chat")
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @PostMapping(value = "/sendMsg", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter sendMessage(@RequestBody Map<String, Object> payload) {
        String sessionId = (String) payload.get("session_id");
        if (sessionId == null || sessionId.isEmpty()) {
            sessionId = UUID.randomUUID().toString();
        }

        String message = (String) payload.get("message");
        @SuppressWarnings("unchecked")
        List<String> taskIds = (List<String>) payload.get("task_ids");

        // SseEmitter emitter = new SseEmitter(120_000L); // 2 minutes timeout
        SseEmitter emitter = new SseEmitter(600_000L); //

        // Async processing
        chatService.processChatMessageAsync(emitter, sessionId, message, taskIds);

        return emitter;
    }
}
