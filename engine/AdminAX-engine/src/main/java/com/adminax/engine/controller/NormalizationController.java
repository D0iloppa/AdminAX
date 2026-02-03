/**
 * 
 */
package com.adminax.engine.controller;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.adminax.engine.service.NormalizationService;

import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

/**
 * 
 */
@RestController
@RequestMapping("/norm")
public class NormalizationController {
	
	private final NormalizationService normalizationService;
	
    public NormalizationController(NormalizationService normalizationService) {
        this.normalizationService = normalizationService;
    }
    
    @GetMapping("")
    public void samplePage(HttpServletResponse response) throws IOException {
        response.sendRedirect("norm/index.html"); 
    }
    
    @PostMapping("/normDocs")
    public ResponseEntity<?> normDocs(@RequestParam("files") MultipartFile[] files) {
        
        // 1. 유효성 검사
        if (files == null || files.length == 0) {
            return ResponseEntity.badRequest().body("업로드할 파일이 없습니다.");
        }

        // 2. 서비스로 위임 (정규화 프로세스 시작)
        normalizationService.processDocuments(files);

        // 3. 응답 결과 구성
        Map<String, Object> response = new HashMap<>();
        response.put("totalFiles", files.length);
        response.put("message", "총 " + files.length + "개의 문서에 대한 정규화 처리를 시작했습니다.");
        
        return ResponseEntity.ok(response);
    }
    
    
    

}
