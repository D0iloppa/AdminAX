/**
 * 
 */
package com.adminax.engine.repository;

import org.springframework.data.jpa.repository.JpaRepository;

import com.adminax.engine.entity.User;

/**
 * 
 */
public interface UserRepository extends JpaRepository<User, Long>{

}
