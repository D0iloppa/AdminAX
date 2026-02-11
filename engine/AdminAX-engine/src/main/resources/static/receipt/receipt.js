/** * AdminAX Receipt Engine v4.0 (Infra-Aware & Full Package)
 * [프록시 대응 / 실시간 소켓 / SSE 분석 / 이미지 줌·팬 / TSV 복사]
 */

let table;
let sseSource = null;
const sid = "AX_1"; // 세션 ID

// 1. 프록시 및 경로 설정: 브라우저의 현재 경로를 기반으로 자동 계산
const currentPath = window.location.pathname;
const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));
const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
const socketUrl = `${protocol}${window.location.host}${basePath}/ws/receipt?sid=${sid}`;

// 2. 초기화: DOM 로드 완료 후 그리드와 QR 생성
document.addEventListener("DOMContentLoaded", () => {
    initTable();
    generateQR();
});

// 3. QR 생성: 모바일 접속용 URL 동적 생성
function generateQR() {
    // index.html을 제외한 현재 경로에 mobile 주소 결합
    const mobileUrl = window.location.href.replace('index.html', '') + "mobile?sid=" + sid;
    const qrContainer = document.getElementById("qrcode");
    
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
        text: mobileUrl,
        width: 80, height: 80,
        colorDark: "#0d6efd"
    });
}

// 4. WebSocket 연결 및 모바일 데이터 수신
const socket = new WebSocket(socketUrl);

socket.onopen = () => console.log("✅ PC 소켓 연결 성공! SID:", sid);
socket.onmessage = async (event) => {
    const res = JSON.parse(event.data);
    if (res.type === "MOBILE_UPLOAD") {
        console.log("📩 모바일 이미지 수신됨:", res.fileName);
        // Base64 데이터를 Blob으로 변환하여 File 객체 생성
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
socket.onclose = () => console.warn("⚠️ 소켓 연결 끊김");
socket.onerror = (err) => console.error("❌ 소켓 에러:", err);

// 5. PC 로컬 파일 선택 핸들러
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

// 6. 서버 분석 시작: 상대 경로 'upload' 활용
async function startAnalysis() {
    const targetRows = table.getRows().filter(row => {
        const s = row.getData().status;
        return s === "pending" || s === "failed";
    });

    if (targetRows.length === 0) return alert("분석할 항목이 없습니다.");

    const formData = new FormData();
    targetRows.forEach(row => {
        formData.append("files", row.getData()._rawFile);
        row.update({ status: "loading", name: "분석 중..." });
    });

    try {
        // 인프라 전역 설정 덕분에 단순 상대 경로로 호출 가능
        const response = await fetch('upload', { method: 'POST', body: formData });
        const result = await response.json();
        connectSSE(result.batchId);
    } catch (error) {
        console.error("Upload failed:", error);
        alert("업로드 중 오류가 발생했습니다.");
    }
}

// 7. SSE 분석 결과 업데이트
function connectSSE(batchId) {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`subscribe/${batchId}`);

    sseSource.addEventListener("PROGRESS", (e) => {
        const data = JSON.parse(e.data);
        if (document.getElementById('progBar')) {
            document.getElementById('progBar').style.width = `${data.progress}%`;
        }

        if (data.parsedData && data.parsedData.orgName) {
            const isError = data.parsedData.status === "error";
            table.updateOrAddData([{
                ...data.parsedData,
                status: isError ? "failed" : "complete",
                name: isError ? `❌ 분석 실패 (${data.parsedData.remarks || 'API Error'})` : data.parsedData.name
            }]);
        }
    });

    sseSource.onerror = (err) => {
        console.error("SSE Connection Error:", err);
        // 로딩 중인 행들을 실패 상태로 전환
        table.getRows().filter(row => row.getData().status === "loading").forEach(row => {
            row.update({ status: "failed", name: "❌ 서버 응답 중단 (재시도 필요)" });
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
            document.getElementById('status-badge').className = "badge bg-success ms-auto";
        }
        sseSource.close();
    });
}

// 8. 그리드 초기화 (Tabulator)
function initTable() {
    table = new Tabulator("#receipt-table", {
        height: "calc(90vh - 350px)",
        layout: "fitColumns",
        index: "orgName", // 업데이트 매칭 키
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
            {title: "카드번호", field: "cardNumber", editor: "input", width: 100},
            {title: "차종", field: "carType", editor: "input", width: 90},
            {title: "차량번호", field: "carNumber", editor: "input", width: 110},
            {title: "사용처", field: "name", editor: "input", minWidth: 180},
            {title: "계정", field: "account", editor: "list", width: 120, editorParams: {
                values: ["도서인쇄비", "보험료", "복리후생비", "소모품비", "여비교통비", "우편발송비", "접대비", "지급수수료", ""]
            }},
            {title: "용도", field: "usage", editor: "list", width: 120, editorParams: {
                values: ["도서인쇄비", "버스", "보험료", "복리후생비", "소모품", "식대", "우편발송비", "음료", "주유비", "주차비", "지급수수료", ""]
            }},
            {title: "부가세", field: "taxType", editor: "list", width: 100, editorParams: {values: ["공제", "불공제"]}},
            {
                title: "합계", 
                field: "amount", 
                editor: "number", 
                width: 110, 
                bottomCalc: "sum", 
                formatter: "money", 
                formatterParams: { thousand: ",", precision: 0 },
                bottomCalcFormatter: "money",
                bottomCalcFormatterParams: { thousand: ",", precision: 0 }
            },
            {title: "사용자", field: "user", editor: "input", width: 100},
            {
                title: "보기", width: 60, hozAlign: "center", 
                formatter: () => "🔍", cellClick: (e, cell) => {
                    const data = cell.getRow().getData();
                    if (data._rawFile) showOverlay(data);
                    else alert("원본 파일이 없습니다.");
                }
            },
            {title: "삭제", formatter: "buttonCross", width: 60, cellClick: (e, cell) => cell.getRow().delete()},
            {title: "orgName", field: "orgName", visible: false}
        ]
    });
}

// 9. 클립보드 복사 (TSV 정제)
function copyGridToClipboard() {
    const rows = table.getData().filter(row => row.status === "complete");
    if (rows.length === 0) return alert("복사할 '완료' 데이터가 없습니다.");

    const clean = (val) => (val === null || val === undefined) ? "" : String(val).replace(/[\t\n\r]/g, " ").trim();

    const clipboardText = rows.map(row => [
        clean(row.date), clean(row.cardName), clean(row.cardNumber),
        clean(row.carType), clean(row.carNumber), clean(row.name),
        clean(row.account), clean(row.usage), clean(row.taxType),
        row.amount || "", clean(row.user)
    ].join("\t")).join("\n");

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(clipboardText).then(onCopySuccess).catch(() => copyFallback(clipboardText));
    } else {
        copyFallback(clipboardText);
    }
}

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

function copyFallback(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus(); textArea.select();
    try { if (document.execCommand('copy')) onCopySuccess(); } catch (err) { alert('복사 실패'); }
    document.body.removeChild(textArea);
}

// 10. 이미지 오버레이 조작 (줌/팬/드래그)
let scale = 1, pointX = 0, pointY = 0, start = { x: 0, y: 0 }, isPanning = false;

function showOverlay(data) {
    const overlay = document.getElementById("imageOverlay");
    const img = document.getElementById("overlayImg");
    const dataRow = document.getElementById("overlayDataRow");
    
    // 상태 초기화
    scale = 1; pointX = 0; pointY = 0;
    img.style.transform = `translate(0px, 0px) scale(1)`;

    // 이미지 로드
    if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(data._rawFile);
    
    // 하단 데이터 테이블 업데이트
    const formattedAmount = data.amount ? Number(data.amount).toLocaleString() : "0";
    dataRow.innerHTML = `
        <td>${data.date || ""}</td><td>${data.cardName || ""}</td><td>${data.cardNumber || ""}</td>
        <td>${data.carType || ""}</td><td>${data.carNumber || ""}</td>
        <td style="font-weight:bold;">${data.name || ""}</td>
        <td>${data.account || ""}</td><td>${data.usage || ""}</td>
        <td>${data.taxType || ""}</td><td style="color:#0d6efd; font-weight:bold;">${formattedAmount}</td>
        <td>${data.user || ""}</td>
    `;
    
    overlay.style.display = "block";
    overlay.style.top = "30px";
    overlay.style.left = "calc(100% - 900px)"; 
    
    makeDraggable(overlay, document.getElementById("overlayHeader"));
    initImageControls();
}

function initImageControls() {
    const container = document.getElementById("imgContainer");
    const img = document.getElementById("overlayImg");

    // 휠 줌 기능
    container.onwheel = (e) => {
        e.preventDefault();
        const delta = -e.deltaY;
        (delta > 0) ? (scale *= 1.15) : (scale /= 1.15);
        scale = Math.min(Math.max(0.5, scale), 5);
        img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    };

    // 드래그 팬(Pan) 시작
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

    window.onmouseup = () => { isPanning = false; container.style.cursor = "grab"; };
}

function closeOverlay() { document.getElementById("imageOverlay").style.display = "none"; }

// 창 드래그 기능 구현
function makeDraggable(el, header) {
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    header.onmousedown = (e) => {
        e.preventDefault();
        p3 = e.clientX; p4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (e) => {
            e.preventDefault();
            p1 = p3 - e.clientX; p2 = p4 - e.clientY;
            p3 = e.clientX; p4 = e.clientY;
            el.style.top = (el.offsetTop - p2) + "px";
            el.style.left = (el.offsetLeft - p1) + "px";
        };
    };
}

// 최종 데이터 제출 로직
function submitFinalData() {
    const data = table.getData().map(({_rawFile, ...rest}) => rest);
    console.log("최종 데이터 제출:", data);
    alert(`${data.length}건의 데이터를 제출했습니다.`);
}