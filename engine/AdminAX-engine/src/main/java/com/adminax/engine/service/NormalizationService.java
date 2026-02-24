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
import org.springframework.web.multipart.MultipartFile;

import com.adminax.engine.context.NormCtxt;
import com.adminax.engine.parser.DocParser;

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
			
			initTask(ctxt, file);
			
			// 리스트 추가
			list.add(ctxt);
			
		}
		
		context.put("task_id", task_id);
		context.put("files", list);
		
	}

	private void initTask(NormCtxt ctxt, MultipartFile multipartFile) {
	
		if (multipartFile == null || multipartFile.isEmpty()) return;
	
		
		File targetFile = null;
		
		try {
	
			String docUuid = ctxt.getDoc_uuid();
			String originalFilename = multipartFile.getOriginalFilename();
	
			// 1. 파일 업로드
			targetFile = docUpload(docUuid, multipartFile);
			
			// 2. DB에 기록
			insertDocumentTask(ctxt); 
	
			// 3. 비동기 처리 메서드 호출
			normalize(targetFile, originalFilename, docUuid);
	
		} catch (IOException e) {			
			
			log.error("파일 저장 중 오류 발생: {}", e.getMessage());
			ctxt.setStatus(DocumentStatus.FAILED.getValue());
			
		}finally {
			
			if (targetFile != null && targetFile.exists()) {
		        targetFile.delete(); 
		        log.info("[-] 로직 실패로 인한 임시 파일 삭제 완료: {}", targetFile.getName());
		    }
		}
	
	}
	
	
	
		/**
		 * 1. 메소드명 : insertDocumentTask
		 * 2. 작성일: 2026. 2. 24.
		 * 3. 작성자: kdi39
		 * 4. 설명: 
		 * 5. 수정일: kdi39
		 */
	private void insertDocumentTask(NormCtxt ctxt) {
		// TODO Auto-generated method stub
		
	}

	/**
	 * 1. 메소드명 : docUpload
	 * 2. 작성일: 2026. 2. 24.
	 * 3. 작성자: kdi39
	 * 4. 설명: 
	 * 5. 수정일: kdi39
	 * @throws IOException 
	 * @throws IllegalStateException 
	 */
	private File docUpload(String docUuid, MultipartFile multipartFile) throws IllegalStateException, IOException {
	
		String originalFilename = multipartFile.getOriginalFilename();
	
		// 1. 원본 파일명에서 확장자 추출 (.hwp, .pdf 등)
		String extension = "";
		if (originalFilename != null && originalFilename.contains(".")) {
			extension = originalFilename.substring(originalFilename.lastIndexOf("."));
		}
	
		// 날짜별 폴더 경로 생성 (YYYYMMDD)
		String dateDir = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
		File storageDir = new File(sharedPath, dateDir);
	
		if (!storageDir.exists()) {
			boolean created = storageDir.mkdirs();
			if (created) {
				log.info("[+] 새 날짜 디렉토리 생성: {}", storageDir.getAbsolutePath());
			}
		}
	
		// 2. 물리적 저장은 [UUID].[확장자] 형태로 (특수문자/공백 문제 원천 차단)
		String savedFileName = docUuid + extension;
		File targetFile = new File(storageDir, savedFileName);
	
		multipartFile.transferTo(targetFile);
	
		log.info("[*] 물리 파일 저장 완료: {} (원본명: {})", targetFile.getAbsolutePath(), originalFilename);
		
		return targetFile;
	
	}
	
	
	private NormCtxt normalize(File file, String orgName, String docUuid) {
	    log.info("[*] 비동기 정규화 요청 시작 - 파일: {}, UUID: {}", file.getName(), docUuid);

	    try {
	    	
	        // Redis로 보낼 메시지 구성 (Payload)
	    	
	        Map<String, String> payload = Map.of(
	            "file_path", file.getAbsolutePath(), // 공유 볼륨 내의 절대 경로
	            "doc_uuid", docUuid,
	            "filename", file.getName()
	        );

	        // Redis Stream에 메시지 추가 (XADD)
	        redisTemplate.opsForStream().add(
                StreamRecords.newRecord()
                    .in(convertStreamKey)
                    .ofMap(payload)
            );
	        
	        NormCtxt result = new NormCtxt();
	        result.setDoc_uuid(docUuid);
	        

	        return result; // 결과 대신 추적용 UUID 반환

	    } catch (Exception e) {
	        log.error("[!] Redis 메시지 발행 중 에러 발생: {}", file.getName(), e);
	        throw new RuntimeException("정규화 요청 실패", e);
	    }
	}
	
	
	
	private NormCtxt normalize_org(File file) {
		
	    log.info("파일 기반 정규화 수행 중: {}", file.getName());
	    
	    NormCtxt result = docParser.parse(file);
	    
	    return result; 
	}

}
