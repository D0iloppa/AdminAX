import asyncio
import asyncpg
import json
import os

async def main():
    dsn = os.getenv("DATABASE_URL", "postgresql://wellconn:dbdnpfzjs1!@localhost:5432/adminax")
    try:
        conn = await asyncpg.connect(dsn)
        
        # 테이블 생성
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS dev_config (
                id SERIAL PRIMARY KEY,
                config_key VARCHAR(255) UNIQUE NOT NULL,
                config_value JSONB NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # 초기 데이터
        adapter_config = {
            "version": "2.5",
            "template": {
                "metadata": {"tier": "string", "context_window": "number", "parameter_size": "string"},
                "model_id": "string",
                "provider": {"type": "string", "protocol": "string", "api_key_env": "string", "endpoint_url": "string"},
                "display_name": "string",
                "routing_policy": {"priority": "number", "timeout_ms": "number"},
                "model_parameters": {"temperature": "number", "response_format": "string"}
            },
            "instances": {
                "norm": {
                    "metadata": {"tier": "FLASH", "context_window": 32768, "parameter_size": "7B"},
                    "model_id": "qwen-2.5-7b-norm",
                    "provider": {"type": "LOCAL_VLLM", "protocol": "gRPC", "api_key_env": "LOCAL_MODEL_SECRET", "endpoint_url": "http://10.0.5.11:8000/v1"},
                    "display_name": "AdminAX Normalizer (Local)",
                    "routing_policy": {"priority": 1, "timeout_ms": 10000},
                    "model_parameters": {"temperature": 0.0, "response_format": "json_object"}
                },
                "infer": {
                    "metadata": {"tier": "LOCAL", "context_window": 8192, "parameter_size": "7B"},
                    "model_id": "qwen2.5:7b",
                    "provider": {"type": "LOCAL_OLLAMA", "protocol": "REST", "api_key_env": "", "endpoint_url": "http://adminax-ollama:11434/api"},
                    "display_name": "AdminAX Deep Reasoner (Local Ollama)",
                    "routing_policy": {"priority": 2, "timeout_ms": 60000},
                    "model_parameters": {"temperature": 0.7, "response_format": "text"}
                },
                "classify": {
                    "metadata": {"tier": "FLASH", "context_window": 8192, "parameter_size": "3B"},
                    "model_id": "llama-3.2-3b-fast",
                    "provider": {"type": "LOCAL_VLLM", "protocol": "REST", "api_key_env": "LOCAL_MODEL_SECRET", "endpoint_url": "http://10.0.5.12:8000/v1"},
                    "display_name": "Intent Classifier",
                    "routing_policy": {"priority": 1, "timeout_ms": 5000},
                    "model_parameters": {"temperature": 0.1, "response_format": "text"}
                }
            },
            "last_updated": "2026-03-16T13:00:00Z"
        }
        
        await conn.execute("""
            INSERT INTO dev_config (config_key, config_value, description)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (config_key) DO UPDATE 
            SET config_value = EXCLUDED.config_value, updated_at = CURRENT_TIMESTAMP
        """, "adapter_config", json.dumps(adapter_config), "AI Gateway Adapter Routing Configuration")
        
        print("Config successfully inserted into DB.")
        await conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
