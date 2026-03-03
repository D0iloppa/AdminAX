/**
 * 
 */
package com.adminax.engine.service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import com.adminax.engine.component.SseEmitters;
import com.adminax.engine.context.NormCtxt;
import com.adminax.engine.entity.Document;
import com.adminax.engine.entity.Folder;
import com.adminax.engine.entity.User;
import com.adminax.engine.enums.DocumentStatus;
import com.adminax.engine.parser.DocParser;
import com.adminax.engine.repository.DevConfigRepository;
import com.adminax.engine.repository.DocumentRepository;
import com.adminax.engine.repository.FolderRepository;
import com.adminax.engine.repository.UserRepository;


import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 
 */

@Slf4j
@Service
@RequiredArgsConstructor
public class NormalizationService {
	
	private final FolderRepository folderRepository;
	private final UserRepository userRepository;
	private final DocumentRepository documentRepository;
	
	private final FileInitializeService fileInitializeService;
	
	private final ObjectMapper objectMapper;
	// 1. 상단에 선언된 의존성들
    private final RedisTemplate<String, String> redisTemplate;
  

    // 컨테이너 내부의 공유 볼륨 경로
    @Value("${adminax.path.shared-docs}")
    private String sharedPath;

    @Value("${adminax.redis.convert-stream-key}")
    private String convertStreamKey;
	
	
	private final DocParser docParser;
	// private final DocMapper docMapper; // MyBatis 매퍼 (준비되면 주입)
	
	/**
	 * 1. 메소드명 : processDocuments
	 * 2. 작성일: 2026. 2. 3.
	 * 3. 작성자: kdi39
	 * 4. 설명: 
	 * 5. 수정일: kdi39
	 * @param context 
	 */
	public void processDocuments(MultipartFile[] files, Map<String, Object> context) {

		
		// 큐잉 등록
		String task_id = UUID.randomUUID().toString();
		
		
		// redis task 등록
		//taskRegistration(files, task_id);
		
		
		List<NormCtxt> list = new ArrayList<>();
		
		for(MultipartFile file: files) {
			
			String doc_uuid = UUID.randomUUID().toString();
			String fileName = file.getOriginalFilename();
			
			
			NormCtxt ctxt = new NormCtxt();
			ctxt.setTask_id(task_id);
			ctxt.setName(fileName);
			ctxt.setDoc_uuid(doc_uuid);
			ctxt.setStatus(DocumentStatus.PROCESSING.getValue());
			
			try {
				fileInitializeService.initTask(ctxt, file);
			}catch(Exception e) {
				log.error("[-] 파일 [{}] 처리 실패: {}", file.getOriginalFilename(), e.getMessage());
				ctxt.setStatus(DocumentStatus.FAILED.getValue());
			}
			
			
			list.add(ctxt);
			
		}
		
		taskRegistration(task_id, list);
		
		
		context.put("task_id", task_id);
		context.put("files", list);
		
	}

	/**
	 * 1. 메소드명 : taskRegistration
	 * 2. 작성일: 2026. 2. 26.
	 * 3. 작성자: kdi39
	 * 4. 설명: 
	 * 5. 수정일: kdi39
	 * @param task_id
	 * @param doc_list
	 */
	private void taskRegistration(String task_id, List<NormCtxt> doc_list) {
	
		
		String allDocsKey = "task:all_docs:" + task_id; // 전체 관리용 Set
		String totalKey = "task:total:" + task_id;
	    String failKey = "task:fail:" + task_id;
	    
	    // 1. 목표치 설정 (비교용)
	    redisTemplate.opsForValue().set(
    		totalKey, 
    		String.valueOf(doc_list.size()), 
    		Duration.ofHours(24)
	    );

	    // 2. 전체 UUID 목록 관리
	    for (NormCtxt ctxt : doc_list) {
	    	
	        redisTemplate.opsForSet()
	        	.add(allDocsKey, ctxt.getDoc_uuid());
	        
	        String er = DocumentStatus.FAILED.getValue();
	        // 3. 루프 중 이미 에러가 난 항목 처리
	        if (er.equals(ctxt.getStatus())) {
	            redisTemplate.opsForSet()
	            	.add(failKey, ctxt.getDoc_uuid());
	        }
	    }
	    
	    // 만료 시간 일괄 설정
	    redisTemplate.expire(allDocsKey, Duration.ofHours(24));
	    redisTemplate.expire(failKey, Duration.ofHours(24));
	}

	
	private final SseEmitters sseEmitters;

		/**
		 * 1. 메소드명 : docSubscribe
		 * 2. 작성일: 2026. 3. 3.
		 * 3. 작성자: kdi39
		 * 4. 설명: 
		 * 5. 수정일: kdi39
		 */
	public SseEmitter docSubscribe(String taskId) {
		return sseEmitters.subscribe(taskId);
	}

	@Transactional
    public void updateDocumentToSuccess(String docUuid, String jsonPath) {
        // 1. 엔티티 조회
        Document doc = documentRepository.findByDocUuid(docUuid)
            .orElseThrow(() -> new RuntimeException("해당 UUID의 문서를 찾을 수 없습니다: " + docUuid));

        try {
            // 2. Python이 생성한 JSON 파일 물리적 로드
            File jsonFile = new File(jsonPath);
            JsonNode root = objectMapper.readTree(jsonFile);

            // 3. 필드 매핑 및 업데이트 (Entity 필드명 준수)
            // AI가 추출한 제목 (있을 경우에만 업데이트)
            String aiTitle = root.path("title").asText();
            if (aiTitle != null && !aiTitle.isBlank() && !"No Title".equals(aiTitle)) {
                doc.setDocName(aiTitle);
            }

            // AI가 정제한 요약
            doc.setSummary(root.path("summary").asText(""));

            // 원본 텍스트 (full_content -> content)
            doc.setContent(root.path("full_content").asText(""));

            // 상태 변경 (Enum 사용)
            doc.setStatus(DocumentStatus.COMPLETED.getValue());

            // 전체 JSON 구조를 Map으로 변환하여 jsonb 필드에 저장
            // canonical_data 혹은 전체 root를 저장할 수 있습니다.
            Map<String, Object> jsonMap = objectMapper.convertValue(root, new TypeReference<>() {});
            doc.setCanonicalJson(jsonMap);

            // 4. 저장
            documentRepository.save(doc);
            log.info("[✓] JPA Entity 업데이트 완료 (ID: {}, Name: {})", doc.getDocId(), doc.getDocName());

        } catch (IOException e) {
            log.error("[-] JSON 파일 매핑 실패 (Path: {}): {}", jsonPath, e.getMessage());
            updateDocumentToFail(docUuid, "JSON Mapping Error: " + e.getMessage());
        }
    }

    @Transactional
    public void updateDocumentToFail(String docUuid, String errorMsg) {
        documentRepository.findByDocUuid(docUuid).ifPresent(doc -> {
            doc.setStatus(DocumentStatus.FAILED.getValue());
            // 실패 사유를 summary에 남겨두면 나중에 디버깅하기 편합니다.
            doc.setSummary("Error: " + errorMsg); 
            documentRepository.save(doc);
            log.warn("[!] 문서 처리 실패 기록 완료: {}", docUuid);
        });
    }

	
	
	

}
