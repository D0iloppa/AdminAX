/**
 * AdminAX Core Chat Logic v2.0 - Async Pipeline Integrated
 */

// [상태 관리]
let sessionData = {
    public: [
        {
            id: "folder-public-1",
            name: "공통 지식 베이스",
            isFolder: true,
            isOpen: true,
            children: [
                { uuid: "550e8400-e29b-41d4-a716-446655440000", name: "전사 보안 가이드 질의", type: "public", content: "회사 보안 정책에 관한 내용입니다." },
                { uuid: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", name: "2026 운영 계획 공유", type: "public", content: "내년도 전사 운영 계획 지표들입니다." }
            ]
        }
    ],
    private: [
        {
            id: "folder-private-1",
            name: "개인 분석함",
            isFolder: true,
            isOpen: true,
            children: [
                { uuid: "7d444840-9dc0-11d1-b245-5ffd0a000000", name: "프로젝트 A 기술 검토", type: "private", content: "프로젝트 A의 아키텍처 도입 건을 논의합니다." }
            ]
        }
    ]
};

const dummyMessages = {
    "ex1": [
        { role: 'user', content: '전사 보안 가이드에서 패스워드 규정이 어떻게 되나요?' },
        { role: 'ai', content: '전사 보안 가이드에 따르면 패스워드는 영문, 숫자, 특수문자를 포함하여 8자리 이상으로 설정해야 하며, 90일마다 변경해야 합니다.' }
    ]
};

// [글로벌 변수]
let currentSessionUuid = null;
let searchTerm = "";
let uploadedFiles = []; // 프리뷰용
let pendingTaskIds = new Set(); // 현재 진행 중인 정규화 작업 키 [cite: 2026-03-03]
let isGenerating = false;
let currentTypingInterval = null;

let chatWindow, chatInput, sendBtn;

document.addEventListener('DOMContentLoaded', () => {
    chatWindow = document.getElementById('chat-window');
    chatInput = document.getElementById('chat-input');
    sendBtn = document.getElementById('send-btn');
    initApp();
});

function initApp() {
    renderSidebar();
    setupGlobalEventListeners();
    initGlobalDragAndDrop();
}

/**
 * [기능] 파일 선택 시 즉시 업로드 (Pre-upload) [cite: 2026-03-03]
 */
async function handleFileSelection(files) {
    if (files.length === 0) return;

    const fileArray = Array.from(files);
    uploadedFiles = [...uploadedFiles, ...fileArray];
    renderFilePreview(); // UI 리스트 갱신

    const formData = new FormData();
    fileArray.forEach(f => formData.append('files', f));

    try {
        // 서버에 문서 정규화 요청 (Spring Backend)
        const response = await fetch('/api/norm/normDocs', {
            method: 'POST',
            body: formData
        });
        const result = await response.json(); // { taskId: "...", docUuids: [...] }

        // 현재 세션에 귀속될 Task ID 보관
        pendingTaskIds.add(result.task_id);

        // SSE를 통한 실시간 상태 업데이트 시작 [cite: 2026-03-03]
        initNormalizationSSE(result.task_id);

    } catch (e) {
        console.error("Pre-upload Failed:", e);
        Swal.fire('업로드 실패', '문서 정규화 서버와 통신할 수 없습니다.', 'error');
    }
}

/**
 * [기능] 정규화 상태 SSE 리스너 [cite: 2026-03-03]
 */
/**
 * [수정] 정규화 상태 SSE 리스너 (진행률 바 연동 버전) [cite: 2026-03-03, 2026-03-04]
 */
function initNormalizationSSE(taskId) {
    // 사용자님의 엔드포인트 규칙인 'subscribe/' 경로를 준수합니다. [cite: 2026-03-04]
    const eventSource = new EventSource(`/api/norm/subscribe/${taskId}`);

    // 1. 개별 문서 상태 및 전체 진행률 업데이트 (DOC_PROGRESS) [cite: 2026-03-04]
    eventSource.addEventListener("DOC_PROGRESS", (event) => {
        const data = JSON.parse(event.data);

        // 로그 출력 (chatWindow 또는 별도 콘솔 영역) [cite: 2026-03-04]
        const logMsg = `[진행] 문서: ${data.docUuid.substring(0, 8)}... | 상태: ${data.status} (${data.completed}/${data.total})`;
        console.log(logMsg); // 내부 로깅

        // 프로그레스 바 업데이트 로직 [cite: 2026-03-04]
        if (data.total > 0) {
            const percent = Math.round((data.completed / data.total) * 100);
            const bar = document.getElementById('progressBar');
            const wrapper = document.getElementById('progressWrapper');

            if (wrapper) wrapper.style.display = 'flex';
            if (bar) {
                bar.style.width = percent + '%';
                bar.innerText = percent + '%';
            }
        }

        // 채팅창 내 파일 상태 UI 업데이트 (기존 로직 유지)
        updateFileStatusInChat(data.docUuid, data.status);
    });

    // 2. 전체 작업 완료 (TASK_FINISHED) [cite: 2026-03-04]
    eventSource.addEventListener("TASK_FINISHED", (event) => {
        const data = JSON.parse(event.data);
        console.log(`🎉 [최종 완료] ${data.message}`);

        // 프로그레스 바 완료 처리
        const bar = document.getElementById('progressBar');
        if (bar) {
            bar.classList.replace('bg-blue-600', 'bg-emerald-500');
            bar.innerText = '정규화 완료';
        }

        // 3초 후 바 숨기기 (옵션)
        setTimeout(() => {
            const wrapper = document.getElementById('progressWrapper');
            if (wrapper) wrapper.style.display = 'none';
        }, 3000);

        eventSource.close();
    });

    // 3. 에러 발생 시 [cite: 2026-03-04]
    eventSource.onerror = (err) => {
        if (eventSource.readyState === EventSource.CLOSED) {
            console.log("SSE Connection closed normally.");
        } else {
            console.error("[경고] 실시간 연결이 끊겼습니다.");
            eventSource.close();
        }
    };
}

/**
 * [기능] 메시지 전송 및 비동기 LLM 트리거 [cite: 2026-03-03]
 */
async function sendMessage() {
    if (isGenerating) {
        stopGeneration();
        return;
    }

    const text = chatInput.value.trim();
    if (!text && pendingTaskIds.size === 0) return;

    if (!currentSessionUuid) {
        createNewSession(generateUUID(), "새로운 분석 대화", "private");
    }

    // 1. 사용자 메시지 UI 렌더링
    renderMessage('user', text);

    // 2. 요청 페이로드 구성 (채팅 + 현재 모든 Task IDs) [cite: 2026-03-03]
    const payload = {
        session_id: currentSessionUuid,
        message: text,
        task_ids: Array.from(pendingTaskIds)
    };

    // UI 초기화
    chatInput.value = '';
    chatInput.style.height = 'auto';
    resetFileQueue();

    // 3. AI 응답 홀더 생성 (재료 확보 상태)
    setGeneratingState(true);
    const aiContentEl = renderMessage('ai', '', true);
    aiContentEl.innerHTML = `
        <div class="ingredient-loader flex flex-col gap-2">
            <div class="flex items-center gap-2 text-blue-600 text-[11px] font-bold">
                <i class="fa-solid fa-spinner animate-spin"></i>
                <span class="status-msg">지식 재료를 모으는 중입니다... (정규화 대기 중)</span>
            </div>
            <div class="typing-content prose prose-sm hidden"></div>
        </div>
    `;

    try {
        // 백엔드 Chat Ask API 호출 (SSE 대응)
        const response = await fetch('/api/chat/sendMsg', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("서버 응답 오류");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let done = false;
        let buffer = "";

        const loaderEl = aiContentEl.querySelector('.ingredient-loader div:first-child');
        const statusMsgEl = aiContentEl.querySelector('.status-msg');
        const textTarget = aiContentEl.querySelector('.typing-content');

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\\n');
                buffer = lines.pop(); // 남아있는 불완전 데이터를 버퍼에 유지

                for (let line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            const dataStr = line.replace('data:', '').trim();
                            if (!dataStr) continue;
                            const data = JSON.parse(dataStr);

                            if (data.status === 'WAITING_TASKS') {
                                statusMsgEl.innerText = "지식 재료를 모으는 중입니다... (정규화 대기 중)";
                            } else if (data.status === 'GENERATING') {
                                statusMsgEl.innerText = "답변을 생성 중입니다...";
                            } else if (data.status === 'COMPLETED') {
                                if (loaderEl) loaderEl.remove();
                                textTarget.classList.remove('hidden');
                                textTarget.innerHTML = "";
                                startTypingEffect(textTarget, data.answer || "분석 결과가 도착했습니다.");
                            } else if (data.status === 'ERROR') {
                                throw new Error(data.message || "알 수 없는 오류");
                            }
                        } catch (e) {
                            if (e.message !== "Unexpected end of JSON input" && !e.message.includes("Unexpected token")) {
                                console.error("SSE Parsing error", e, line);
                            } else if (dataStr && e.message.includes("Unexpected token")) {
                                // Ignore partial chunks if manual parsing fails
                            }
                        }
                    }
                }
            }
        }

        // 전송 성공 후 Task 큐 비우기
        pendingTaskIds.clear();

    } catch (e) {
        aiContentEl.innerHTML = `<span class="text-red-500">오류 발생: ${e.message}</span>`;
        setGeneratingState(false);
    }
}

/**
 * [기능] 타이핑 효과 로직
 */
function startTypingEffect(target, fullText) {
    let i = 0;
    currentTypingInterval = setInterval(() => {
        if (!isGenerating) {
            clearInterval(currentTypingInterval);
            return;
        }
        if (i < fullText.length) {
            target.innerHTML += fullText.charAt(i);
            i++;
            scrollToBottom();
        } else {
            clearInterval(currentTypingInterval);
            setGeneratingState(false);
        }
    }, 20);
}

// --- UI 및 유틸리티 함수들 (누락 없이 통합) ---

function renderFilePreview() {
    const preview = document.getElementById('file-list-preview');
    if (uploadedFiles.length > 0) {
        preview.classList.remove('hidden');
        preview.innerHTML = uploadedFiles.map((f, i) => `
            < div id = "file-node-${i}" class="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100 text-[10px] text-blue-600 shadow-sm" >
                <i class="fa-solid fa-file-lines"></i>
                <span class="max-w-[100px] truncate font-bold">${f.name}</span>
                <span class="status-badge text-[8px] opacity-70">준비 중</span>
                <i class="fa-solid fa-xmark cursor-pointer hover:text-red-500" onclick="removeFile(${i})"></i>
            </div >
            `).join('');
    }
}

function updateFileStatusUI(docUuid, status) {
    // 실제 구현 시에는 파일명과 docUuid 매핑 테이블이 필요합니다.
    const badges = document.querySelectorAll('.status-badge');
    badges.forEach(b => {
        if (status === 'ANALYZING') b.innerHTML = '<i class="fa-solid fa-brain animate-pulse"></i> 분석 중';
        if (status === 'COMPLETED') b.innerText = '정규화 완료';
    });
}

function resetFileQueue() {
    uploadedFiles = [];
    const preview = document.getElementById('file-list-preview');
    if (preview) preview.classList.add('hidden');
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderFilePreview();
}

function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';
    const renderArea = (title, areaType, folderList) => {
        const section = document.createElement('div');
        section.className = "mb-4";
        const header = document.createElement('div');
        header.className = "flex justify-between items-center mb-2 px-2";
        header.innerHTML = `< span class="text-[10px] font-bold text-slate-400 tracking-widest" > ${title}</span > `;
        section.appendChild(header);
        folderList.forEach(item => section.appendChild(createFolderUI(item, areaType)));
        return section;
    };
    nav.appendChild(renderArea("PUBLIC", "public", sessionData.public));
    nav.appendChild(renderArea("PRIVATE", "private", sessionData.private));
}

function createFolderUI(folder, areaType) {
    const div = document.createElement('div');
    div.className = "mb-1 group";
    div.innerHTML = `
            < div class="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors" onclick = "toggleFolder('${folder.id}', '${areaType}')" >
                <div class="flex items-center gap-2 flex-1">
                    <i class="fa-solid ${folder.isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} text-[9px] text-slate-300"></i>
                    <i class="fa-solid ${folder.isOpen ? 'fa-folder-open' : 'fa-folder'} text-yellow-500 text-sm"></i>
                    <span class="text-[11px] font-bold text-slate-600 uppercase">${folder.name}</span>
                </div>
        </div >
            <div class="space-y-0.5 mt-0.5 ${folder.isOpen ? '' : 'hidden'}">
                ${folder.children.map(child => `
                <div class="group/session ml-6 p-2 text-[11px] rounded-md hover:bg-slate-100 flex items-center justify-between text-slate-500 ${currentSessionUuid === child.uuid ? 'bg-slate-100 font-bold text-blue-600' : ''}" onclick="handleSessionClick('${child.uuid}', '${child.type}', '${child.name}')">
                    <div class="flex items-center gap-2 flex-1 cursor-pointer overflow-hidden">
                        <i class="fa-solid ${child.type === 'public' ? 'fa-users' : 'fa-lock'} opacity-40 text-[9px]"></i>
                        <span class="truncate">${child.name}</span>
                    </div>
                </div>
            `).join('')}
            </div>
        `;
    return div;
}

function handleSessionClick(uuid, type, name) {
    if (type === 'public') {
        Swal.fire({
            title: 'Fork Session',
            text: `'${name}'을(를) 개인 분석함으로 복사할까요 ? `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Fork',
            confirmButtonColor: '#3b82f6'
        }).then((res) => {
            if (res.isConfirmed) createNewSession(generateUUID(), `${name} (Forked)`, "private");
        });
        return;
    }
    loadSessionHistory(uuid, name, type);
}

function loadSessionHistory(uuid, name, type) {
    currentSessionUuid = uuid;
    document.getElementById('current-title').innerText = name;
    chatWindow.innerHTML = '';
    renderEmptyState();
    renderSidebar();
}

function renderEmptyState() {
    chatWindow.innerHTML = `
            < div class="h-full flex flex-col items-center justify-center text-slate-300 space-y-4" >
            <i class="fa-solid fa-robot text-6xl opacity-20"></i>
            <p class="text-sm font-medium">분석할 문서를 업로드하거나 대화를 시작하세요</p>
        </div >
            `;
}

function renderMessage(role, text, isTyping = false) {
    if (chatWindow.querySelector('.fa-robot.text-6xl')) chatWindow.innerHTML = '';
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex max - w - 3xl mx - auto w - full gap - 4 ${role === 'user' ? 'flex-row-reverse' : 'flex-row'} mb - 8 animate - fade -in `;

    msgDiv.innerHTML = `
            < div class="w-8 h-8 shrink-0 rounded-full ${role === 'ai' ? 'bg-blue-600' : 'bg-slate-200'} flex items-center justify-center text-white shadow-sm mt-1" >
                <i class="fa-solid ${role === 'ai' ? 'fa-robot' : 'fa-user'} text-sm ${role === 'user' ? 'text-slate-600' : ''}"></i>
        </div >
            <div class="${role === 'user' ? 'max-w-[70%]' : 'flex-1'}">
                <div class="${role === 'user' ? 'bg-slate-100 text-slate-800 px-5 py-3.5 rounded-2xl rounded-tr-sm' : 'prose prose-sm text-slate-700'}">
                    <div class="message-content leading-relaxed">${text}</div>
                </div>
            </div>
        `;
    chatWindow.appendChild(msgDiv);
    scrollToBottom();
    return msgDiv.querySelector('.message-content');
}

function setGeneratingState(generating) {
    isGenerating = generating;
    sendBtn.innerHTML = generating ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-arrow-up"></i>';
    sendBtn.className = generating
        ? "w-10 h-10 rounded-xl bg-slate-600 text-white transition-all shadow-lg flex items-center justify-center"
        : "w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-lg flex items-center justify-center";
}

function stopGeneration() {
    isGenerating = false;
    if (currentTypingInterval) clearInterval(currentTypingInterval);
    setGeneratingState(false);
}

function scrollToBottom() { chatWindow.scrollTop = chatWindow.scrollHeight; }

function generateUUID() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => (c == 'x' ? (Math.random() * 16 | 0) : (Math.random() * 16 | 0 & 0x3 | 0x8)).toString(16)); }

function toggleFolder(id, areaType) {
    const folder = sessionData[areaType].find(f => f.id === id);
    if (folder) { folder.isOpen = !folder.isOpen; renderSidebar(); }
}

function createNewSession(uuid, title, type) {
    currentSessionUuid = uuid;
    sessionData[type][0].children.unshift({ uuid, name: title, type });
    loadSessionHistory(uuid, title, type);
}

function setupGlobalEventListeners() {
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    sendBtn.addEventListener('click', sendMessage);
    document.getElementById('sidebar-search').addEventListener('input', e => { searchTerm = e.target.value; renderSidebar(); });
}

function initGlobalDragAndDrop() {
    const overlay = document.getElementById('global-drop-overlay');
    window.addEventListener('dragenter', e => { e.preventDefault(); overlay.classList.remove('hidden'); });
    overlay.addEventListener('dragleave', e => { if (e.relatedTarget === null) overlay.classList.add('hidden'); });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => { e.preventDefault(); overlay.classList.add('hidden'); handleFileSelection(e.dataTransfer.files); });
}