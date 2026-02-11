/**
 * 
 */
package com.adminax.engine.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import com.adminax.engine.dto.DevConfigDTO;

/**
 * 
 */
@Mapper
public interface ConfigMapper {
    DevConfigDTO findByKey(@Param("configKey") String configKey);
}