/**
 * AdminAX Receipt Normalization Script
 * 작성자: kdi39 (도일)
 */

let eventSource = null;

async function uploadFiles() {
    const fileInput = document.getElementById('fileInput');
    const output = document.getElementById('output');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressBar = document.getElementById('progressBar');
    const progressWrapper = document.getElementById('progressWrapper');
    const statusBadge = document.getElementById('statusBadge');

    if (fileInput.files.length === 0) {
        alert("업로드할 파일을 선택해주세요.");
        return;
    }

    // UI 초기화
    output.textContent = "[*] 업로드를 준비 중입니다...\n";
    uploadBtn.disabled = true;
    progressWrapper.style.display = 'flex';
    progressBar.style.width = '0%';
    statusBadge.className = "badge bg-warning text-dark";
    statusBadge.textContent = "업로드 중";

    const formData = new FormData();
    for (const file of fileInput.files) {
        formData.append("files", file);
    }

    try {
        // 1. 파일 업로드 API 호출
        const response = await fetch('/receipt/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error("업로드 실패");

        const result = await response.json();
        const batchId = result.batchId;
        
        appendLog(`[+] 업로드 성공! Batch ID: ${batchId}`);
        appendLog(`[+] 실시간 분석 채널(SSE) 연결을 시도합니다...`);

        // 2. SSE 구독 시작
        connectSSE(batchId);

    } catch (error) {
        appendLog(`[!] 에러 발생: ${error.message}`);
        uploadBtn.disabled = false;
        statusBadge.className = "badge bg-danger";
        statusBadge.textContent = "에러";
    }
}

function connectSSE(batchId) {
    const output = document.getElementById('output');
    const progressBar = document.getElementById('progressBar');
    const statusBadge = document.getElementById('statusBadge');
    const uploadBtn = document.getElementById('uploadBtn');

    // 기존 연결이 있다면 종료
    if (eventSource) eventSource.close();

    // SSE 엔드포인트 연결
    eventSource = new EventSource(`/receipt/subscribe/${batchId}`);

    // 연결 확인 이벤트
    eventSource.addEventListener("CONNECT", (e) => {
        appendLog(`[OK] 분석 엔진 연결 성공.`);
        statusBadge.textContent = "분석 중";
    });

    // 진행 상태 이벤트
    eventSource.addEventListener("PROGRESS", (e) => {
        const data = JSON.parse(e.data);
        appendLog(`[PROG] ${data.message}`);
        if (data.progress) {
            progressBar.style.width = `${data.progress}%`;
        }
    });

    // 완료 이벤트
    eventSource.addEventListener("COMPLETE", (e) => {
        const data = JSON.parse(e.data);
        appendLog(`\n========================================`);
        appendLog(`[SUCCESS] 모든 영수증 처리가 완료되었습니다.`);
        appendLog(`[FILE] 다운로드 경로: ${data.downloadUrl}`);
        appendLog(`========================================`);
        
        progressBar.style.width = `100%`;
        progressBar.classList.replace("bg-primary", "bg-success");
        statusBadge.className = "badge bg-success";
        statusBadge.textContent = "완료";
        uploadBtn.disabled = false;

        eventSource.close(); // 작업 완료 후 연결 종료
    });

    // 에러 처리
    eventSource.onerror = (e) => {
        appendLog(`[!] 서버와의 연결이 끊어졌거나 에러가 발생했습니다.`);
        eventSource.close();
        uploadBtn.disabled = false;
    };
}

function appendLog(message) {
    const output = document.getElementById('output');
    output.textContent += message + "\n";
    output.scrollTop = output.scrollHeight; // 자동 스크롤
}