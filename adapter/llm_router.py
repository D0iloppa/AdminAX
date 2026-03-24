import os
import httpx
import logging
from typing import Dict, Any, AsyncGenerator

logger = logging.getLogger("Adapter-LLMRouter")

class LLMRouter:
    def __init__(self):
        # httpx AsyncClient 재사용으로 커넥션 풀 성능 향상
        self.client = httpx.AsyncClient()

    async def close(self):
        await self.client.aclose()

    async def generate_response(self, instance_config: Dict[str, Any], prompt: str) -> str:
        """단건 텍스트 응답 생성"""
        if not instance_config:
            raise ValueError("Invalid instance configuration provided.")

        provider = instance_config.get("provider", {})
        model_id = instance_config.get("model_id")
        params = instance_config.get("model_parameters", {})
        timeout_ms = instance_config.get("routing_policy", {}).get("timeout_ms", 30000)
        timeout_sec = timeout_ms / 1000.0

        endpoint = provider.get("endpoint_url")
        api_key_env = provider.get("api_key_env")
        api_key = os.getenv(api_key_env, "") if api_key_env else ""

        # OpenAI Compatible REST API 기준 작성 (vLLM, 대부분의 오픈소스 서빙 엔진 호환)
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}" if api_key else ""
        }
        
        payload = {
            "model": model_id,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": params.get("temperature", 0.7),
            "stream": False
        }

        # JSON response_format
        if params.get("response_format") == "json_object":
            payload["response_format"] = { "type": "json_object" }

        logger.info(f"Routing request to {model_id} via {endpoint} (Timeout: {timeout_sec}s)")
        try:
            response = await self.client.post(
                f"{endpoint}/chat/completions",
                headers=headers,
                json=payload,
                timeout=timeout_sec
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except httpx.HTTPError as e:
            logger.error(f"HTTP Request failed for {model_id}: {e}")
            raise

    async def generate_response_stream(self, instance_config: Dict[str, Any], prompt: str) -> AsyncGenerator[str, None]:
        """향후 SSE 연동을 대비한 스트리밍 응답 제너레이터 구현"""
        provider = instance_config.get("provider", {})
        model_id = instance_config.get("model_id")
        params = instance_config.get("model_parameters", {})
        timeout_sec = instance_config.get("routing_policy", {}).get("timeout_ms", 30000) / 1000.0
        endpoint = provider.get("endpoint_url")
        api_key_env = provider.get("api_key_env")
        api_key = os.getenv(api_key_env, "") if api_key_env else ""

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}" if api_key else ""
        }
        
        payload = {
            "model": model_id,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": params.get("temperature", 0.7),
            "stream": True # 핵심: 서버 사이드 스트리밍 켜기
        }

        try:
            async with self.client.stream("POST", f"{endpoint}/chat/completions", headers=headers, json=payload, timeout=timeout_sec) as response:
                response.raise_for_status()
                async for chunk in response.aiter_text():
                    yield chunk
        except Exception as e:
            logger.error(f"Stream generation failed: {e}")
            raise

llm_router = LLMRouter()
