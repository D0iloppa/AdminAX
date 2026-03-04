/**
 * 
 */
package com.adminax.engine.dto;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ChatRequestDTO {
    private List<String> taskIds;   // 정규화 대기 중인 Task ID 목록
    private String message;         // 사용자 질문 내용
    private String sessionId;       // 세션 ID (null일 경우 서버에서 생성)
}