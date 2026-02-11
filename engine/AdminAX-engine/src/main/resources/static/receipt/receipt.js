/** * AdminAX Receipt Engine v4.6 (Senior Level - Final)
 * [설계 원칙: 인프라 정합성 + 쫀득한 이미지 핸들링 UX] [cite: 2026-02-11]
 */

let table;
let sseSource = null;

//const sid = "AX_" + Math.random().toString(36).substr(2, 9);
const sid = "AX_1";

// 1. WebSocket: 인프라 컨텍스트(/api)를 자동 추적하는 상대 경로 주소 [cite: 2026-02-11]
const socketUrl = new URL('../ws/receipt?sid=' + sid, window.location.href).href.replace(/^http/, 'ws');
const socket = new WebSocket(socketUrl);

document.addEventListener("DOMContentLoaded", () => {
    initTable();
    generateQR();
	loadUserPromptFromDB();
});

// 2. QR 생성: 현재 접속한 폴더 경로에 'mobile' 페이지 매핑 [cite: 2026-02-11]
function generateQR() {
    const mobileUrl = new URL('mobile?sid=' + sid, window.location.href).href;
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, { text: mobileUrl, width: 80, height: 80, colorDark: "#0d6efd" });
}

socket.onopen = () => console.log(`%c[Socket Open] SID: ${sid}`, "color: #0d6efd; font-weight: bold;");

// 3. 소켓 메시지 통합 수신 로직 [cite: 2026-02-11]
socket.onmessage = async (event) => {
    console.log("%c[Socket Received]", "color: #198754; font-weight: bold;", event.data);
    try {
        const res = JSON.parse(event.data);
        switch (res.type) {
            case "SYSTEM":
                if (res.message === "NEW_CLIENT_JOINED") {
                    console.log("%c[Notice] 📱 새 기기 연결됨", "color: #fd7e14; font-weight: bold;");
                    const b = document.getElementById('status-badge'); b.textContent = "📱 MOBILE CONNECTED";
                }
                break;
            case "MOBILE_UPLOAD":
                handleImageUpload(res);
                break;
        }
    } catch (err) { console.error("❌ 파싱 실패:", err); }
};

async function handleImageUpload(res) {
    console.log("📸 이미지 수신:", res.fileName);
    const blob = await (await fetch(res.data)).blob();
    table.updateOrAddData([{
        orgName: res.fileName, status: "pending", name: "모바일 수신 영수증",
        amount: 0, _rawFile: new File([blob], res.fileName, { type: "image/jpeg" })
    }]);
}

// 4. 오버레이 조작 (줌/팬 - '쫀득한' 버전) [cite: 2026-02-11]
// 8. 오버레이 조작 (줌/팬 & 모달 이동) [cite: 2026-02-11]
let scale = 1, pointX = 0, pointY = 0, start = { x: 0, y: 0 }, isPanning = false;

function showOverlay(data) {
    const overlay = document.getElementById("imageOverlay");
    const img = document.getElementById("overlayImg");
    
    // 초기화: 창 위치는 CSS 기본값(또는 마지막 위치) 유지, 이미지는 중앙 정렬 [cite: 2026-02-11]
    scale = 1; pointX = 0; pointY = 0;
    updateTransform();
    
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(data._rawFile);
    
    document.getElementById("overlayDataRow").innerHTML = `
        <td>${data.date || ""}</td><td>${data.cardName || ""}</td><td>${data.cardNumber || ""}</td>
        <td>${data.carType || ""}</td><td>${data.carNumber || ""}</td><td>${data.name || ""}</td>
        <td>${data.account || ""}</td><td>${data.usage || ""}</td><td>${data.taxType || ""}</td>
        <td style="color:#0d6efd; font-weight:bold;">${Number(data.amount||0).toLocaleString()}</td><td>${data.user || ""}</td>
    `;
    overlay.style.display = "block";
    
    initImageControls();
    makeModalDraggable(overlay); // [추가] 오버레이 창 자체를 드래그 가능하게 만듦 [cite: 2026-02-11]
}

function initImageControls() {
    const container = document.getElementById("imgContainer");
    const img = document.getElementById("overlayImg");

    img.ondragstart = () => false; // 브라우저 기본 이미지 드래그 차단 [cite: 2026-02-11]

    // [해결] Passive 경고 해결을 위한 addEventListener 사용 [cite: 2026-02-11]
    container.removeEventListener('wheel', handleWheel); // 중복 등록 방지
    container.addEventListener('wheel', handleWheel, { passive: false });

    container.onmousedown = (e) => {
        e.preventDefault();
        start = { x: e.clientX - pointX, y: e.clientY - pointY };
        isPanning = true;
        img.style.cursor = "grabbing";
    };

    window.onmousemove = (e) => {
        if (!isPanning) return;
        pointX = e.clientX - start.x;
        pointY = e.clientY - start.y;
        updateTransform();
    };

    window.onmouseup = () => { isPanning = false; img.style.cursor = "grab"; };
}

function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    scale = Math.min(Math.max(0.5, scale + delta), 5);
    updateTransform();
}

function updateTransform() {
    const img = document.getElementById("overlayImg");
    // 공식: $$ \text{transform} = \text{translate}(pointX, pointY) \times \text{scale}(scale) $$ [cite: 2026-02-11]
    img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
}

// [핵심] 오버레이 창 자체를 드래그하는 로직 [cite: 2026-02-11]
function makeModalDraggable(elm) {
    const header = elm.querySelector(".card-header") || elm; // 헤더가 있으면 헤더로, 없으면 전체로 드래그
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    header.onmousedown = (e) => {
        if (e.target.closest('#imgContainer')) return; // 이미지 조작 영역이면 무시
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            elm.style.top = (elm.offsetTop - pos2) + "px";
            elm.style.left = (elm.offsetLeft - pos1) + "px";
            elm.style.bottom = "auto"; // 하단 고정 해제 [cite: 2026-02-11]
        };
    };
}

function updateTransform() {
    const img = document.getElementById("overlayImg");
    // [수정] translate와 scale을 동시에 적용해야 좌표가 깨지지 않음 [cite: 2026-02-11]
    img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
}

// 5. 기타 유틸리티 (분석 시작, 클립보드 등)
async function startAnalysis() {
    const targetRows = table.getRows().filter(row => ["pending", "failed"].includes(row.getData().status));
    if (targetRows.length === 0) return alert("분석할 항목이 없습니다.");
    const formData = new FormData();
    targetRows.forEach(row => {
        formData.append("files", row.getData()._rawFile);
        row.update({ status: "loading", name: "분석 중..." });
    });
    try {
        const response = await fetch('upload', { method: 'POST', body: formData });
        const result = await response.json();
        connectSSE(result.batchId);
    } catch (e) { console.error("Upload Error:", e); }
}

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
            {title: "계정", field: "account", editor: "list", width: 120, editorParams: { values: ["도서인쇄비", "보험료", "복리후생비", "소모품비", "여비교통비", "우편발송비", "접대비", "지급수수료", ""] }},
            {title: "용도", field: "usage", editor: "list", width: 120, editorParams: { values: ["도서인쇄비", "버스", "보험료", "복리후생비", "소모품", "식대", "우편발송비", "음료", "주유비", "주차비", "지급수수료", ""] }},
            {title: "부가세", field: "taxType", editor: "list", width: 100, editorParams: { values: ["공제", "불공제"] }},
            {title: "합계", field: "amount", editor: "number", width: 110, bottomCalc: "sum", formatter: "money", formatterParams: { thousand: ",", precision: 0 }},
            {title: "사용자", field: "user", editor: "input", width: 100},
            {title: "보기", width: 60, hozAlign: "center", formatter: () => "🔍", cellClick: (e, cell) => showOverlay(cell.getRow().getData())},
            {title: "삭제", formatter: "buttonCross", width: 60, cellClick: (e, cell) => cell.getRow().delete()}
        ]
    });
}

function closeOverlay() { document.getElementById("imageOverlay").style.display = "none"; }
function onPCFilesSelected(e) { table.updateOrAddData(Array.from(e.target.files).map(f => ({ orgName: f.name, status: "pending", name: "PC 파일", amount: 0, _rawFile: f }))); e.target.value = ""; }



// [GET] DB에서 로드할 때 [cite: 2026-02-11]
async function loadUserPromptFromDB() {
    try {
        const res = await fetch('get-user-prompt'); 
        const data = await res.json();
        // 도일님의 의도대로 user_prompt 키를 참조합니다. [cite: 2026-02-11]
        document.getElementById('userPromptArea').value = data.user_prompt || "";
    } catch (e) { console.warn("로드 실패"); }
}

// [POST] DB에 저장할 때 [cite: 2026-02-11]
async function saveUserPrompt() {
    const newVal = document.getElementById('userPromptArea').value;
    try {
        await fetch('save-user-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // value 대신 user_prompt로 전송 [cite: 2026-02-11]
            body: JSON.stringify({ user_prompt: newVal }) 
        });
        alert("저장 완료");
    } catch (e) { alert("저장 실패"); }
}


function openSettingsModal() {
    new bootstrap.Modal(document.getElementById('settingsModal')).show();
}