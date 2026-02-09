
import os
import torch
from transformers import AutoModel, AutoTokenizer

# 환경 변수에서 모델 캐시 경로 확인 (Docker에서 설정함)
cache_dir = os.environ.get("HF_HOME", "/app/model_cache")
model_name = "Qwen/Qwen3-Embedding-0.6B"

print(f"Loading model: {model_name}...")
print(f"Cache dir: {cache_dir}")

# 토크나이저 및 모델 로드
try:
    tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=cache_dir, trust_remote_code=True)
    model = AutoModel.from_pretrained(model_name, cache_dir=cache_dir, trust_remote_code=True)
    
    # 모델을 평가 모드로 설정
    model.eval()
    
    # 테스트 문장 (한국어 포함)
    sentences = ["안녕하세요, AdminAX RAG 시스템 테스트입니다.", "Hello, this is a test for Qwen embedding."]
    
    print(f"Testing with sentences: {sentences}")
    
    # 토큰화
    inputs = tokenizer(sentences, padding=True, truncation=True, return_tensors="pt")
    
    # 임베딩 생성 (No gradient needed)
    with torch.no_grad():
        outputs = model(**inputs)
        # Last token pooling (Qwen3-Embedding specific approach: use last hidden state)
        # Or typical mean pooling. Let's check Qwen3 docs.
        # Qwen3-Embedding typically uses the last token embedding or specific pooling.
        # For simplicity in this test, we just check if it runs.
        embeddings = outputs.last_hidden_state[:, 0] # Using CLS token or first token as placeholder if specific polling unknown
        # Actually Qwen usually uses last token for decoder models, but let's just print shape to confirm it works.
        
    print("Success! Embeddings generated.")
    print(f"Embedding shape: {embeddings.shape}")
    print("First 5 values of first sentence:", embeddings[0][:5])
    
except Exception as e:
    print(f"Error loading or running model: {e}")
    exit(1)
