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

import com.adminax.engine.component.SseEmitters;
import com.adminax.engine.entity.Document;
import com.adminax.engine.enums.DocumentStatus;
import com.adminax.engine.parser.DocParser;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NormalizationResultListener implements StreamListener<String, MapRecord<String, String, String>> {

	
	// 컴포넌트
	private final SseEmitters sseEmitters;
	
    private final RedisTemplate<String, String> redisTemplate;

	
    private final DocParser docParser; 
    // private final DocMapper docMapper; 
    
    @Value("${adminax.redis.result-stream-key}")
    private String expectedStreamKey;

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
    	
        var data = message.getValue();
        
        String taskId = data.get("task_id");
        String docUuid = data.get("doc_uuid");
        String status = data.get("status"); // 현재 상태 (START, STEP1, COMPLETED 등)

        // 1. 현재 문서의 상태를 실시간으로 클라이언트에 전송
        sseEmitters.send(taskId, DocumentStatus.DOC_PROGRESS.getValue(), Map.of(
            "docUuid", docUuid,
            "status", status
        ));
        
        String completeLabel = DocumentStatus.COMPLETED.getValue();
        String failedLabel = DocumentStatus.FAILED.getValue();

        if (completeLabel.equals(status) || failedLabel.equals(status)) {
            handleDocumentCompletion(taskId, docUuid);
        }
    }
    
    private void handleDocumentCompletion(String taskId, String docUuid) {
    	
        String completedSetKey = "task:completed_docs:" + taskId;
        
        redisTemplate.opsForSet().add(completedSetKey, docUuid);
        
        Long currentCount = redisTemplate.opsForSet().size(completedSetKey);
        
        
        String totalValue = redisTemplate.opsForValue().get("task:total:" + taskId);
        
        if (totalValue == null) {
            log.warn("[-] Task {}의 전체 개수 정보를 찾을 수 없습니다.", taskId);
            return;
        }
        
        int totalCount = Integer.parseInt(totalValue);
        
        // 전체 완료 알림
        if (currentCount != null && currentCount >= totalCount) {
            sseEmitters.send(taskId, "TASK_FINISHED", Map.of(
                "taskId", taskId,
                "message", "모든 문서의 정규화 처리가 끝났습니다."
            ));
            sseEmitters.complete(taskId);
            
            redisTemplate.expire(completedSetKey, Duration.ofMinutes(5));
            redisTemplate.expire("task:total:" + taskId, Duration.ofMinutes(5));
        }
    }
    
    
    
    
}