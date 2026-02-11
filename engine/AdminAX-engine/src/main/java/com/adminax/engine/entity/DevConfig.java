/**
 * 
 */
package com.adminax.engine.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.Map;

/**
 * 
 */
@Entity
@Table(name = "dev_config")
public class DevConfig {

	@Id
    @Column(name = "config_key")
    private String configKey;

    @Column(name = "description")
    private String description;

    // PostgreSQL의 JSONB를 자바 Map으로 자동 변환 (Hibernate 6+ 기능)
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "config_value", columnDefinition = "jsonb")
    private Map<String, Object> configValue;
    
    
    
    
    

	public String getConfigKey() {
		return configKey;
	}

	public void setConfigKey(String configKey) {
		this.configKey = configKey;
	}

	public String getDescription() {
		return description;
	}

	public void setDescription(String description) {
		this.description = description;
	}

	public Map<String, Object> getConfigValue() {
		return configValue;
	}

	public void setConfigValue(Map<String, Object> configValue) {
		this.configValue = configValue;
	}
    
    
    
}
