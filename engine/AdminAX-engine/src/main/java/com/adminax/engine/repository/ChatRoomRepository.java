/**
 * 
 */
package com.adminax.engine.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.adminax.engine.entity.ChatRoom;
import com.adminax.engine.entity.Document;

/**
 * 
 */
public interface ChatRoomRepository extends JpaRepository<ChatRoom, Long>{
	
	Optional<ChatRoom> findByRoomUuid(String roomUuid);
	
	
}
