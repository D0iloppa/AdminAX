/**
 * 
 */
package com.adminax.engine.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.adminax.engine.entity.DevConfig;

/**
 * 
 */
@Repository
public interface DevConfigRepository extends JpaRepository<DevConfig, String> {

}
