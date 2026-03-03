/**
 * 
 */
package com.adminax.engine.component;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import lombok.extern.slf4j.Slf4j;

/**
 * 
 */
@Component
@Slf4j
public class SseEmitters {
	
	// task_id별 SseEmitter 관리
    private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();
    
    

    public SseEmitter subscribe(String taskId) {
        SseEmitter emitter = new SseEmitter(1000L * 60 * 30); // 30분 유지
        this.emitters.put(taskId, emitter);

        emitter.onCompletion(() -> this.emitters.remove(taskId));
        emitter.onTimeout(() -> this.emitters.remove(taskId));
        emitter.onError((e) -> this.emitters.remove(taskId));

        return emitter;
    }

    public void send(String taskId, String eventName, Object data) {
        SseEmitter emitter = emitters.get(taskId);
        if (emitter != null) {
            try {
                emitter.send(SseEmitter.event()
                        .name(eventName)
                        .data(data));
            } catch (IOException e) {
                emitters.remove(taskId);
            }
        }
    }
    
    public void complete(String taskId) {
        SseEmitter emitter = emitters.remove(taskId);
        if (emitter != null) {
            emitter.complete();
        }
    }

}
