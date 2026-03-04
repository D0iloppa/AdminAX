/**
 * 
 */
package com.adminax.engine.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "adminax_chat_message", schema = "public")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "message_id")
    private Long messageId;

    // ChatRoom 엔티티와의 연관관계 (FK: room_id)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "room_id", nullable = false)
    private ChatRoom room;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String role; // "USER", "AI", "SYSTEM" 등

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "referenced_docs", columnDefinition = "jsonb")
    private List<Map<String, Object>> referencedDocs;

    @Column(name = "tokens_used")
    @Builder.Default
    private Integer tokensUsed = 0;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}