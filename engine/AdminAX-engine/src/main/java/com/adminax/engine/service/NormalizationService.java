/**
 * 
 */
package com.adminax.engine.service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
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

import com.adminax.engine.context.NormCtxt;
import com.adminax.engine.entity.Document;
import com.adminax.engine.entity.Folder;
import com.adminax.engine.entity.User;
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
	
	public enum DocumentStatus {
	    PROCESSING("PROCESSING"),
	    COMPLETED("COMPLETED"),
	    FAILED("FAILED");

	    private final String value;

	    DocumentStatus(String value) {
	        this.value = value;
	    }

	    public String getValue() {
	        return value;
	    }
	}
	
	private final FolderRepository folderRepository;
	private final UserRepository userRepository;
	private final DocumentRepository documentRepository;
	
	private final FileInitializeService fileInitializeService;
	
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
		
		List<NormCtxt> list = new ArrayList<>();
		
		for(MultipartFile file: files) {
			
			String doc_uuid = UUID.randomUUID().toString();
			String fileName = file.getOriginalFilename();
			
			
			//NormCtxt ctxt = normalize(file);
			
			NormCtxt ctxt = new NormCtxt();
			ctxt.setTask_id(task_id);
			ctxt.setName(fileName);
			ctxt.setDoc_uuid(doc_uuid);
			ctxt.setStatus(DocumentStatus.PROCESSING.getValue());
			
			try {
				fileInitializeService.initTask(ctxt, file);
			}catch(Exception e) {
				log.error("[-] 파일 [{}] 처리 실패: {}", file.getOriginalFilename(), e.getMessage());
			}
			
			// 리스트 추가
			list.add(ctxt);
			
		}
		
		context.put("task_id", task_id);
		context.put("files", list);
		
	}
	
	
	
	

}
