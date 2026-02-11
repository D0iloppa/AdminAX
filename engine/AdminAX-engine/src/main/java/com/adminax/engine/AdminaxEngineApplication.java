package com.adminax.engine;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@EnableAsync
@SpringBootApplication
@MapperScan("com.adminax.engine.mapper")
public class AdminaxEngineApplication {

	public static void main(String[] args) {
		SpringApplication.run(AdminaxEngineApplication.class, args);
	}

}
