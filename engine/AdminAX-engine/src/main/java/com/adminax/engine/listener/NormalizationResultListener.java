/**
 * 
 */
package com.adminax.engine.listener;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.stereotype.Component;

import com.adminax.engine.parser.DocParser;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NormalizationResultListener implements StreamListener<String, MapRecord<String, String, String>> {

    private final DocParser docParser; 
    // private final DocMapper docMapper; 

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        // 1. 파이썬 워커가 보낸 데이터 추출 (md_path, doc_uuid)
        var data = message.getValue();
        String mdPath = data.get("md_path");
        String docUuid = data.get("doc_uuid");
        String status = data.get("status");

        log.info("[*] 변환 결과 수신 - Status: {}, UUID: {}", status, docUuid);
        log.info("[*] MD 파일 경로: {}", mdPath);

        if (!"SUCCESS".equals(status)) {
            log.error("[!] 워커에서 변환 실패 보고됨: {}", docUuid);
            return;
        }

        try {
            // 2. MD 파일 읽기 (NIO 활용)
            Path path = Paths.get(mdPath);
            if (Files.exists(path)) {
                // 파일 내용을 문자열로 읽어옴
                String markdownContent = Files.readString(path, StandardCharsets.UTF_8);
                
                // 확인을 위해 내용 일부 출력 (앞 100자)
                log.info("[+] MD 파일 읽기 성공! 내용 요약: {}...", 
                    markdownContent.substring(0, Math.min(markdownContent.length(), 100)).replace("\n", " "));

                // 3. 향후 구현: MD -> Canonical JSON 변환 로직이 들어갈 자리
                // var canonicalJson = docParser.parseMarkdown(markdownContent);
                
                // 4. DB 최종 업데이트 (성공 처리)
                // docMapper.updateFinalResult(docUuid, canonicalJson, "SUCCESS");
                
                log.info("[+] 최종 정규화 완료 및 DB 반영 대기 중: {}", docUuid);
            } else {
                log.error("[!] 파일이 공유 볼륨에 존재하지 않습니다: {}", mdPath);
            }

        } catch (IOException e) {
            log.error("[!] MD 파일 읽기 중 에러 발생: {}", mdPath, e);
        } catch (Exception e) {
            log.error("[!] 리스너 로직 처리 중 예외 발생", e);
        }
    }
}