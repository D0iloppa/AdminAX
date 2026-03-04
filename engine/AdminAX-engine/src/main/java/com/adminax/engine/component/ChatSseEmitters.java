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
public class ChatSseEmitters {
	
	// sessionId별 SseEmitter 관리
    private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();
    
    

    public SseEmitter subscribe(String sessionId) {
    	
        SseEmitter emitter = new SseEmitter(1000L * 60 * 30); // 30분 유지
        this.emitters.put(sessionId, emitter);

        emitter.onCompletion(() -> this.emitters.remove(sessionId));
        emitter.onTimeout(() -> this.emitters.remove(sessionId));
        emitter.onError((e) -> this.emitters.remove(sessionId));

        return emitter;
    }
    
    

    public void send(String sessionId, String eventName, Object data) {
        SseEmitter emitter = emitters.get(sessionId);
        if (emitter != null) {
            try {
                emitter.send(SseEmitter.event()
                        .name(eventName)
                        .data(data));
            } catch (IOException e) {
                emitters.remove(sessionId);
            }
        }
    }
    
    public void complete(String sessionId) {
        SseEmitter emitter = emitters.remove(sessionId);
        if (emitter != null) {
            emitter.complete();
        }
    }

}
