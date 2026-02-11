/** * AdminAX Receipt Engine v3.9 (Final Package)
 * [보안/프록시 대응/재분석/필터링복사 통합본]
 */

let table;
let sseSource = null;
const sid = "AX_1"; // 세션 ID (필요시 동적으로 변경 가능)

// 1. 프록시 서브경로 자동 감지 및 공통 경로 설정 [cite: 2026-02-11]
const currentPath = window.location.pathname;
const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));
const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
const socketUrl = `${protocol}${window.location.host}${basePath}/ws/receipt?sid=${sid}`;

// 2. 초기화 및 QR 생성
document.addEventListener("DOMContentLoaded", () => {
    initTable();
    generateQR();
});

function generateQR() {
    const currentUrl = window.location.href.split('?')[0];
    const qrBasePath = currentUrl.substring(0, currentUrl.lastIndexOf('/'));
    const mobileUrl = `${qrBasePath}/mobile?sid=${sid}`;
    
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
        text: mobileUrl,
        width: 80, height: 80,
        colorDark: "#0d6efd"
    });
}

// 3. WebSocket 연결 및 모바일 수신 핸들러
const socket = new WebSocket(socketUrl);

socket.onopen = () => console.log("✅ PC 소켓 연결 성공! SID:", sid);
socket.onmessage = async (event) => {
    const res = JSON.parse(event.data);
    if (res.type === "MOBILE_UPLOAD") {
        console.log("📩 모바일 이미지 수신됨:", res.fileName);
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

// 4. PC 로컬 파일 선택 핸들러
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

// 5. 서버 분석 시작 (대기 및 실패 항목 포함)
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
        const response = await fetch(`${basePath}/upload`, { method: 'POST', body: formData });
        const result = await response.json();
        connectSSE(result.batchId);
    } catch (error) {
        console.error("Upload failed:", error);
        alert("업로드 중 오류가 발생했습니다.");
    }
}

// 6. SSE 분석 결과 업데이트
function connectSSE(batchId) {
    if (sseSource) sseSource.close();
    sseSource = new EventSource(`${basePath}/subscribe/${batchId}`);

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
                name: isError ? `❌ 분석 실패 (${data.parsedData.remarks || 'Quota Exceeded'})` : data.parsedData.name
            }]);
        }
    });

    sseSource.onerror = (err) => {
        console.error("SSE Connection Error:", err);
        const loadingRows = table.getRows().filter(row => row.getData().status === "loading");
        loadingRows.forEach(row => {
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

// 7. 그리드 초기화 (Tabulator)
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
                formatter: () => "🔍", cellClick: (e, cell) => showOverlay(cell.getRow().getData())
            },
            {title: "삭제", formatter: "buttonCross", width: 60, cellClick: (e, cell) => cell.getRow().delete()},
            {title: "orgName", field: "orgName", visible: false}
        ]
    });
}

// 8. 클립보드 복사 (완료 데이터만 TSV 필터링) [cite: 2026-02-10]
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

// 9. 이미지 오버레이 및 줌/팬 로직
let scale = 1, pointX = 0, pointY = 0, start = { x: 0, y: 0 }, isPanning = false;

function showOverlay(data) {
    const overlay = document.getElementById("imageOverlay");
    const img = document.getElementById("overlayImg");
    const dataRow = document.getElementById("overlayDataRow");
    
    scale = 1; pointX = 0; pointY = 0;
    img.style.transform = `translate(0px, 0px) scale(1)`;

    if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(data._rawFile);
    
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

    window.onmouseup = () => { isPanning = false; container.style.cursor = "grab"; };
}

function closeOverlay() { document.getElementById("imageOverlay").style.display = "none"; }

function makeDraggable(el, header) {
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    header.onmousedown = (e) => {
        e.preventDefault(); p3 = e.clientX; p4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (e) => {
            e.preventDefault(); p1 = p3 - e.clientX; p2 = p4 - e.clientY;
            p3 = e.clientX; p4 = e.clientY;
            el.style.top = (el.offsetTop - p2) + "px"; el.style.left = (el.offsetLeft - p1) + "px";
        };
    };
}

function submitFinalData() {
    const data = table.getData().map(({_rawFile, ...rest}) => rest);
    console.log("최종 데이터 제출:", data);
    alert(`${data.length}건의 데이터를 제출했습니다.`);
}