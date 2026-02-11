/**
 * 
 */
package com.adminax.engine.handler;


import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class ReceiptSocketHandler extends TextWebSocketHandler {
    
    // SID(세션ID)별로 연결된 브라우저 세션들을 관리
    private final Map<String, List<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // Gson을 이용한 JSON 파싱 [cite: 2026-02-10]
        JsonObject json = JsonParser.parseString(message.getPayload()).getAsJsonObject();
        
        if (!json.has("sid")) return;
        String sid = json.get("sid").getAsString();

        // 같은 SID를 공유하는 다른 기기(PC <-> 모바일)에게 메시지 전달 [cite: 2026-02-10]
        List<WebSocketSession> sessions = roomSessions.get(sid);
        if (sessions != null) {
            for (WebSocketSession s : sessions) {
                if (s.isOpen() && !s.getId().equals(session.getId())) {
                    s.sendMessage(new TextMessage(message.getPayload()));
                }
            }
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String sid = extractSid(session);
        if (sid != null) {
            roomSessions.computeIfAbsent(sid, k -> new CopyOnWriteArrayList<>()).add(session);
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