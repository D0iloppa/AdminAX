/**
 * 
 */
package com.adminax.engine.handler;


import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import com.adminax.engine.service.ReceiptsService;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import lombok.extern.slf4j.Slf4j;

import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Slf4j
public class ReceiptSocketHandler extends TextWebSocketHandler {
    
    // SID(세션ID)별로 연결된 브라우저 세션들을 관리
    private final Map<String, List<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // 1. 세션 속성에서 sid 가져오기 (이미 handshake 때 저장했다고 가정) [cite: 2026-02-11]
        // 만약 저장 안 했다면 session.getAttributes().get("sid") 등을 활용하세요.
        String sid = extractSid(session); 
        
        if (sid == null) {
            log.error("❌ SID를 찾을 수 없는 세션입니다: {}", session.getId());
            return;
        }

        // 2. 릴레이 로직 [cite: 2026-02-11]
        List<WebSocketSession> sessions = roomSessions.get(sid);
        if (sessions != null) {
            // [로그] 릴레이 대상 수 확인
            log.info("📩 [{}] 그룹 내 {}명에게 메시지 릴레이 시작", sid, sessions.size() - 1);
            
            for (WebSocketSession s : sessions) {
                if (s.isOpen() && !s.getId().equals(session.getId())) {
                    // 원본 페이로드를 그대로 전달 (재파싱/재생성 비용 절감) [cite: 2026-02-11]
                    s.sendMessage(message);
                }
            }
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String sid = extractSid(session);
        if (sid != null) {
            List<WebSocketSession> sessions = roomSessions.computeIfAbsent(sid, k -> new CopyOnWriteArrayList<>());
            sessions.add(session);

            // [추가] 그룹 내 다른 클라이언트들에게 접속 알림 전송
            String notice = "{ \"type\": \"SYSTEM\", \"message\": \"NEW_CLIENT_JOINED\" }";
            for (WebSocketSession s : sessions) {
                // 나를 제외한 다른 세션이 열려있다면 알림 전송 [cite: 2026-02-11]
                if (s.isOpen() && !s.getId().equals(session.getId())) {
                    s.sendMessage(new TextMessage(notice));
                }
            }
        }
    }

    private String extractSid(WebSocketSession session) {
        String query = session.getUri().getQuery();
        if (query != null && query.contains("sid=")) {
            return query.split("sid=")[1].split("&")[0];
        }
        return null;
    }
}