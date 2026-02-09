/**
 * 
 */
package com.adminax.engine.controller;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.adminax.engine.service.ReceiptsService;

import jakarta.servlet.http.HttpServletResponse;

/**
 * 
 */
@RestController
@RequestMapping("/receipt")
public class ReceiptsController {
	
	private final ReceiptsService receiptsService;
	
    public ReceiptsController(ReceiptsService receiptsService) {
        this.receiptsService = receiptsService;
    }
    
    @GetMapping("/")
    public void samplePage(HttpServletResponse response) throws IOException {
    	response.sendRedirect("index.html");
    }
    
    @GetMapping(value = "/subscribe/{batchId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter subscribe(@PathVariable String batchId) {
        return receiptsService.subscribe(batchId);
    }
    
    @PostMapping("/upload")
    public ResponseEntity<?> uploadReceipts(@RequestParam("files") MultipartFile[] files) {
        
        if (files == null || files.length == 0) {
            return ResponseEntity.badRequest().body("업로드할 파일이 없습니다.");
        }

        // 1. 이번 업로드 묶음을 식별할 Batch ID 생성 (CSV 병합의 기준점)
        String batchId = UUID.randomUUID().toString();

        // 2. 서비스 레이어 호출 (비동기 처리를 권장합니다)
        receiptsService.upload(files, batchId);

        // 3. 응답 결과 구성 (Batch ID를 반환하여 클라이언트가 상태를 추적하게 함)
        Map<String, Object> result = new HashMap<>();
        result.put("batchId", batchId);
        result.put("totalFiles", files.length);
        result.put("message", "총 " + files.length + "개의 영수증 분석 및 CSV 병합을 시작했습니다.");
        
        return ResponseEntity.ok(result);
    }
    
    
    

}
