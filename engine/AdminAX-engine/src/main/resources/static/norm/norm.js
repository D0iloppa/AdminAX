/**
 * 파일 업로드 및 정규화 프로세스 시작
 */
async function uploadFiles() {
    const fileInput = document.getElementById('fileInput');
    const output = document.getElementById('output');
    
    if (fileInput.files.length === 0) {
        alert("파일을 최소 하나 이상 선택해주세요.");
        return;
    }

    // 전송 데이터 준비
    const formData = new FormData();
    for (let i = 0; i < fileInput.files.length; i++) {
        formData.append('files', fileInput.files[i]);
    }

    try {
        updateOutput("🚀 서버로 파일을 전송하는 중입니다...");
        
        const response = await fetch('normDocs', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            updateOutput(`[전송 완료] Task ID: ${result.task_id}\n실시간 분석을 시작합니다...`);
            
            // SSE 구독 시작
            initSseConnection(result.task_id);
        } else {
            updateOutput(`[오류] ${result.message || '요청 실패'}`);
        }
    } catch (error) {
        console.error("Upload Error:", error);
        updateOutput(`[에러] 서버와 통신할 수 없습니다.\n${error.message}`);
    }
}

/**
 * SSE 연결 및 이벤트 리스너 등록
 */
function initSseConnection(taskId) {
    const eventSource = new EventSource(`/subscribe/${taskId}`);
    
    // 1. 개별 문서 상태 업데이트 (DOC_PROGRESS)
    eventSource.addEventListener("DOC_PROGRESS", (event) => {
        const data = JSON.parse(event.data);
        // 로그 형식으로 출력
        const logMsg = `[진행] 문서: ${data.docUuid.substring(0,8)}... | 상태: ${data.status} (${data.completed}/${data.total})`;
        updateOutput(logMsg, true);
		
		const percent = Math.round((data.completed / data.total) * 100);
		const bar = document.getElementById('progressBar');
		document.getElementById('progressWrapper').style.display = 'flex';
		bar.style.width = percent + '%';
		bar.innerText = percent + '%';
		
    });

    // 2. 전체 작업 완료 (TASK_FINISHED)
    eventSource.addEventListener("TASK_FINISHED", (event) => {
        const data = JSON.parse(event.data);
        updateOutput(`\n🎉 [최종 완료] ${data.message}`);
        
        // 연결 종료
        eventSource.close();
    });

    // 3. 에러 발생 시
    eventSource.onerror = (err) => {
        if (eventSource.readyState === EventSource.CLOSED) {
            console.log("SSE Connection closed normally.");
        } else {
            updateOutput("\n[경고] 실시간 연결이 끊겼습니다. 재연결을 시도하거나 페이지를 새로고침하세요.");
            eventSource.close();
        }
    };
}

/**
 * <pre id="output"> 태그에 로그를 출력하는 유틸리티
 */
function updateOutput(message, append = false) {
    const output = document.getElementById('output');
    if (append) {
        output.innerText += "\n" + message;
        // 로그가 많아지면 자동으로 아래로 스크롤
        output.scrollTop = output.scrollHeight;
    } else {
        output.innerText = message;
    }
}