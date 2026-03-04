package com.adminax.engine.service;

import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.adminax.engine.entity.Document;
import com.adminax.engine.repository.DocumentRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class ChatService {

    private final RedisTemplate<String, String> redisTemplate;
    private final DocumentRepository documentRepository;
    private final ObjectMapper objectMapper;

    private static final String CHAT_INPUT_STREAM = "adminax:chat:stream";
    private static final String CHAT_RESULT_STREAM = "adminax:chat:result";

    @Async
    public void processChatMessageAsync(SseEmitter emitter, String sessionId, String message, List<String> taskIds) {
        try {
            log.info("[CHAT] Processing message for session: {}", sessionId);

            if (taskIds != null && !taskIds.isEmpty()) {
                sendSseEvent(emitter, "WAITING_TASKS", "지식 재료 분석 대기 중...");
                waitForTasks(taskIds);
            }

            List<Map<String, Object>> contexts = gatherDocumentContexts(taskIds);
            
            sendSseEvent(emitter, "GENERATING", "답변 생성 중...");
            String msgId = pushToPythonWorker(sessionId, message, contexts);
            
            String answer = waitForPythonResponse(msgId, sessionId);

            sendSseEvent(emitter, "COMPLETED", answer);
            emitter.complete();

        } catch (Exception e) {
            log.error("Error processing chat message", e);
            sendSseEvent(emitter, "ERROR", e.getMessage());
            emitter.completeWithError(e);
        }
    }

    private void sendSseEvent(SseEmitter emitter, String status, String messageOrAnswer) {
        try {
            Map<String, String> eventData = new HashMap<>();
            eventData.put("status", status);
            eventData.put(status.equals("COMPLETED") ? "answer" : "message", messageOrAnswer);
            emitter.send(SseEmitter.event().data(objectMapper.writeValueAsString(eventData)));
        } catch (Exception e) {
            log.warn("Failed to send SSE event", e);
        }
    }

    private void waitForTasks(List<String> taskIds) {
        for (String taskId : taskIds) {
            String totalKey = "task:total:" + taskId;
            String allDocsKey = "task:all_docs:" + taskId;
            
            int attempts = 0;
            long maxAttempts = 600; 
            
            while (attempts < maxAttempts) {
                String totalStr = redisTemplate.opsForValue().get(totalKey);
                if (totalStr == null) {
                    try { Thread.sleep(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    attempts += 2;
                    continue;
                }
                
                Set<String> uuids = redisTemplate.opsForSet().members(allDocsKey);
                if (uuids != null && !uuids.isEmpty()) {
                    boolean allCompleted = true;
                    for (String uuid : uuids) {
                        Document doc = documentRepository.findByDocUuid(uuid).orElse(null);
                        if (doc == null || "PROCESSING".equals(doc.getStatus()) || "PENDING".equals(doc.getStatus())) {
                            allCompleted = false;
                            break;
                        }
                    }
                    if (allCompleted) break;
                } else {
                    break;
                }
                
                try { Thread.sleep(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                attempts += 5;
            }
        }
    }

    private List<Map<String, Object>> gatherDocumentContexts(List<String> taskIds) {
        List<Map<String, Object>> contexts = new ArrayList<>();
        if (taskIds == null || taskIds.isEmpty()) return contexts;

        for (String taskId : taskIds) {
            String allDocsKey = "task:all_docs:" + taskId;
            Set<String> uuids = redisTemplate.opsForSet().members(allDocsKey);
            if (uuids != null) {
                for (String uuid : uuids) {
                    documentRepository.findByDocUuid(uuid).ifPresent(doc -> {
                        Map<String, Object> ctx = new HashMap<>();
                        ctx.put("docName", doc.getDocName());
                        ctx.put("content", doc.getContent());
                        ctx.put("canonicalJson", doc.getCanonicalJson());
                        contexts.add(ctx);
                    });
                }
            }
        }
        return contexts;
    }

    private String pushToPythonWorker(String sessionId, String message, List<Map<String, Object>> contexts) {
        String contextsJson = "[]";
        try {
            contextsJson = objectMapper.writeValueAsString(contexts);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize contexts", e);
        }

        Map<String, String> payload = new HashMap<>();
        payload.put("session_id", sessionId);
        payload.put("message", message != null ? message : "");
        payload.put("contexts", contextsJson);

        RecordId recordId = redisTemplate.opsForStream().add(CHAT_INPUT_STREAM, payload);
        log.info("[CHAT] Pushed to {}. Record ID: {}", CHAT_INPUT_STREAM, recordId);
        return recordId != null ? recordId.getValue() : null;
    }

    private String waitForPythonResponse(String correlatedMsgId, String expectedSession) {
        log.info("Waiting for python response for msg_id: {}", correlatedMsgId);
        long start = System.currentTimeMillis();
        long timeoutMs = 60000;

        while (System.currentTimeMillis() - start < timeoutMs) {
            List<MapRecord<String, Object, Object>> entries = redisTemplate.opsForStream().read(
                StreamReadOptions.empty().block(Duration.ofSeconds(2)).count(10),
                StreamOffset.latest(CHAT_RESULT_STREAM)
            );

            if (entries != null) {
                for (MapRecord<String, Object, Object> entry : entries) {
                    Map<Object, Object> val = entry.getValue();
                    String replyMsgId = (String) val.get("msg_id");
                    String replySessionId = (String) val.get("session_id");

                    if (correlatedMsgId != null && correlatedMsgId.equals(replyMsgId)) {
                        return (String) val.get("answer");
                    } else if (expectedSession != null && expectedSession.equals(replySessionId)) {
                        return (String) val.get("answer");
                    }
                }
            }
        }
        log.warn("Timed out waiting for python chat response.");
        return "죄송합니다, 문서 분석이나 생성 시간이 너무 오래걸립니다.";
    }
}
