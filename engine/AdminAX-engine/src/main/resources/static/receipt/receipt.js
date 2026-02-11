/** * AdminAX Receipt Engine v4.5 (Senior Level - Full Package)
 * [설계 원칙: 인프라가 보장하는 계층형 상대 경로 통신] [cite: 2026-02-11]
 */

let table;
let sseSource = null;
const sid = new URLSearchParams(window.location.search).get('sid') || "AX_1";

// 1. WebSocket: URL 객체를 활용해 현재 파일 상위의 'ws/receipt'를 찾아감 [cite: 2026-02-11]
// 문자열 파싱 없이 브라우저 내장 기능으로 상대 경로를 절대 소켓 주소로 변환합니다.
const socketUrl = new URL('../ws/receipt' + window.location.search, window.location.href).href.replace(/^http/, 'ws');
const socket = new WebSocket(socketUrl);

document.addEventListener("DOMContentLoaded", () => {
    initTable();
    generateQR();
});

// 2. QR 생성: 현재 접속한 폴더 경로에 'mobile' 페이지 매핑 [cite: 2026-02-11]
function generateQR() {
    const mobileUrl = new URL('mobile?sid=' + sid, window.location.href).href;
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, { text: mobileUrl, width: 80, height: 80, colorDark: "#0d6efd" });
}

socket.onopen = (e) => {
    console.log(`%c[Socket Open] 서버와 연결되었습니다. (SID: ${sid})`, "color: #0d6efd; font-weight: bold;");
};

// 3. 소켓 메시지 수신 (모바일 수신)
socket.onmessage = async (event) => {
    console.log("%c[Socket Received]", "color: #198754; font-weight: bold;", event.data);

    try {
        const res = JSON.parse(event.data);

        switch (res.type) {
            // A. 시스템 관련 메시지 통합 처리 [cite: 2026-02-11]
            case "SYSTEM":
                handleSystemMessage(res);
                break;

            // B. 모바일 이미지 수신 처리
            case "MOBILE_UPLOAD":
                console.log("📸 이미지 수신:", res.fileName);
                handleImageUpload(res);
                break;

            default:
                console.warn("⚠️ 알 수 없는 메시지 타입:", res.type);
        }
    } catch (err) {
        console.error("❌ 파싱 실패:", err);
    }
};

// 시스템 메시지 전용 핸들러 [cite: 2026-02-11]
function handleSystemMessage(res) {
    if (res.message === "NEW_CLIENT_JOINED") {
        console.log("%c[Notice] 📱 새 기기가 연결되었습니다.", "color: #fd7e14; font-weight: bold;");
        notify("📱 새 기기가 연결되었습니다.", "success");
    } else {
        // 기타 시스템 공지 처리 (v4.6 확장 대비) [cite: 2026-02-11]
        console.info("%c[System Info]", "color: #0dcaf0;", res.message);
    }
}

// 이미지 처리 전용 핸들러 [cite: 2026-02-11]
async function handleImageUpload(res) {
    const blob = await (await fetch(res.data)).blob();
    table.updateOrAddData([{
        orgName: res.fileName, 
        status: "pending", 
        name: "모바일 수신 영수증",
        amount: 0, 
        _rawFile: new File([blob], res.fileName, { type: "image/jpeg" })
    }]);
}

socket.onclose = (event) => {
    if (event.wasClean) {
        console.warn(`%c[Socket Closed] 정상 종료 (Code: ${event.code}, Reason: ${event.reason})`, "color: #6c757d;");
    } else {
        // 서버 장애나 네트워크 단절 시
        console.error(`%c[Socket Dead] 연결이 비정상적으로 끊겼습니다.`, "color: #dc3545; font-weight: bold;");
    }
};

// 4. 에러 발생 시
socket.onerror = (error) => {
    console.error("%c[Socket Error]", "color: #dc3545; font-weight: bold;", error);
};

// 4. 서버 분석 시작: '..'을 활용해 컨텍스트 루트의 'upload' 호출 [cite: 2026-02-11]
async function startAnalysis() {
    const targetRows = table.getRows().filter(row => ["pending", "failed"].includes(row.getData().status));
    if (targetRows.length === 0) return alert("분석할 항목이 없습니다.");

    const formData = new FormData();
    targetRows.forEach(row => {
        formData.append("files", row.getData()._rawFile);
        row.update({ status: "loading", name: "분석 중..." });
    });

    try {
        // [핵심] '/api' 언급 금지. 현재 폴더(/receipt/)의 상위(/api/)에 있는 upload 호출 [cite: 2026-02-11]
        const response = await fetch('upload', { method: 'POST', body: formData });
        const result = await response.json();
        connectSSE(result.batchId);
    } catch (e) { console.error("Upload Error:", e); }
}

// 5. SSE 결과 수신: 컨텍스트 루트의 'subscribe' 활용 [cite: 2026-02-11]
function connectSSE(batchId) {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`subscribe/${batchId}`);

    sseSource.addEventListener("PROGRESS", (e) => {
        const data = JSON.parse(e.data);
        if (data.parsedData?.orgName) {
            const isError = data.parsedData.status === "error";
            table.updateOrAddData([{
                ...data.parsedData,
                status: isError ? "failed" : "complete",
                name: isError ? `❌ 실패 (${data.parsedData.remarks || 'API'})` : data.parsedData.name
            }]);
        }
    });

    sseSource.addEventListener("COMPLETE", () => {
        document.getElementById('status-badge').textContent = "분석 완료";
        document.getElementById('status-badge').className = "badge bg-success ms-auto";
        sseSource.close();
    });
}

// 6. 그리드 초기화 (Tabulator)
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
            {title: "카드번호", field: "cardNumber", editor: "input", width: 100},
            {title: "차종", field: "carType", editor: "input", width: 90},
            {title: "차량번호", field: "carNumber", editor: "input", width: 110},
            {title: "사용처", field: "name", editor: "input", minWidth: 180},
            {title: "계정", field: "account", editor: "list", width: 120, editorParams: { values: ["도서인쇄비", "복리후생비", "소모품비", "여비교통비", "접대비", ""] }},
            {title: "용도", field: "usage", editor: "list", width: 120, editorParams: { values: ["식대", "주유비", "주차비", "소모품", ""] }},
            {title: "부가세", field: "taxType", editor: "list", width: 100, editorParams: { values: ["공제", "불공제"] }},
            {title: "합계", field: "amount", editor: "number", width: 110, bottomCalc: "sum", formatter: "money", formatterParams: { thousand: ",", precision: 0 }},
            {title: "사용자", field: "user", editor: "input", width: 100},
            {title: "보기", width: 60, hozAlign: "center", formatter: () => "🔍", cellClick: (e, cell) => showOverlay(cell.getRow().getData())},
            {title: "삭제", formatter: "buttonCross", width: 60, cellClick: (e, cell) => cell.getRow().delete()}
        ]
    });
}

// 7. 클립보드 복사 (TSV) [cite: 2026-02-10]
function copyGridToClipboard() {
    const rows = table.getData().filter(row => row.status === "complete");
    if (rows.length === 0) return alert("복사할 데이터가 없습니다.");
    const clean = (val) => String(val || "").replace(/[\t\n\r]/g, " ").trim();
    const text = rows.map(r => [r.date, r.cardName, r.cardNumber, r.carType, r.carNumber, r.name, r.account, r.usage, r.taxType, r.amount, r.user].map(clean).join("\t")).join("\n");
    navigator.clipboard.writeText(text).then(() => {
        const b = document.getElementById('status-badge'); b.textContent = "📋 복사 완료!";
        setTimeout(() => { b.textContent = "SYSTEM READY"; }, 2000);
    });
}

// 8. 오버레이 조작 (줌/팬) [cite: 2026-02-10]
let scale = 1, pointX = 0, pointY = 0, start = { x: 0, y: 0 }, isPanning = false;

function showOverlay(data) {
    const img = document.getElementById("overlayImg");
    scale = 1; pointX = 0; pointY = 0;
    img.style.transform = `translate(0px, 0px) scale(1)`;
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(data._rawFile);
    
    document.getElementById("overlayDataRow").innerHTML = `
        <td>${data.date || ""}</td><td>${data.cardName || ""}</td><td>${data.cardNumber || ""}</td>
        <td>${data.carType || ""}</td><td>${data.carNumber || ""}</td><td>${data.name || ""}</td>
        <td>${data.account || ""}</td><td>${data.usage || ""}</td><td>${data.taxType || ""}</td>
        <td style="color:#0d6efd; font-weight:bold;">${Number(data.amount||0).toLocaleString()}</td><td>${data.user || ""}</td>
    `;
    document.getElementById("imageOverlay").style.display = "block";
    initImageControls();
}

function initImageControls() {
    const container = document.getElementById("imgContainer");
    const img = document.getElementById("overlayImg");
    container.onwheel = (e) => {
        e.preventDefault(); scale = Math.min(Math.max(0.5, scale + (e.deltaY < 0 ? 0.1 : -0.1)), 5);
        img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    };
    container.onmousedown = (e) => { start = { x: e.clientX - pointX, y: e.clientY - pointY }; isPanning = true; };
    window.onmousemove = (e) => { if (!isPanning) return; pointX = e.clientX - start.x; pointY = e.clientY - start.y; img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`; };
    window.onmouseup = () => isPanning = false;
}

function closeOverlay() { document.getElementById("imageOverlay").style.display = "none"; }
function onPCFilesSelected(e) { table.updateOrAddData(Array.from(e.target.files).map(f => ({ orgName: f.name, status: "pending", name: "PC 파일", amount: 0, _rawFile: f }))); e.target.value = ""; }