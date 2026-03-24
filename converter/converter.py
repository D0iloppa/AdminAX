"""
converter.py — AdminAX 순수 변환 엔진

책임: 파일을 받아 Canonical JSON을 생성하는 것까지 담당.
     Redis / 외부 상태 관리 없이 독립적으로 실행 가능.

공개 인터페이스:
    convert(file_path, doc_uuid, adapter_url, prompt_file) -> dict
"""

import os
import subprocess
import shutil
import re
import json
import logging
import pdfplumber
import zipfile
import xml.etree.ElementTree as ET
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ==========================================
# 로깅 설정
# ==========================================
logger = logging.getLogger("AdminAX-Converter")

# 지원 확장자
SUPPORTED_EXTENSIONS = {'.hwp', '.hwpx', '.doc', '.docx', '.ppt', '.pptx', '.pdf'}


# ==========================================
# 공개 인터페이스
# ==========================================

def extract_text(file_path: str, doc_uuid: str, save_pages: bool = True) -> dict:
    """
    텍스트 추출 전용 단계 (AI 호출 없음). 테스트 및 단계 검증에 사용.

    Args:
        file_path  : 원본 파일 절대 경로
        doc_uuid   : 문서 ID (저장 파일명에 사용)
        save_pages : True면 {doc_uuid}.md 단일 파일에 <page id=N>...</page> 형식으로 저장

    Returns:
        {
            "success"   : bool,
            "text"      : str,   # <page> 태그 포함 전체 텍스트
            "md_path"   : str,   # 저장된 단일 MD 파일 경로
            "page_count": int,   # 총 페이지 수
            "char_count": int,
            "error"     : str
        }
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        msg = f"지원하지 않는 포맷: {ext}"
        logger.error(msg)
        return {"success": False, "text": "", "md_path": "", "page_count": 0, "char_count": 0, "error": msg}

    pdf_path = None
    pages = []  # List[str] — 페이지별 텍스트

    try:
        if ext == '.hwp':
            raw = _extract_hwp_text(file_path)
            if raw:
                pages = [raw]  # HWP는 페이지 경계 없이 전체 텍스트 한 덩어리
            else:
                logger.warning("hwp5txt 실패 → LibreOffice PDF 폴백")
                pdf_path = _convert_to_pdf(file_path)
        elif ext == '.hwpx':
            raw = _extract_hwpx_text(file_path)
            if raw:
                pages = [raw]
            else:
                logger.warning("HWPX XML 파싱 실패 → LibreOffice PDF 폴백")
                pdf_path = _convert_to_pdf(file_path)
        else:
            pdf_path = _convert_to_pdf(file_path)

        # PDF 경유 시 페이지별 리스트 취득
        if not pages and pdf_path:
            pages = _split_pdf_to_pages(pdf_path)

        if not pages:
            msg = f"텍스트 추출 실패: {file_path}"
            logger.error(msg)
            return {"success": False, "text": "", "md_path": "", "page_count": 0, "char_count": 0, "error": msg}

        # <page id=N>...</page> 형식으로 단일 MD 구성
        tagged_blocks = []
        for i, page_text in enumerate(pages, start=1):
            tagged_blocks.append(f"<page id={i}>\n{page_text.strip()}\n</page>")
        full_md = "\n\n".join(tagged_blocks)

        md_path = ""
        if save_pages:
            out_dir = os.path.dirname(file_path)
            md_path = os.path.join(out_dir, f"{doc_uuid}.md")
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(full_md)
            logger.info(f"MD 저장 완료 ({len(pages)}페이지): {md_path}")

        return {
            "success"   : True,
            "text"      : full_md,
            "md_path"   : md_path,
            "page_count": len(pages),
            "char_count": len(full_md),
            "error"     : ""
        }

    except Exception as e:
        msg = f"텍스트 추출 예외: {e}"
        logger.error(msg, exc_info=True)
        return {"success": False, "text": "", "md_path": "", "page_count": 0, "char_count": 0, "error": msg}

    finally:
        if pdf_path and pdf_path != file_path and os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
            except Exception:
                pass


def convert(file_path: str, doc_uuid: str, adapter_url: str, prompt_file: str) -> dict:
    """
    단일 진입점. 파일 경로를 받아 변환 결과 dict를 반환한다.

    Args:
        file_path   : 변환할 원본 파일 절대 경로
        doc_uuid    : 문서 고유 ID (결과 JSON 파일명에 사용됨)
        adapter_url : Adapter Layer HTTP 엔드포인트 (e.g. http://adminax-adapter:8000/generate)
        prompt_file : 프롬프트 템플릿 파일 절대 경로

    Returns:
        {
            "success" : bool,
            "json_path": str,   # 성공 시 저장된 JSON 절대 경로
            "error"   : str     # 실패 시 에러 메시지 (성공 시 "")
        }
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        msg = f"지원하지 않는 포맷: {ext}"
        logger.error(msg)
        return {"success": False, "json_path": "", "error": msg}

    pdf_path = None
    full_content = None

    try:
        # ── Step 1. 포맷별 텍스트 추출 ─────────────────────────────────────
        if ext == '.hwp':
            full_content = _extract_hwp_text(file_path)
            if not full_content:
                logger.warning("hwp5txt 직접 추출 실패 → LibreOffice PDF 폴백 시도")
                pdf_path = _convert_to_pdf(file_path)
        elif ext == '.hwpx':
            full_content = _extract_hwpx_text(file_path)
            if not full_content:
                logger.warning("HWPX XML 파싱 실패 → LibreOffice PDF 폴백 시도")
                pdf_path = _convert_to_pdf(file_path)
        else:
            pdf_path = _convert_to_pdf(file_path)

        # PDF 경로가 생겼다면 페이지별 분할
        if not full_content and pdf_path:
            full_content = _split_pdf_to_md_pages(pdf_path, doc_uuid)

        if not full_content:
            msg = f"텍스트 추출 실패: {file_path}"
            logger.error(msg)
            return {"success": False, "json_path": "", "error": msg}

        # ── Step 2. AI 구조화 분석 ─────────────────────────────────────────
        json_path = os.path.splitext(file_path)[0] + ".json"
        ok = _call_ai(full_content, json_path, doc_uuid, adapter_url, prompt_file)
        if not ok:
            msg = "AI 구조화 분석 실패"
            logger.error(msg)
            return {"success": False, "json_path": "", "error": msg}

        logger.info(f"변환 완료: {json_path}")
        return {"success": True, "json_path": json_path, "error": ""}

    except Exception as e:
        msg = f"변환 파이프라인 예외: {e}"
        logger.error(msg, exc_info=True)
        return {"success": False, "json_path": "", "error": msg}

    finally:
        # 임시 PDF 정리 (원본이 PDF가 아닌 경우만)
        if pdf_path and pdf_path != file_path and os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
                logger.debug(f"임시 PDF 삭제: {pdf_path}")
            except Exception as e:
                logger.warning(f"임시 PDF 삭제 실패: {e}")

        # 페이지별 MD 폴더 정리
        page_dir = os.path.join(os.path.dirname(file_path), f"{doc_uuid}_pages")
        if os.path.exists(page_dir):
            try:
                shutil.rmtree(page_dir)
                logger.debug(f"임시 페이지 폴더 삭제: {page_dir}")
            except Exception as e:
                logger.warning(f"임시 페이지 폴더 삭제 실패: {e}")


# ==========================================
# 내부 함수 — 텍스트 추출
# ==========================================

def _convert_to_pdf(input_path: str) -> str | None:
    """LibreOffice로 문서를 PDF로 변환. 실패 시 None 반환."""
    ext = os.path.splitext(input_path)[1].lower()
    if ext == '.pdf':
        return input_path

    output_dir = os.path.dirname(input_path)
    command = [
        "libreoffice", "--headless", "--convert-to", "pdf",
        input_path, "--outdir", output_dir
    ]
    logger.info(f"LibreOffice 변환 중 ({ext} → PDF): {input_path}")
    try:
        result = subprocess.run(command, check=False, capture_output=True, timeout=180, text=True)
        if result.returncode != 0:
            logger.error(f"LibreOffice 오류 (code={result.returncode}): {result.stderr}")
            return None
        pdf_path = os.path.splitext(input_path)[0] + ".pdf"
        if os.path.exists(pdf_path):
            return pdf_path
        logger.error(f"LibreOffice 종료는 정상이나 PDF 미생성. stdout={result.stdout}, stderr={result.stderr}")
        return None
    except Exception as e:
        logger.error(f"LibreOffice 실행 예외: {e}", exc_info=True)
        return None


def _split_pdf_to_pages(pdf_path: str) -> list[str]:
    """PDF를 페이지 단위 텍스트 리스트로 반환. 파일 저장 없이 순수 추출."""
    pages = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                pages.append(page.extract_text() or "")
        return pages if any(p.strip() for p in pages) else []
    except Exception as e:
        logger.error(f"PDF 페이지 분할 실패: {e}", exc_info=True)
        return []


# 하위 호환용 래퍼 (convert() 내부에서 사용)
def _split_pdf_to_md_pages(pdf_path: str, doc_uuid: str) -> str | None:
    """PDF 페이지 텍스트를 합쳐 단일 문자열로 반환 (convert() 파이프라인용)."""
    pages = _split_pdf_to_pages(pdf_path)
    if not pages:
        return None
    return "\n\n".join(pages)


def _extract_hwp_text(hwp_path: str) -> str | None:
    """pyhwp (hwp5txt CLI)로 HWP 파일에서 텍스트 직접 추출."""
    logger.info(f"HWP 직접 추출 (pyhwp): {hwp_path}")
    try:
        result = subprocess.run(
            ["hwp5txt", hwp_path],
            check=False, capture_output=True, timeout=120, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        logger.error(f"hwp5txt 실패 (code={result.returncode}): {result.stderr}")
        return None
    except Exception as e:
        logger.error(f"HWP 추출 예외: {e}", exc_info=True)
        return None


def _extract_hwpx_text(hwpx_path: str) -> str | None:
    """HWPX(ZIP+XML) 파일에서 텍스트 직접 추출."""
    logger.info(f"HWPX 직접 추출 (zipfile+XML): {hwpx_path}")
    try:
        text_parts = []
        with zipfile.ZipFile(hwpx_path, 'r') as zf:
            for item in zf.namelist():
                if item.startswith("Contents/section") and item.endswith(".xml"):
                    root = ET.fromstring(zf.read(item))
                    for elem in root.iter():
                        tag = elem.tag
                        if tag.endswith('}t') or tag == 't':
                            if elem.text:
                                text_parts.append(elem.text)
                        elif tag.endswith('}p') or tag == 'p':
                            text_parts.append('\n')
        val = "".join(text_parts).strip()
        return val if val else None
    except Exception as e:
        logger.error(f"HWPX 추출 예외: {e}", exc_info=True)
        return None


# ==========================================
# 내부 함수 — AI 구조화 분석
# ==========================================

def _load_prompt_templates(prompt_file: str) -> tuple[str | None, str | None]:
    """프롬프트 템플릿 파일을 로드하여 (초기, 연속) 템플릿 튜플 반환."""
    try:
        if os.path.exists(prompt_file):
            with open(prompt_file, 'r', encoding='utf-8') as f:
                parts = f.read().split("---")
                templates = [p.strip() for p in parts]
                return (templates[0] if len(templates) > 0 else None,
                        templates[1] if len(templates) > 1 else None)
    except Exception as e:
        logger.error(f"프롬프트 파일 로드 오류: {e}")
    return None, None


def _repair_json(json_str: str) -> dict | None:
    """AI 응답에서 불완전한 JSON을 복구 시도."""
    json_str = json_str.strip()
    if not json_str.startswith('{'):
        return None
    braces = json_str.count('{') - json_str.count('}')
    brackets = json_str.count('[') - json_str.count(']')
    repaired = json_str + (']' * brackets) + ('}' * braces)
    try:
        return json.loads(repaired)
    except Exception:
        return None


def _call_ai(full_content: str, json_path: str, doc_uuid: str,
             adapter_url: str, prompt_file: str) -> bool:
    """
    Adapter Layer를 호출하여 AI 구조화 분석을 수행하고 결과를 json_path에 저장.
    성공 시 True, 실패 시 False 반환.
    """
    try:
        ai_input = re.sub(r'\s+', ' ', full_content).strip()
        init_tpl, cont_tpl = _load_prompt_templates(prompt_file)
        if not init_tpl:
            logger.error("프롬프트 템플릿 없음 — AI 분석 건너뜀")
            return False

        # Retry 세션 설정
        session = requests.Session()
        retries = Retry(total=3, backoff_factor=2, status_forcelist=[500, 502, 503, 504])
        session.mount('http://', HTTPAdapter(max_retries=retries))
        session.mount('https://', HTTPAdapter(max_retries=retries))

        all_headings = []
        doc_info = {"title": "Unknown Document", "summary": "", "doc_type": "기타"}
        current_offset = 0
        last_title = "시작"

        for turn in range(5):  # 최대 5 청크
            chunk = ai_input[current_offset:current_offset + 3000]
            if len(chunk) < 50:
                break

            is_initial = (turn == 0)
            template = init_tpl if is_initial else (cont_tpl or init_tpl)
            prompt = template.replace("{text}", chunk)
            if not is_initial:
                prompt = prompt.replace("{last_heading}", last_title)

            try:
                res = session.post(
                    adapter_url,
                    json={"prompt": prompt, "instance_name": "infer"},
                    timeout=120
                )
                res.raise_for_status()
                response = res.json().get("answer", "")

                json_str = response.split("assistant")[-1].strip() if "assistant" in response else response.strip()
                json_str = re.sub(r'```json|```', '', json_str).strip()
                ai_data = _repair_json(json_str)

                if ai_data:
                    if is_initial:
                        doc_info["title"] = ai_data.get("title", doc_info["title"])
                        doc_info["summary"] = ai_data.get("summary", "")
                    headings = ai_data.get('canonical_data', {}).get('heading_tree', [])
                    if headings:
                        all_headings.extend(headings)
                        last_title = all_headings[-1].get('title', last_title)

                current_offset += 2500

            except Exception as e:
                logger.error(f"AI 호출 실패 (turn={turn}): {e}", exc_info=True)
                return False

        final_json = {
            "docId": doc_uuid,
            "title": doc_info["title"],
            "summary": doc_info["summary"],
            "full_content": full_content,
            "canonical_data": {"heading_tree": all_headings}
        }
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(final_json, f, indent=4, ensure_ascii=False)
        return True

    except Exception as e:
        logger.error(f"AI 분석 중 예외: {e}", exc_info=True)
        return False
