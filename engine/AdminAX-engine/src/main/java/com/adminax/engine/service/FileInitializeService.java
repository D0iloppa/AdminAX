/**
 * 
 */
package com.adminax.engine.service;

import java.io.File;
import java.io.IOException;
import java.util.Map;

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
import com.adminax.engine.repository.DocumentRepository;
import com.adminax.engine.repository.FolderRepository;
import com.adminax.engine.repository.UserRepository;
import com.adminax.engine.service.NormalizationService.DocumentStatus;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileInitializeService {
	
	private final DocumentRepository documentRepository;
    private final FolderRepository folderRepository;
    private final UserRepository userRepository;
    
    private final RedisTemplate<String, String> redisTemplate;
    
    @Value("${adminax.path.shared-docs}")
    private String sharedPath;

    @Value("${adminax.redis.convert-stream-key}")
    private String convertStreamKey;
    
    
    /**
     * 개별 파일 처리 (독립 트랜잭션)
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void initTask(NormCtxt ctxt, MultipartFile multipartFile) {
        if (multipartFile == null || multipartFile.isEmpty()) return;

        File targetFile = null;
        boolean isSuccess = false;

        try {
            String docUuid = ctxt.getDoc_uuid();
            String originalFilename = multipartFile.getOriginalFilename();

            // 1. 파일 물리 저장 (Service 내부의 docUpload 호출 - 혹은 유틸 클래스 활용)
            // ctxt.getDoc_path()가 여기서 세팅되어야 합니다. [cite: 2026-02-25]
            targetFile = docUpload(docUuid, multipartFile);
            ctxt.setDoc_path(targetFile.getAbsolutePath());

            // 2. DB 기록 (insertDocumentTask 호출) [cite: 2026-02-25]
            insertDocumentTask(ctxt);

            // 3. 비동기/Redis 전달 (normalize 호출) [cite: 2026-02-25]
            normalize(targetFile, originalFilename, docUuid); 

            isSuccess = true;
            log.info("[✓] 파일 처리 완료: {}", originalFilename);

        } catch (IOException e) {
            log.error("[!] 파일 저장 중 오류 발생: {}", e.getMessage());
            ctxt.setStatus(DocumentStatus.FAILED.getValue());
            
            // [중요] 이 RuntimeException이 던져져야 @Transactional이 롤백을 수행합니다. [cite: 2026-02-25]
            throw new RuntimeException("문서 초기화 실패로 인한 개별 롤백: " + ctxt.getName(), e);

        } finally {
            // 실패했을 때만 물리 파일 삭제 [cite: 2026-02-25]
            if (!isSuccess && targetFile != null && targetFile.exists()) {
                if (targetFile.delete()) {
                    log.info("[-] 로직 실패로 인한 임시 파일 삭제 완료: {}", targetFile.getName());
                }
            }
        }
    }

    /**
     * DB 인서트 로직 (initTask 트랜잭션에 합류)
     */
    private void insertDocumentTask(NormCtxt ctxt) {
    	
		
		/*
	    Folder folder = folderRepository.findById(ctxt.getFolderId())
	            .orElseThrow(() -> new RuntimeException("해당 폴더를 찾을 수 없습니다: " + ctxt.getFolderId()));
	    
	    User owner = userRepository.findById(ctxt.getOwnerId())
	            .orElseThrow(() -> new RuntimeException("해당 유저를 찾을 수 없습니다: " + ctxt.getOwnerId()));
	    */
    	
    	
        Folder folder = folderRepository.getReferenceById(1L);
        User owner = userRepository.getReferenceById(1L);

        Document document = new Document();
        document.setDocUuid(ctxt.getDoc_uuid());
        document.setDocName(ctxt.getName());
        document.setDocPath(ctxt.getDoc_path());
        document.setFolder(folder);
        document.setOwner(owner);
        document.setContent(""); 

        documentRepository.save(document);
        log.info("[+] DB 기록 완료 - docUuid: {}", document.getDocUuid());
    }

    /**
     * 실제 파일을 서버 디렉토리에 저장하는 로직
     */
    private File docUpload(String docUuid, MultipartFile file) throws IOException {
        // 도일님의 기존 docUpload 로직을 여기에 옮기거나 주입받아 사용하세요. [cite: 2026-02-25]
        String uploadDir = "/tmp/adminax/uploads/"; // 예시 경로
        File dir = new File(uploadDir);
        if (!dir.exists()) dir.mkdirs();

        File targetFile = new File(uploadDir + docUuid + "_" + file.getOriginalFilename());
        file.transferTo(targetFile);
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
    
    

}
