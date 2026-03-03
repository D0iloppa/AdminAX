/**
 * 
 */
package com.adminax.engine.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.adminax.engine.entity.Document;

/**
 * 
 */
public interface DocumentRepository extends JpaRepository<Document, Long>{

	Optional<Document> findByDocUuid(String docUuid);
}
