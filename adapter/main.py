import asyncio
import logging
import copy
from typing import Optional, Any, Dict
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from config_manager import config_manager
from llm_router import llm_router
from redis_consumer import start_chat_consumer

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("AdminAX-Adapter")

app = FastAPI(
    title="AdminAX AI Gateway",
    description="Multi-LLM Adapter for Local & Cloud Models",
    version="1.0.0"
)

consumer_task = None

# --- Request Schema ---

class GenerateRequest(BaseModel):
    """
    단건 생성을 위한 요청 스키마
    기본적으로 instance_name을 통해 DB 설정을 로드하며,
    필요 시 필드들을 명시하여 DB 설정을 오버라이딩합니다.
    """
    prompt: str
    instance_name: str = Field(default="infer", description="DB config_key 내의 인스턴스 식별자 (norm, infer, classify 등)")
    
    # 오버라이딩을 위한 선택적 필드들
    model_id: Optional[str] = None
    endpoint_url: Optional[str] = None
    temperature: Optional[float] = None
    timeout_ms: Optional[int] = None
    response_format: Optional[str] = None

# --- Lifecycle Events ---

@app.on_event("startup")
async def startup_event():
    logger.info("Starting up AdminAX Adapter Layer...")
    
    # 1. DB에서 'adapter_config' 키를 가진 설정을 로딩 (instances 포함)
    await config_manager.load_config()
    
    # 2. Redis 컨슈머 시작
    global consumer_task
    consumer_task = asyncio.create_task(start_chat_consumer())
    logger.info("Background Redis consumer started.")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down AdminAX Adapter Layer...")
    await llm_router.close()
    if consumer_task:
        consumer_task.cancel()

# --- API Endpoints ---

@app.get("/health")
async def health_check():
    return {
        "status": "up",
        "instances_loaded": list(config_manager.config.get("instances", {}).keys()) if config_manager.config else []
    }

@app.post("/reload-config")
async def reload_config():
    """DB에서 최신 adapter_config를 다시 읽어옵니다."""
    await config_manager.load_config()
    return {
        "message": "Configuration reloaded",
        "active_instances": list(config_manager.config.get("instances", {}).keys())
    }

@app.post("/generate")
async def generate_text(request: GenerateRequest):
    """
    LLM 추론 엔드포인트
    DB의 인스턴스 설정을 기반으로 하며, 요청 파라미터가 있을 경우 이를 최우선으로 적용합니다.
    """
    # 1. DB의 'instances' 블록에서 해당 이름의 설정을 가져옴
    all_instances = config_manager.config.get("instances", {})
    base_config = all_instances.get(request.instance_name)
    
    if not base_config:
        raise HTTPException(
            status_code=404, 
            detail=f"Instance '{request.instance_name}' not found in DB config."
        )
    
    # 2. 기본 설정을 복사하여 오버라이딩 준비 (Deep Copy)
    # DB 데이터를 직접 수정하지 않기 위함
    final_config = copy.deepcopy(base_config)
    
    # 3. 파라미터 오버라이딩 (Override Logic)
    if request.model_id:
        final_config["model_id"] = request.model_id
        
    if request.endpoint_url:
        # provider -> endpoint_url 구조 반영
        if "provider" not in final_config:
            final_config["provider"] = {}
        final_config["provider"]["endpoint_url"] = request.endpoint_url
        
    if request.temperature is not None:
        # model_parameters -> temperature 구조 반영
        if "model_parameters" not in final_config:
            final_config["model_parameters"] = {}
        final_config["model_parameters"]["temperature"] = request.temperature
        
    if request.timeout_ms:
        # routing_policy -> timeout_ms 구조 반영
        if "routing_policy" not in final_config:
            final_config["routing_policy"] = {}
        final_config["routing_policy"]["timeout_ms"] = request.timeout_ms

    if request.response_format:
        if "model_parameters" not in final_config:
            final_config["model_parameters"] = {}
        final_config["model_parameters"]["response_format"] = request.response_format

    # 4. 최종 결정된 Config로 라우터를 통해 추론 수행
    try:
        logger.info(f"Dispatching request to [{request.instance_name}] with model [{final_config.get('model_id')}]")
        answer = await llm_router.generate_response(final_config, request.prompt)
        return {
            "instance_used": request.instance_name,
            "model_id": final_config.get("model_id"),
            "answer": answer
        }
    except Exception as e:
        logger.error(f"Inference failed for {request.instance_name}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"LLM Inference Error: {str(e)}")

# --- Debug Endpoint ---

@app.get("/debug/config")
async def view_current_config():
    """현재 메모리에 로드된 전체 DB 설정을 보여줍니다."""
    return config_manager.config