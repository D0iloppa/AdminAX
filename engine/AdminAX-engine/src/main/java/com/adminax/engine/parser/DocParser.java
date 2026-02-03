/**
 * 
 */
package com.adminax.engine.parser;

import java.io.File;

import lombok.extern.slf4j.Slf4j;

import org.apache.tika.Tika;
import org.springframework.stereotype.Component;

import com.adminax.engine.context.NormCtxt;

import kr.dogfoot.hwplib.object.HWPFile;
import kr.dogfoot.hwplib.reader.HWPReader;
import kr.dogfoot.hwplib.tool.textextractor.TextExtractMethod;
import kr.dogfoot.hwplib.tool.textextractor.TextExtractor;
import kr.dogfoot.hwplib.object.HWPFile;
import kr.dogfoot.hwplib.object.bodytext.Section;
import kr.dogfoot.hwplib.object.bodytext.paragraph.Paragraph;
import kr.dogfoot.hwplib.reader.HWPReader;

/**
 * 
 */
@Component
@Slf4j
public class DocParser {
	
	public NormCtxt parse(File file) {
		
		String fileName = file.getName();
        String ext = extractExtension(fileName);
		
		log.info("[DOCPARSER] 파일명: {}, 확장자: {}", fileName, ext);
		
		return switch (ext) {
	        case "hwp" -> parseHwp(file);
	        case "hwpx" -> parseHwpx(file);
	        case "pdf" -> parsePdf(file); // 확장성 고려
	        default -> {
	            log.warn("지원하지 않는 확장자입니다: {}", ext);
	            yield createErrorContext(fileName, "Unsupported Extension");
	        }
	    };
    }
	

	private String extractExtension(String fileName) {
        int lastIndex = fileName.lastIndexOf(".");
        return (lastIndex == -1) ? "" : fileName.substring(lastIndex + 1).toLowerCase();
    }
	
	

	private NormCtxt parseHwp(File file) {

		NormCtxt ctxt = new NormCtxt();
	    ctxt.setName(file.getName());
	    
	    try {
	        Tika tika = new Tika();
	        String content = tika.parseToString(file);
	        
	        
	        ctxt.setContent(content);
	        ctxt.setStatus("SUCCESS (Tika)");
	        log.info("Tika를 통해 HWP 텍스트 추출 성공");
	    } catch (Exception e) {
	        log.error("Tika 파싱 실패: {}", e.getMessage());
	        ctxt.setStatus("FAIL");
	    }
	    return ctxt;
	}
    
    
    
    

    private NormCtxt parseHwpx(File file) {
        log.info(">>> HWPX 전용 정규화 엔진 가동 (XML 기반)");
        // HWPX는 ZIP 압축 내 XML 구조이므로 별도 로직 필요 [cite: 2026-02-03]
        return new NormCtxt();
    }

    private NormCtxt parsePdf(File file) {
        return new NormCtxt();
    }

    private NormCtxt createErrorContext(String name, String msg) {
        NormCtxt ctxt = new NormCtxt();
        ctxt.setName(name);
        ctxt.setStatus("FAIL: " + msg);
        return ctxt;
    }

}
