/** * AdminAX Receipt Engine v3.7
 * PC/Mobile 통합 이미지 수신 및 서버 실시간 분석 로직
 */

let table;
let sseSource = null;
//const sid = "AX_" + Math.random().toString(36).substr(2, 9);
const sid = "AX_1";

// 1. 프로토콜 자동 감지 및 WebSocket 연결
const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
const socketUrl = protocol + window.location.host + "/ws/receipt?sid=" + sid;
const socket = new WebSocket(socketUrl);

socket.onopen = () => console.log("✅ PC 소켓 연결 성공! SID:", sid);
socket.onclose = () => console.warn("⚠️ 소켓 연결 끊김");
socket.onerror = (err) => console.error("❌ 소켓 에러:", err);

document.addEventListener("DOMContentLoaded", () => {
    initTable();
    generateQR();
});

// 2. 모바일 페이지 접속용 QR 생성
function generateQR() {
    // 컨트롤러의 /receipt/mobile 매핑을 고려한 절대 경로 주소 [cite: 2026-02-10]
    const mobileUrl = window.location.origin + "/receipt/mobile?sid=" + sid;
    
    new QRCode(document.getElementById("qrcode"), {
        text: mobileUrl,
        width: 80, height: 80,
        colorDark: "#0d6efd"
    });
}

// 3. 모바일로부터 실시간 이미지 수신 핸들러
socket.onmessage = async (event) => {
	console.log("📩 모바일로부터 데이터 수신됨!");
	
    const res = JSON.parse(event.data);
	
	
    if (res.type === "MOBILE_UPLOAD") {
        const blob = await (await fetch(res.data)).blob();
        const file = new File([blob], res.fileName, { type: "image/jpeg" });

        table.updateOrAddData([{
            orgName: res.fileName,
            status: "pending",
            name: "모바일 수신 영수증",
            amount: 0,
            _rawFile: file
        }]);
    }
};

// 4. PC 로컬 파일 선택 핸들러 [신규 추가]
function onPCFilesSelected(event) {
    const files = Array.from(event.target.files);
    const newRows = files.map(file => ({
        orgName: file.name,
        status: "pending",
        name: "PC 파일 수신됨",
        amount: 0,
        _rawFile: file
    }));
    table.updateOrAddData(newRows);
    event.target.value = ""; 
}

// 5. 서버 분석 시작 (상대 경로 'upload' 유지)
async function startAnalysis() {
	const targetRows = table.getRows().filter(row => {
	        const s = row.getData().status;
	        return s === "pending" || s === "failed";
	    });

    if (targetRows.length === 0) return alert("분석할 새로운 영수증이 없습니다.");

    const formData = new FormData();
    targetRows.forEach(row => {
        formData.append("files", row.getData()._rawFile);
        row.update({ status: "loading", name: "분석 중..." });
    });
	
	

    try {
        const response = await fetch('upload', { method: 'POST', body: formData });
        const result = await response.json();
        connectSSE(result.batchId);
    } catch (error) {
        console.error("Upload failed:", error);
    }
}

// 6. SSE 분석 결과 업데이트 (상대 경로 'subscribe/' 유지)
function connectSSE(batchId) {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`subscribe/${batchId}`);

    sseSource.addEventListener("PROGRESS", (e) => {
        const data = JSON.parse(e.data);
        if (document.getElementById('progBar')) {
            document.getElementById('progBar').style.width = `${data.progress}%`;
        }

		if (data.parsedData && data.parsedData.orgName) {
            // 서버에서 "status": "error"를 보냈는지 확인 [cite: 2026-02-10]
            const isError = data.parsedData.status === "error";
            
            table.updateOrAddData([{
                ...data.parsedData,
                // 에러면 failed, 아니면 complete [cite: 2026-02-10]
                status: isError ? "failed" : "complete",
                // 에러 시 사용자에게 이유를 보여주기 위해 name 필드 활용
                name: isError ? `❌ 분석 실패 (${data.parsedData.remarks || 'API 제한'})` : data.parsedData.name
            }]);
        }
    });
	
	sseSource.onerror = (err) => {
        console.error("SSE Connection Error:", err);
        
        // 현재 'loading' 상태에 멈춰있는 모든 행을 찾아서 'failed'로 강제 전환 [cite: 2026-02-10]
        const loadingRows = table.getRows().filter(row => row.getData().status === "loading");
        
        loadingRows.forEach(row => {
            row.update({ 
                status: "failed", 
                name: "❌ 서버 응답 중단 (재시도 필요)" 
            });
        });

        if (document.getElementById('status-badge')) {
            document.getElementById('status-badge').textContent = "연결 오류";
            document.getElementById('status-badge').className = "badge bg-danger ms-auto";
        }
        
        sseSource.close();
    };

    sseSource.addEventListener("COMPLETE", (e) => {
        if (document.getElementById('status-badge')) {
            document.getElementById('status-badge').textContent = "분석 완료";
        }
        sseSource.close();
    });
}


// 1. 드래그 기능 구현
function makeDraggable(el, header) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    header.onmousedown = (e) => {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = () => {
            document.onmouseup = null;
            document.onmousemove = null;
        };
        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        };
    };
}

let scale = 1;
let pointX = 0;
let pointY = 0;
let start = { x: 0, y: 0 };
let isPanning = false;

function showOverlay(data) {
    const overlay = document.getElementById("imageOverlay");
    const img = document.getElementById("overlayImg");
    const dataRow = document.getElementById("overlayDataRow");
    
    // 1. 상태 및 스타일 초기화
    scale = 1; pointX = 0; pointY = 0;
    img.style.transform = `translate(0px, 0px) scale(1)`;

    // 2. 이미지 로드
    if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(data._rawFile);
    
    // 3. 하단 테이블 데이터 업데이트
    const formattedAmount = data.amount ? Number(data.amount).toLocaleString() : "0";
    dataRow.innerHTML = `
        <td>${data.date || ""}</td><td>${data.cardName || ""}</td><td>${data.cardNumber || ""}</td>
        <td>${data.carType || ""}</td><td>${data.carNumber || ""}</td>
        <td style="font-weight:bold;">${data.name || ""}</td>
        <td>${data.account || ""}</td><td>${data.usage || ""}</td>
        <td>${data.taxType || ""}</td><td style="color:#0d6efd; font-weight:bold;">${formattedAmount}</td>
        <td>${data.user || ""}</td>
    `;
    
    // 4. 표시 및 위치 설정
    overlay.style.display = "block";
    overlay.style.top = "30px";
    overlay.style.left = "calc(100% - 900px)"; 
    
    // 5. 드래그(창 이동) 및 줌/팬(이미지 조작) 초기화
    if (typeof makeDraggable === "function") {
        makeDraggable(overlay, document.getElementById("overlayHeader"));
    }
    initImageControls();
}

function initImageControls() {
    const container = document.getElementById("imgContainer");
    const img = document.getElementById("overlayImg");

    container.onwheel = (e) => {
        e.preventDefault();
        const delta = -e.deltaY;
        (delta > 0) ? (scale *= 1.15) : (scale /= 1.15);
        scale = Math.min(Math.max(0.5, scale), 5);
        img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    };

    container.onmousedown = (e) => {
        if (e.target !== img) return;
        e.preventDefault();
        start = { x: e.clientX - pointX, y: e.clientY - pointY };
        isPanning = true;
        container.style.cursor = "grabbing";
    };

    window.onmousemove = (e) => {
        if (!isPanning) return;
        pointX = e.clientX - start.x;
        pointY = e.clientY - start.y;
        img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    };

    window.onmouseup = () => {
        if (!isPanning) return;
        isPanning = false;
        container.style.cursor = "grab";
    };
}
function closeOverlay() {
    document.getElementById("imageOverlay").style.display = "none";
}

// 7. 그리드 초기화
function initTable() {
    table = new Tabulator("#receipt-table", {
        height: "calc(90vh - 350px)",
        layout: "fitColumns",
        index: "orgName",
        columns: [
			{title: "상태", field: "status", width: 80, hozAlign: "center", formatter: (cell) => {
			    const s = cell.getValue();
			    if (s === "pending") return "⏳";
			    if (s === "loading") return `<div class="spinner-border spinner-border-sm text-primary"></div>`;
			    if (s === "failed") return "❌";
			    return "✅";
			}},
            {title: "일자", field: "date", editor: "input", width: 110},
            {title: "카드명", field: "cardName", editor: "input", width: 110},
			{title: "카드번호", field: "cardNumber", editor: "input", width: 110},
			{title: "차종", field: "carType", editor: "input", width: 90},
			{title: "차량번호", field: "carNumber", editor: "input", width: 110},
            {title: "사용처", field: "name", editor: "input", minWidth: 180},
            {title: "계정", field: "account", editor: "list", width: 120, editorParams: {
                values: ["도서인쇄비", "보험료", "복리후생비", "소모품비", "여비교통비", "우편발송비", "접대비", "지급수수료", ""]
            }},
            {title: "용도", field: "usage", editor: "list", width: 120, editorParams: {
                values: ["도서인쇄비", "버스", "보험료", "복리후생비", "소모품", "식대", "우편발송비", "음료", "주유비", "주차비", "지급수수료", ""]
            }},
            {title: "부가세", field: "taxType", editor: "list", width: 120, editorParams: {values: ["공제", "불공제"]}},
			{
			    title: "합계", 
			    field: "amount", 
			    editor: "number", 
			    width: 120, 
			    bottomCalc: "sum", 
			    formatter: "money", 
			    // [수정] 소수점 제거(0) 및 콤마 설정
			    formatterParams: { thousand: ",", precision: 0 },
			    // 하단 합계 영역도 동일하게 포맷팅
			    bottomCalcFormatter: "money",
			    bottomCalcFormatterParams: { thousand: ",", precision: 0 }
			},
            {title: "사용자", field: "user", editor: "input", width: 100},
            {
                title: "보기", width: 80, hozAlign: "center", 
				formatter: () => "🔍", 
				cellClick: (e, cell) => {
                    const data = cell.getRow().getData();
                    if (data._rawFile) {
                        showOverlay(data);
                    } else {
                        alert("이미지 파일이 없습니다.");
                    }
                }
            },
            {title: "삭제", formatter: "buttonCross", width: 80, cellClick: (e, cell) => cell.getRow().delete()},
            {title: "orgName", field: "orgName", visible: false}
        ],
        rowFormatter: (row) => {
            if (!row.getElement().querySelector(".preview-container")) {
                const holder = document.createElement("div");
                holder.className = "preview-container";
                holder.innerHTML = `<img src="">`;
                row.getElement().appendChild(holder);
            }
        }
    });
}

function copyGridToClipboard() {
    const rows = table.getData().filter(row => row.status === "complete");
	
    if (rows.length === 0) return alert("복사할 데이터가 없습니다.");

    // [핵심] 데이터 정제 함수: null/undefined 처리 및 구분자 제거 [cite: 2026-02-10]
    const clean = (val) => {
        if (val === null || val === undefined) return "";
        // 데이터 내부의 탭(\t)이나 줄바꿈(\n)이 있으면 엑셀 칸이 밀리므로 공백으로 치환 [cite: 2026-02-10]
        return String(val).replace(/[\t\n\r]/g, " ").trim();
    };

    const clipboardText = rows.map(row => [
        clean(row.date),
        clean(row.cardName),
        clean(row.cardNumber),
		clean(row.carType),
        clean(row.carNumber),
        clean(row.name),
        clean(row.account),
        clean(row.usage),
        clean(row.taxType),
        row.amount || "", // 합계가 0일 때 빈칸을 원하시면 "" 사용 [cite: 2026-02-10]
        clean(row.user)
    ].join("\t")).join("\n"); // 행 사이에는 줄바꿈, 열 사이에는 정확히 탭 1개 유지 [cite: 2026-02-10]

    // 하이브리드 복사 실행 (HTTPS/HTTP 대응) [cite: 2026-02-10]
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(clipboardText).then(onCopySuccess).catch(() => copyFallback(clipboardText));
    } else {
        copyFallback(clipboardText);
    }
}

/** * 구형 브라우저 및 HTTP 환경을 위한 복사 방식 [cite: 2026-02-10]
 */
function copyFallback(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // 화면 밖으로 밀어내기
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy'); // 레거시 복사 명령 [cite: 2026-02-10]
        if (successful) onCopySuccess();
        else alert('복사 실패');
    } catch (err) {
        alert('복사 중 오류 발생');
    }

    document.body.removeChild(textArea);
}

/** 복사 성공 시 UI 피드백 [cite: 2026-02-10] */
function onCopySuccess() {
    const badge = document.getElementById('status-badge');
    const originalText = badge.textContent;
    badge.textContent = "📋 복사 완료!";
    badge.className = "badge bg-info ms-auto";
    setTimeout(() => {
        badge.textContent = originalText;
        badge.className = "badge bg-success ms-auto";
    }, 2000);
}

function submitFinalData() {
    const data = table.getData().map(({_rawFile, ...rest}) => rest);
    console.log("최종 데이터 제출:", data);
    alert(`${data.length}건의 데이터를 제출했습니다.`);
}