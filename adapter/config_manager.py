import os
import json
import logging
import asyncpg
from typing import Dict, Any

logger = logging.getLogger("Adapter-ConfigManager")

class ConfigManager:
    def __init__(self):
        self.config: Dict[str, Any] = {}
        # DB 연결 정보는 기존 docker-compose.yml의 adminax-db 환경변수를 참조합니다.
        self.db_dsn = os.getenv(
            "DATABASE_URL", 
            "postgresql://wellconn:dbdnpfzjs1!@adminax-db:5432/adminax"
        )
        self.config_key = "adapter_config"

    async def load_config(self):
        """DB에서 adapter_config를 비동기로 조회하여 파싱합니다."""
        logger.info(f"Loading configuration from DB for key: {self.config_key}")
        try:
            conn = await asyncpg.connect(self.db_dsn)
            row = await conn.fetchrow(
                "SELECT config_value FROM dev_config WHERE config_key = $1", 
                self.config_key
            )
            await conn.close()

            if row and row['config_value']:
                # config_value가 문자열인 경우와 JSONB(Dict)인 경우 처리
                val = row['config_value']
                if isinstance(val, str):
                    self.config = json.loads(val)
                else:
                    self.config = val
                logger.info(f"Configuration loaded successfully. Version: {self.config.get('adapter_config', {}).get('version', 'unknown')}")
            else:
                logger.warning(f"Configuration key '{self.config_key}' not found in DB.")
        except Exception as e:
            logger.error(f"Failed to load configuration from DB: {e}")

    def get_instance_config(self, instance_name: str) -> Dict[str, Any]:
        """특정 모델 인스턴스의 설정값 조회 (예: 'norm', 'infer')"""
        if not self.config:
            logger.error("Config not loaded.")
            return {}
        return self.config.get("adapter_config", {}).get("instances", {}).get(instance_name, {})

# 전역 싱글톤 인스턴스
config_manager = ConfigManager()
