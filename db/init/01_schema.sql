-- 1. API 키 관리를 위한 개발용 테이블 생성
CREATE TABLE IF NOT EXISTS dev_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL UNIQUE,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. 초기 데이터 삽입 (중복 방지를 위해 ON CONFLICT 사용)
INSERT INTO dev_config (config_key, config_value, description)
VALUES (
    'gemini_receipt_config', 
    '{
        "api_key": "PLACEHOLDER_KEY",
        "model_name": "gemini-1.5-flash",
        "base_url": "https://generativelanguage.googleapis.com",
        "api_version": "v1beta",
        "parameters": {
            "temperature": 0.1,
            "max_output_tokens": 4096,
            "top_p": 0.95,
            "response_mime_type": "application/json"
        },
        "system_instruction": "당신은 영수증 분석 전문가입니다. 이미지에서 상호명, 사업자번호, 일시, 합계금액, 품목 리스트를 추출하여 지정된 JSON 형식으로 응답하세요. 모든 텍스트는 원문 언어를 유지하세요."
    }'::jsonb,
    'AdminAX 영수증 분석용 Gemini 1.5 Flash API 설정'
)
ON CONFLICT (config_key) 
DO UPDATE SET 
    config_value = EXCLUDED.config_value,
    description = EXCLUDED.description;

-- 3. (옵션) 문서 상태 관리를 위한 테이블 예시
CREATE TABLE IF NOT EXISTS document_logs (
    id SERIAL PRIMARY KEY,
    doc_id VARCHAR(100) NOT NULL,
    status VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);