/**
 * 
 */
package com.adminax.engine.repository;

import org.springframework.data.jpa.repository.JpaRepository;

import com.adminax.engine.entity.ChatMessage;

/**
 * 
 */
public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long>{

}
