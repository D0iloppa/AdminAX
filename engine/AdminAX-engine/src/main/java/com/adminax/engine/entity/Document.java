/**
 * 
 */
package com.adminax.engine.entity;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 
 */
@Entity
@Table(name = "adminax_documents")
@Getter @Setter @NoArgsConstructor
public class Document {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long docId;

    @Column(nullable = false, length = 36)
    private String docUuid; 

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "folder_id")
    private Folder folder;

    private String docName;
    private String docPath;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    private User owner;

    @Column(columnDefinition = "TEXT")
    private String content;

    private String summary;

    // PostgreSQL text[] 및 jsonb 처리를 위해 명시 (관련 라이브러리 필요)
    @JdbcTypeCode(SqlTypes.ARRAY) 
    @Column(name = "keywords", columnDefinition = "text[]")
    private String[] keywords; 
    
    @Column(name = "canonical_json", columnDefinition = "jsonb")
    private String canonicalJson;
}