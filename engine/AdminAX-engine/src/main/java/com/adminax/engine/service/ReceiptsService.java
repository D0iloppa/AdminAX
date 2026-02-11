/**
 * 
 */
package com.adminax.engine.service;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Collectors;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.MimeTypeUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.adminax.engine.context.NormCtxt;
import com.adminax.engine.dto.DevConfigDTO;
import com.adminax.engine.dto.gemini.Content;
import com.adminax.engine.dto.gemini.GeminiRequest;
import com.adminax.engine.dto.gemini.GenerationConfig;
import com.adminax.engine.dto.gemini.InlineData;
import com.adminax.engine.dto.gemini.Part;
import com.adminax.engine.dto.gemini.SystemInstruction;
import com.adminax.engine.entity.DevConfig;
import com.adminax.engine.mapper.ConfigMapper;
import com.adminax.engine.parser.DocParser;
import com.adminax.engine.repository.DevConfigRepository;
import com.fasterxml.jackson.databind.ObjectMapper;


import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 
 */

@Slf4j
@Service
@RequiredArgsConstructor
public class ReceiptsService {
	
	// MyBatis Mapper
	private final ConfigMapper configMapper;
	
	
	// JPA
	private final DevConfigRepository devConfigRepository;
	

    private final RedisTemplate<String, String> redisTemplate;
    
    
    //private final ChatClient chatClient;
    
    // SSE Emitter 관리소
    private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();

    
    @Value("${adminax.path.shared-docs}")
    private String sharedPath;

    // --- SSE Status Management ---

    public SseEmitter subscribe(String batchId) {
        SseEmitter emitter = new SseEmitter(30 * 60 * 1000L);
        emitters.put(batchId, emitter);

        emitter.onCompletion(() -> emitters.remove(batchId));
        emitter.onTimeout(() -> emitters.remove(batchId));
        emitter.onError((e) -> emitters.remove(batchId));

        try {
            emitter.send(SseEmitter.event().name("CONNECT").data("Connected: " + batchId));
        } catch (IOException e) {
            log.error("SSE Connect Error", e);
        }
        return emitter;
    }

    public void sendProgress(String batchId, String message, int progress) {
        SseEmitter emitter = emitters.get(batchId);
        if (emitter != null) {
            try {
                Map<String, Object> data = new HashMap<>();
                data.put("message", message);
                data.put("progress", progress);
                emitter.send(SseEmitter.event().name("PROGRESS").data(data));
            } catch (IOException e) { emitters.remove(batchId); }
        }
    }
    
    
    private void sendProgressWithData(String batchId, String message, int progress, Map<String, Object> parsedData) {

        SseEmitter emitter = emitters.get(batchId);

        if (emitter != null) {
            try {
                // 2. 전송할 데이터 구조 생성
                Map<String, Object> payload = new HashMap<>();
                payload.put("message", message);
                payload.put("progress", progress);
                payload.put("parsedData", parsedData); // 이 객체가 Tabulator 그리드에 들어갑니다.

                // 3. "PROGRESS" 이벤트 이름으로 전송
                emitter.send(SseEmitter.event()
                        .name("PROGRESS")
                        .data(payload, MediaType.APPLICATION_JSON));
                
                log.info("[SSE] Sent progress with data for batch: {}, progress: {}%", batchId, progress);
            } catch (IOException e) {
                // 전송 실패 시 이미터 제거 (연결이 끊긴 경우 등)
                emitters.remove(batchId);
                log.warn("[SSE] Connection closed or error for batch: {}", batchId);
            }
        }
    }

    public void sendComplete(String batchId) {
        SseEmitter emitter = emitters.get(batchId);
        if (emitter != null) {
            try {
                Map<String, String> data = new HashMap<>();
                data.put("status", "COMPLETE");
                emitter.send(SseEmitter.event().name("COMPLETE").data(data));
                emitter.complete();
            } catch (IOException e) { emitters.remove(batchId); }
        }
    }

    // --- Business Logic ---


	public void test() {
		Optional<DevConfig> configOptional = devConfigRepository.findById("gemini_receipt_config");
		
		if (configOptional.isPresent()) {
            DevConfig config = configOptional.get();
            System.out.println("--- JPA 조회 성공 ---");
            System.out.println("Key: " + config.getConfigKey());
            System.out.println("Desc: " + config.getDescription());
            // JSONB 컬럼이 Map으로 자동 변환되었는지 확인
            System.out.println("Value (Map): " + config.getConfigValue());
        }
		
		// DevConfigDTO tmp = configMapper.findByKey("gemini_receipt_config"); 
	}
	
	public DevConfig getDevConfig() {
		Optional<DevConfig> configOptional = devConfigRepository.findById("gemini_receipt_config");
		
		DevConfig result = null;
		if (configOptional.isPresent()) {
			result = configOptional.get();
        }
		
		return result;
	}
	
	public class FileContext {
		
		private File file;
		private Map<String, String> data = new HashMap<>();
		
		
		public File getFile() {
			return file;
		}
		public void setFile(File file) {
			this.file = file;
		}
		
		public String getData(String key) {
			return this.data.getOrDefault(key, null);
		}
		
		public void putData(String key, String value) {
			this.data.put(key, value);
		}
		
		
	}

	/**
	 * 1. 메소드명 : saveToDisk
	 * 2. 작성일: 2026. 2. 10.
	 * 3. 작성자: kdi39
	 * 4. 설명: 
	 * 5. 수정일: kdi39
	 * @throws IOException 
	 */
	public List<FileContext> saveToDisk(MultipartFile[] files, String batchId) throws IOException {
		String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
	    File uploadDir = new File(sharedPath, "receipts/" + datePath + "/" + batchId);
	    
	    if (!uploadDir.exists()) {
	        uploadDir.mkdirs();
	    }

	    List<FileContext> savedFiles = new ArrayList<>();

	    for (MultipartFile file : files) {
	        if (file.isEmpty()) continue;
	        
	        
	        FileContext ctxt = new FileContext();

	        // 2. 고유 파일명 생성 (확장자 유지)
	        String originalName = file.getOriginalFilename();
	        String ext = originalName.substring(originalName.lastIndexOf("."));
	        String fileName = UUID.randomUUID().toString() + ext;
	        File targetFile = new File(uploadDir, fileName);

	        // 3. 스트림 복사 (비동기 스레드 안전성 확보)
	        try (InputStream in = file.getInputStream()) {
	            Files.copy(in, targetFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
	        }
	        
	        ctxt.setFile(targetFile);
	        ctxt.putData("orgName", originalName);
	        
	        savedFiles.add(ctxt);
	    }
	    
	    return savedFiles;
	}

	/**
	 * 1. 메소드명 : processAsync
	 * 2. 작성일: 2026. 2. 10.
	 * 3. 작성자: kdi39
	 * 4. 설명: 
	 * 5. 수정일: kdi39
	 */
	@Async
	public void processAsync(List<FileContext> savedFiles, String batchId) {
	    int total = savedFiles.size();
	    
	    try {
	        sendProgress(batchId, "분석 엔진 기동 중...", 10);

	        for (int i = 0; i < total; i++) {
	        	FileContext ctxt = savedFiles.get(i);
	            File file = ctxt.getFile();
	            String orgName = ctxt.getData("orgName");
	            
	            // 1. OCR 및 데이터 추출 (시뮬레이션)


	            Map<String, Object> parsedData = anlRecipt(file);
	            parsedData.put("orgName", orgName);

	            // 2. 진행률 계산 (10% ~ 100%)
	            int currentProgress = 10 + (int)(((i + 1) / (double)total) * 90);
	            
	            // 3. 개별 데이터 즉시 전송
	            // 이 데이터가 실시간으로 Tabulator 그리드의 'loading' 로우를 대체합니다.
	            sendProgressWithData(batchId, (i + 1) + "번째 영수증 분석 완료", currentProgress, parsedData);
	        }

	        // 4. 최종 완료 통보
	        sendComplete(batchId); 
	        log.info("[*] Analysis Completed for Batch: {}", batchId);

	    } catch (Exception e) {
	        log.error("[!] 비동기 분석 중 오류 발생: ", e);
	        sendProgress(batchId, "분석 중 오류 발생: " + e.getMessage(), 0);
	    }
	}

	/**
	 * 1. 메소드명 : anlRecipt
	 * 2. 작성일: 2026. 2. 10.
	 * 3. 작성자: kdi39
	 * 4. 설명: 
	 * 5. 수정일: kdi39
	 */

	private Map<String, Object> anlRecipt(File file) {
	    DevConfig dv = getDevConfig();
	    if (dv == null) {
	        return Map.of("status", "error", "remarks", "설정 없음");
	    }

	    Map<String, Object> config = dv.getConfigValue();
	    String apiKey = (String) config.get("api_key");
	    String modelName = (String) config.getOrDefault("model_name", "gemini-2.0-flash");
	    String systemInstruction = (String) config.getOrDefault("system_instruction", "");
	    Map<String, Object> params = (Map<String, Object>) config.getOrDefault("parameters", Map.of());

	    try {
	        byte[] bytes = Files.readAllBytes(file.toPath());
	        String b64 = Base64.getEncoder().encodeToString(bytes);

	        double temperature = ((Number) params.getOrDefault("temperature", 0.1)).doubleValue();
	        double topP = ((Number) params.getOrDefault("top_p", 0.95)).doubleValue();
	        int maxTokens = ((Number) params.getOrDefault("max_output_tokens", 4096)).intValue();

	        // Gemini generateContent request
	        Map<String, Object> body = Map.of(
	            "systemInstruction", Map.of(
	                "parts", List.of(Map.of("text", systemInstruction))
	            ),
	            "contents", List.of(
	                Map.of(
	                    "role", "user",
	                    "parts", List.of(
	                        Map.of("text", "영수증 분석 결과를 JSON만으로 출력하세요. 설명/마크다운/백틱 금지."),
	                        Map.of("inlineData", Map.of(
	                            "mimeType", "image/jpeg",
	                            "data", b64
	                        ))
	                    )
	                )
	            ),
	            "generationConfig", Map.of(
	                "temperature", temperature,
	                "topP", topP,
	                "maxOutputTokens", maxTokens,
	                "responseMimeType", "application/json"
	            )
	        );

	        WebClient wc = WebClient.builder()
	            .baseUrl("https://generativelanguage.googleapis.com")
	            .build();

	        Map<String, Object> resp = wc.post()
	            .uri("/v1beta/models/{model}:generateContent?key={key}", modelName, apiKey)
	            .contentType(MediaType.APPLICATION_JSON)
	            .bodyValue(body)
	            .retrieve()
	            .bodyToMono(Map.class)
	            .block();

	        // 응답에서 텍스트(JSON 문자열) 꺼내기: candidates[0].content.parts[0].text
	        ObjectMapper om = new ObjectMapper();
	        
	        List<?> candidates = (List<?>) resp.get("candidates");
	        if (candidates == null || candidates.isEmpty()) {
	            throw new RuntimeException("Gemini 응답 candidates 없음");
	        }

	        Map<?, ?> cand0 = (Map<?, ?>) candidates.get(0);

	        Map<?, ?> content = (Map<?, ?>) cand0.get("content");
	        List<?> parts = (List<?>) content.get("parts");

	        if (parts == null || parts.isEmpty()) {
	            throw new RuntimeException("Gemini 응답 parts 없음");
	        }

	        Map<?, ?> part0 = (Map<?, ?>) parts.get(0);

	        String text = parts.stream()
	        	    .map(p -> (String) ((Map<?, ?>) p).get("text"))
	        	    .filter(Objects::nonNull)
	        	    .collect(Collectors.joining("\n"));
	        
	        
	        // 혹시 모델이 앞뒤 군더더기 붙이면 중괄호만 잘라서 방어
	        String json = text.replaceAll("(?s)^.*?\\{", "{").replaceAll("\\}.*?$", "}");
	        return om.readValue(json, Map.class);

	    } catch (Exception e) {
	        log.error("AI 분석 실패 (파일명: {}): {}", file.getName(), e.getMessage());
	        return Map.of("status", "error", "orgName", file.getName(), "remarks", "분석 실패: " + e.getMessage());
	    }
	}
	
	
	
}
