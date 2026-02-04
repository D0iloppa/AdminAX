/**
 * 
 */
package com.adminax.engine.service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
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
	 */
	public void processDocuments(MultipartFile[] files) {
		// TODO Auto-generated method stub
		
		
		for(MultipartFile file: files) {
			NormCtxt ctxt = normalize(file);
		}
		
	}

	/**
	 * 1. 메소드명 : normalize
	 * 2. 작성일: 2026. 2. 3.
	 * 3. 작성자: kdi39
	 * 4. 설명: 
	 * 5. 수정일: kdi39
	 */
	public NormCtxt normalize(MultipartFile multipartFile) {
	    if (multipartFile == null || multipartFile.isEmpty()) {
	        return null; 
	    }

	    try {
	        // 1. 임시 파일 대신 '공유 폴더'에 직접 저장 [cite: 2026-02-04]
	        // 파일명 충복 방지를 위해 UUID를 접두어로 사용합니다.
	        String docUuid = UUID.randomUUID().toString();
	        String savedFileName = docUuid + "_" + multipartFile.getOriginalFilename();
	        File targetFile = new File(sharedPath, savedFileName);

	        // 멀티파트 데이터를 공유 폴더로 복사 [cite: 2026-02-04]
	        multipartFile.transferTo(targetFile);

	        // 2. 비동기 처리 메서드 호출 (UUID를 넘겨서 일관성 유지)
	        return normalize(targetFile, docUuid);

	    } catch (IOException e) {
	        log.error("파일 저장 중 오류 발생: {}", e.getMessage());
	        return null;
	    }
	    
	    
	}
	
	private NormCtxt normalize(File file, String docUuid) {
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

	        // 4. (권장) DB에 초기 상태 저장 로직이 올 자리
	        // docMapper.insertInitialStatus(docUuid, file.getName(), "READY");
	        
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
