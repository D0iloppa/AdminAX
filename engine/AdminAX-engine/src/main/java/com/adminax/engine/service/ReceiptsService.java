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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

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
public class ReceiptsService {

    private final RedisTemplate<String, String> redisTemplate;
    
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

    public void sendComplete(String batchId, String downloadUrl) {
        SseEmitter emitter = emitters.get(batchId);
        if (emitter != null) {
            try {
                Map<String, String> data = new HashMap<>();
                data.put("status", "COMPLETE");
                data.put("downloadUrl", downloadUrl);
                emitter.send(SseEmitter.event().name("COMPLETE").data(data));
                emitter.complete();
            } catch (IOException e) { emitters.remove(batchId); }
        }
    }

    // --- Business Logic ---

    /**
     * 영수증 업로드 및 비동기 프로세스 트리거
     */
    @Async // 컨트롤러가 즉시 응답할 수 있게 비동기 처리
    public void upload(MultipartFile[] files, String batchId) {
        try {
            int total = files.length;
            sendProgress(batchId, "작업을 시작합니다. 총 " + total + "개의 파일이 확인되었습니다.", 5);

            // 1. 디렉토리 생성 (YYYYMMDD/batchId)
            String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            File uploadDir = new File(sharedPath, "receipts/" + datePath + "/" + batchId);
            if (!uploadDir.exists()) uploadDir.mkdirs();

            // 2. 물리 파일 저장 및 OCR 대기열 구성
            List<File> savedFiles = new ArrayList<>();
            for (int i = 0; i < total; i++) {
                MultipartFile file = files[i];
                String ext = file.getOriginalFilename().substring(file.getOriginalFilename().lastIndexOf("."));
                File targetFile = new File(uploadDir, UUID.randomUUID().toString() + ext);
                file.transferTo(targetFile);
                savedFiles.add(targetFile);

                int saveProgress = 5 + (int)(((i + 1) / (double)total) * 15); // 5% ~ 20%
                sendProgress(batchId, "파일 저장 중... (" + (i+1) + "/" + total + ")", saveProgress);
            }

            // 3. 외부 OCR API 연동 및 결과 파싱 (여기서는 시뮬레이션)
            sendProgress(batchId, "상용 OCR 엔진 분석을 시작합니다.", 25);
            for (int i = 0; i < total; i++) {
            	
            	
            	
                // TODO: Naver/Google OCR API Call
                Thread.sleep(1000); // API 응답 대기 시뮬레이션
                
                int ocrProgress = 25 + (int)(((i + 1) / (double)total) * 60); // 25% ~ 85%
                
                
                
                
                
                
                sendProgress(batchId, (i+1) + "번째 영수증 데이터 추출 완료", ocrProgress);
            }

            // 4. CSV 병합 및 최종 파일 생성
            sendProgress(batchId, "데이터 병합 및 CSV 파일을 생성 중입니다.", 90);
            String finalCsvPath = mergeResultsToCsv(batchId, savedFiles); // 자바단에서 CSV Write 로직

            // 5. 작업 완료 통보
            sendComplete(batchId, "/api/receipt/download/" + batchId);
            log.info("[*] Batch Process Completed: {}", batchId);

        } catch (Exception e) {
            log.error("[!] Batch Processing Error: ", e);
            sendProgress(batchId, "오류가 발생했습니다: " + e.getMessage(), 0);
        }
    }

    private String mergeResultsToCsv(String batchId, List<File> files) {
        // 실제 CSV 생성 로직 (OpenCSV 등을 사용하거나 String을 파일로 Write)
        return "merge_result_" + batchId + ".csv";
    }
}
