/**
 * 
 */
package com.adminax.engine.service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

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
	
	
	private final DocParser docParser;
	
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

	    File tempFile = null;
	    try {
	        // 임시 파일 생성 (prefix: adminax_, suffix: 원본파일명)
	        Path tempPath = Files.createTempFile("adminax_", "_" + multipartFile.getOriginalFilename());
	        tempFile = tempPath.toFile();

	        // 멀티파트 데이터를 임시 파일로 복사
	        multipartFile.transferTo(tempFile);

	        // 2. 실제 File 객체를 처리하는 메서드 호출
	        NormCtxt result = normalize(tempFile);

	        return result;

	    } catch (IOException e) {
	        log.error("파일 변환 및 정규화 중 오류 발생: {}", e.getMessage());
	        return null;
	    } finally {
	        // 처리 후 임시 파일 삭제 (디스크 용량 관리)
	        if (tempFile != null && tempFile.exists()) {
	            tempFile.delete();
	        }
	    }
	}
	
	
	
	private NormCtxt normalize(File file) {
		
	    log.info("파일 기반 정규화 수행 중: {}", file.getName());
	    
	    NormCtxt result = docParser.parse(file);
	    
	    return result; 
	}

}
