/**
 * 다중 파일 업로드 및 정규화 요청
 */
async function uploadFiles() {
    const fileInput = document.getElementById('fileInput');
    const output = document.getElementById('output');
    
    if (fileInput.files.length === 0) {
        alert("파일을 최소 하나 이상 선택해주세요.");
        return;
    }

    // FormData 생성 [cite: 2026-02-03]
    const formData = new FormData();
    
    // 선택된 모든 파일을 'files'라는 키로 추가 (배열 구조 형성) [cite: 2026-02-03]
    for (let i = 0; i < fileInput.files.length; i++) {
        formData.append('files', fileInput.files[i]);
    }

    try {
        output.innerText = "서버 전송 중...";
        
        // API 호출 (Context Path /api 반영) [cite: 2026-02-03]
        const response = await fetch('/norm/normDocs', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            output.innerText = `[성공]\n${JSON.stringify(result, null, 2)}`;
        } else {
            output.innerText = `[오류]\n${result.message || '요청 실패'}`;
        }
    } catch (error) {
        console.error("Upload Error:", error);
        output.innerText = `[에러] 서버와 통신할 수 없습니다.\n${error.message}`;
    }
}