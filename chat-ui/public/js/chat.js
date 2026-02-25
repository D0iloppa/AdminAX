/**
 * AdminAX Core Chat Logic v2.0
 */

// 전역 상태 데이터 (초기 더미 세트) [cite: 2026-02-24]
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

// 더미 채팅 내용 (세션 진입 시 로딩용)
const dummyMessages = {
    "ex1": [
        { role: 'user', content: '전사 보안 가이드에서 패스워드 규정이 어떻게 되나요?' },
        { role: 'ai', content: '전사 보안 가이드에 따르면 패스워드는 영문, 숫자, 특수문자를 포함하여 8자리 이상으로 설정해야 하며, 90일마다 변경해야 합니다.' }
    ],
    "ex2": [
        { role: 'user', content: '아키텍처 초안 검토 부탁드립니다.' },
        { role: 'ai', content: '첨부하신 아키텍처 초안을 검토한 결과, 트래픽 폭주에 대비한 로드밸런서 계층 확장이 필요할 것으로 보입니다.' }
    ]
};

let currentSessionUuid = null;
let searchTerm = "";
let uploadedFiles = [];
let isGenerating = false;
let currentTypingInterval = null;

// DOM 요소 
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
 * [기능] 사이드바 렌더링 및 검색 [cite: 2026-02-24]
 */
function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';

    const renderArea = (title, areaType, folderList) => {
        const section = document.createElement('div');
        section.className = "mb-4";

        const header = document.createElement('div');
        header.className = "flex justify-between items-center mb-2 px-2";
        header.innerHTML = `
            <span class="text-[10px] font-bold text-slate-400 tracking-widest">${title}</span>
            <button class="text-slate-400 hover:text-blue-500 transition-colors" onclick="addFolder('${areaType}')" title="${title} 폴더 추가">
                <i class="fa-solid fa-folder-plus text-[10px]"></i>
            </button>
        `;
        section.appendChild(header);

        const filtered = folderList.map(folder => {
            // 자식 세션 중 검색어가 포함된 것만 추출
            const matchesChild = folder.children?.filter(c => {
                const term = searchTerm.toLowerCase();
                return c.name.toLowerCase().includes(term) || (c.content && c.content.toLowerCase().includes(term));
            });

            // 내부 세션이 검색되거나, 폴더 이름 자체가 검색된 경우 반환
            const matchesName = folder.name.toLowerCase().includes(searchTerm.toLowerCase());

            if (matchesName || (matchesChild && matchesChild.length > 0)) {
                return {
                    ...folder,
                    // 폴더 이름에 검색어가 포함되지 않았을 경우, 매칭된 세션만 보이도록 필터링 적용 (검색 중일 때만)
                    children: (!matchesName && searchTerm !== "") ? matchesChild : folder.children,
                    // 검색 결과가 있는 폴더는 자동으로 열림 처리
                    isOpen: searchTerm !== "" ? true : folder.isOpen
                };
            }
            return null;
        }).filter(item => item !== null);

        filtered.forEach(item => {
            section.appendChild(createFolderUI(item, areaType));
        });

        return section;
    };

    nav.appendChild(renderArea("PUBLIC", "public", sessionData.public));
    nav.appendChild(renderArea("PRIVATE", "private", sessionData.private));
}

function createFolderUI(folder, areaType) {
    const div = document.createElement('div');
    div.className = "mb-1 group";
    div.innerHTML = `
        <div class="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors">
            <div class="flex items-center gap-2 flex-1" onclick="toggleFolder('${folder.id}', '${areaType}')">
                <i class="fa-solid ${folder.isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} text-[9px] text-slate-300"></i>
                <i class="fa-solid ${folder.isOpen ? 'fa-folder-open' : 'fa-folder'} text-yellow-500 text-sm"></i>
                <span class="text-[11px] font-bold text-slate-600 uppercase tracking-tight">${folder.name}</span>
            </div>
            <div class="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                ${areaType === 'private' ? `<i class="fa-solid fa-pen text-[9px] text-slate-300 hover:text-blue-500 cursor-pointer px-1.5" onclick="renameFolder('${folder.id}')"></i>` : ''}
                <i class="fa-solid fa-trash-can text-[10px] text-slate-200 hover:text-red-500 cursor-pointer px-1.5" onclick="deleteFolder('${folder.id}', '${areaType}')"></i>
            </div>
        </div>
        <div class="space-y-0.5 mt-0.5 ${folder.isOpen ? '' : 'hidden'}">
            ${folder.children.map(child => `
                <div class="group/session ml-6 p-2 text-[11px] rounded-md hover:bg-slate-100 flex items-center justify-between text-slate-500 transition-all ${currentSessionUuid === child.uuid ? 'session-active' : ''}">
                    <div class="flex items-center gap-2 flex-1 cursor-pointer overflow-hidden" onclick="handleSessionClick('${child.uuid}', '${child.type}', '${child.name}')">
                        <i class="fa-solid ${child.type === 'public' ? 'fa-users' : 'fa-lock'} opacity-40 text-[9px]"></i>
                        <span class="truncate" title="${child.name}">${child.name}</span>
                    </div>
                    ${child.type === 'private' ? `<i class="fa-solid fa-pen text-[9px] text-slate-300 opacity-0 group-hover/session:opacity-100 hover:text-blue-500 cursor-pointer pl-2 pr-1" onclick="renameSession('${child.uuid}')"></i>` : ''}
                </div>
            `).join('')}
        </div>
    `;
    return div;
}

/**
 * [기능] 세션 클릭 및 Fork 로직 [cite: 2026-02-24]
 */
function handleSessionClick(uuid, type, name) {
    if (type === 'public') {
        Swal.fire({
            title: '분석 브랜치 생성',
            text: `'${name}' 세션을 나만의 브랜치로 Fork하여 분석을 시작할까요?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '네, 시작합니다',
            cancelButtonText: '취소',
            confirmButtonColor: '#3b82f6'
        }).then((result) => {
            if (result.isConfirmed) {
                const newUuid = generateUUID();
                createNewSession(newUuid, `${name} (Forked)`, "private");
            }
        });
        return;
    }
    loadSessionHistory(uuid, name, type);
}

function loadSessionHistory(uuid, name, type) {
    if (isGenerating) stopGeneration(); // 다른 세션 이동 시 기존 생성 중단

    currentSessionUuid = uuid;
    document.getElementById('session-uuid').innerText = uuid;
    document.getElementById('current-title').innerText = name;

    const badge = document.getElementById('session-type-badge');
    badge.innerText = type.toUpperCase();
    badge.classList.remove('hidden');

    console.log(`[API CALL] GET /api/chat/history/${uuid}`); // 백엔드 연동 포인트 [cite: 2026-02-24]

    chatWindow.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full opacity-30">
            <i class="fa-solid fa-spinner animate-spin text-2xl mb-2"></i>
            <p class="text-xs italic">"${name}" 기록을 가져오는 중...</p>
        </div>
    `;

    // 더미 로딩 시뮬레이션
    setTimeout(() => {
        chatWindow.innerHTML = ''; // 클리어
        // 테스트를 위해 특정 이름일 때 더미 메시지 세팅
        let messages = [];
        if (name.includes("보안")) messages = dummyMessages["ex1"];
        else if (name.includes("프로젝트")) messages = dummyMessages["ex2"];

        if (messages.length > 0) {
            messages.forEach(msg => renderMessage(msg.role, msg.content));
        } else {
            renderEmptyState();
        }
        renderSidebar();
        scrollToBottom();
    }, 600);
}

function renderEmptyState() {
    chatWindow.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-slate-300 space-y-4">
            <i class="fa-solid fa-robot text-6xl opacity-20"></i>
            <p class="text-sm font-medium">분석할 문서를 업로드하거나 대화를 시작하세요</p>
        </div>
    `;
}

/**
 * [기능] 메시지 렌더링 [cite: 2026-02-24]
 */
function renderMessage(role, text, isTyping = false) {
    // 빈 화면 안내 문구가 있으면 제거
    if (chatWindow.querySelector('.fa-robot.text-6xl')) {
        chatWindow.innerHTML = '';
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `flex max-w-3xl mx-auto w-full gap-4 ${role === 'user' ? 'flex-row-reverse' : 'flex-row'} mb-8 animate-fade-in`;

    let avatarHtml = '';
    if (role === 'ai') {
        avatarHtml = `
            <div class="w-8 h-8 shrink-0 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-sm mt-1">
                <i class="fa-solid fa-robot text-sm"></i>
            </div>
        `;
    } else {
        avatarHtml = `
            <div class="w-8 h-8 shrink-0 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 shadow-sm mt-1">
                <i class="fa-solid fa-user text-sm"></i>
            </div>
        `;
    }

    const contentClass = role === 'user'
        ? 'bg-slate-100 text-slate-800 px-5 py-3.5 rounded-2xl rounded-tr-sm'
        : 'prose prose-sm text-slate-700 bg-transparent flex-1 pt-1.5';

    let filesHtml = '';
    if (role === 'user' && !isTyping && uploadedFiles.length > 0 && chatWindow.children.length === 0) {
        // 첫 메시지에 파일이 첨부된 경우 (데모용)
        filesHtml = `<div class="flex gap-2 mb-2 flex-wrap">`;
        uploadedFiles.forEach(f => {
            filesHtml += `<div class="flex items-center gap-1.5 text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-100"><i class="fa-solid fa-file-lines"></i> ${f.name}</div>`;
        });
        filesHtml += `</div>`;
    }

    msgDiv.innerHTML = `
        ${avatarHtml}
        <div class="${role === 'user' ? 'max-w-[70%]' : 'flex-1'}">
            <div class="${contentClass}">
                ${filesHtml}
                <div class="message-content leading-relaxed">${text}</div>
            </div>
        </div>
    `;

    chatWindow.appendChild(msgDiv);
    scrollToBottom();
    return msgDiv.querySelector('.message-content');
}

/**
 * [기능] 메시지 전송 및 AI 응답 처리 [cite: 2026-02-24]
 */
async function sendMessage() {
    if (isGenerating) {
        stopGeneration();
        return;
    }

    const text = chatInput.value.trim();
    if (!text && uploadedFiles.length === 0) return;

    if (!currentSessionUuid) {
        // 선택된 세션이 없으면 새 세션 생성
        createNewSession(generateUUID(), "새로운 분석 대화", "private");
    }

    const hasFiles = uploadedFiles.length > 0;

    // 1. 사용자 메시지 렌더링
    renderMessage('user', text);

    // 입력창 초기화
    chatInput.value = '';
    chatInput.style.height = 'auto';
    handleFileSelection([]); // 파일 큐 초기화 (이미 보냈으므로)

    // 버튼 모양 정지 버튼으로 변경
    setGeneratingState(true);

    // 2. AI 응답 홀더 생성 (타이핑 전)
    const aiContentEl = renderMessage('ai', '', true);

    // 초기 로딩 애니메이션
    aiContentEl.innerHTML = '<span class="typing-indicator flex gap-1 items-center h-5"><span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span><span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100"></span><span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200"></span></span>';

    try {
        console.log(`[API CALL] POST /api/chat/message`); // 백엔드 연동 포인트

        let dummyResponse = "분석이 완료되었습니다. 제공해주신 문서에 따르면 해당 데이터는 주요 지표를 포함하고 있으며, 특히 X 파트에서 개선의 여지가 보입니다. 관련하여 추가 분석을 진행할까요?";

        // 파일 첨부 시 백엔드 비동기 처리 시뮬레이션
        if (hasFiles) {
            // "분석 중..." 상태 표시 (서버에서 주기적으로 상태가 오는 형태 시뮬레이트)
            await new Promise(resolve => setTimeout(resolve, 600));
            if (!isGenerating) return;
            aiContentEl.innerHTML = '<div class="flex items-center gap-2 text-blue-600 text-[11px] font-bold bg-blue-50 w-fit px-3 py-1.5 rounded-lg border border-blue-100"><i class="fa-solid fa-file-contract animate-pulse"></i><span>문서를 분석 중입니다...</span></div>';

            await new Promise(resolve => setTimeout(resolve, 1500));
            if (!isGenerating) return;
            aiContentEl.innerHTML = '<div class="flex items-center gap-2 text-emerald-600 text-[11px] font-bold bg-emerald-50 w-fit px-3 py-1.5 rounded-lg border border-emerald-100"><i class="fa-solid fa-check"></i><span>문서 분석 완료</span></div>';

            await new Promise(resolve => setTimeout(resolve, 600));
            if (!isGenerating) return;
            dummyResponse = "첨부해주신 문서를 모두 읽었습니다. " + dummyResponse;
        } else {
            // 일반 대화 지연
            await new Promise(resolve => setTimeout(resolve, 800));
            if (!isGenerating) return;
        }

        // 타이핑 전 최종 클리어 후 생성 방식 텍스트로 치환하기 위해 빈 태그 세팅
        if (hasFiles) {
            aiContentEl.innerHTML += '<div class="mt-3 typing-content"></div>';
        } else {
            aiContentEl.innerHTML = '<div class="typing-content"></div>';
        }

        const textTarget = aiContentEl.querySelector('.typing-content');

        // 타이핑 효과 구현
        let i = 0;
        currentTypingInterval = setInterval(() => {
            if (!isGenerating) {
                clearInterval(currentTypingInterval);
                return;
            }
            if (i < dummyResponse.length) {
                textTarget.innerHTML += dummyResponse.charAt(i);
                i++;
                scrollToBottom();
            } else {
                clearInterval(currentTypingInterval);
                setGeneratingState(false);
            }
        }, 20); // 글자당 속도

    } catch (e) {
        aiContentEl.innerHTML = `<span class="text-red-500">오류가 발생했습니다: ${e.message}</span>`;
        setGeneratingState(false);
    }
}

function stopGeneration() {
    isGenerating = false;
    if (currentTypingInterval) clearInterval(currentTypingInterval);
    setGeneratingState(false);
}

function setGeneratingState(generating) {
    isGenerating = generating;
    if (generating) {
        sendBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
        sendBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        sendBtn.classList.add('bg-slate-600', 'hover:bg-slate-700');
    } else {
        sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
        sendBtn.classList.remove('bg-slate-600', 'hover:bg-slate-700');
        sendBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }
}

function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

/**
 * [기능] 전역 드래그 앤 드롭 [cite: 2026-02-24]
 */
function initGlobalDragAndDrop() {
    const overlay = document.getElementById('global-drop-overlay');

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        overlay.classList.remove('hidden');
    });

    overlay.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null) overlay.classList.add('hidden');
    });

    window.addEventListener('dragover', (e) => e.preventDefault());

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.add('hidden');
        handleFileSelection(e.dataTransfer.files);
    });
}

/**
 * [기능] 폴더 관리 및 유틸리티 [cite: 2026-02-24]
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function toggleFolder(id, areaType) {
    const folder = sessionData[areaType].find(f => f.id === id);
    if (folder) {
        folder.isOpen = !folder.isOpen;
        renderSidebar();
    }
}

function deleteFolder(id, areaType) {
    Swal.fire({
        title: '폴더 삭제',
        text: "폴더를 삭제하시겠습니까? 하위 모든 세션이 논리 삭제 처리됩니다.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: '삭제',
        cancelButtonText: '취소'
    }).then((result) => {
        if (result.isConfirmed) {
            sessionData[areaType] = sessionData[areaType].filter(f => f.id !== id);
            renderSidebar();
            Swal.fire({
                title: '삭제 완료',
                text: '폴더가 삭제되었습니다.',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        }
    });
}

function addFolder(areaType) {
    Swal.fire({
        title: `${areaType.toUpperCase()} 영역 폴더 추가`,
        input: 'text',
        inputPlaceholder: '새 폴더 이름을 입력하세요',
        showCancelButton: true,
        confirmButtonText: '추가',
        cancelButtonText: '취소',
        confirmButtonColor: '#3b82f6',
        inputValidator: (value) => {
            if (!value) {
                return '폴더 이름을 입력해주세요!';
            }
        }
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            sessionData[areaType].push({ id: `f-${areaType}-${Date.now()}`, name: result.value, isFolder: true, isOpen: true, children: [] });
            renderSidebar();
        }
    });
}

function renameFolder(id) {
    const folder = sessionData.private.find(f => f.id === id);
    if (!folder) return;

    Swal.fire({
        title: '폴더명 변경',
        input: 'text',
        inputValue: folder.name,
        showCancelButton: true,
        confirmButtonText: '변경',
        cancelButtonText: '취소',
        confirmButtonColor: '#3b82f6',
        inputValidator: (value) => {
            if (!value) {
                return '폴더 이름을 입력해주세요!';
            }
        }
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            folder.name = result.value;
            renderSidebar();
        }
    });
}

function renameSession(uuid) {
    for (const folder of sessionData.private) {
        const session = folder.children.find(s => s.uuid === uuid);
        if (session) {
            Swal.fire({
                title: '세션명 변경',
                input: 'text',
                inputValue: session.name,
                showCancelButton: true,
                confirmButtonText: '변경',
                cancelButtonText: '취소',
                confirmButtonColor: '#3b82f6',
                inputValidator: (value) => {
                    if (!value) {
                        return '세션 이름을 입력해주세요!';
                    }
                }
            }).then((result) => {
                if (result.isConfirmed && result.value) {
                    session.name = result.value;
                    if (currentSessionUuid === uuid) {
                        document.getElementById('current-title').innerText = result.value;
                    }
                    renderSidebar();
                }
            });
            break;
        }
    }
}

function createNewSession(uuid, title = "새로운 분석 대화", type = "private") {
    currentSessionUuid = uuid;
    const newSession = { uuid, name: title, type, content: "" };

    if (sessionData[type].length > 0) {
        sessionData[type][0].children.unshift(newSession);
    } else {
        sessionData[type].push({
            id: `f-${type}-default`,
            name: "기본 폴더",
            isFolder: true,
            isOpen: true,
            children: [newSession]
        });
    }

    loadSessionHistory(uuid, title, type);
    renderSidebar();
}

/**
 * [기능] 파일 프리뷰 및 메시지 전송 [cite: 2026-02-23]
 */
function handleFileSelection(files) {
    uploadedFiles = [...uploadedFiles, ...Array.from(files)];
    const preview = document.getElementById('file-list-preview');

    if (uploadedFiles.length > 0) {
        preview.classList.remove('hidden');
        preview.innerHTML = uploadedFiles.map((f, i) => `
            <div class="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100 text-[10px] text-blue-600 shadow-sm animate-fade-in">
                <i class="fa-solid fa-file-lines"></i>
                <span class="max-w-[100px] truncate font-bold">${f.name}</span>
                <i class="fa-solid fa-xmark cursor-pointer hover:text-red-500" onclick="removeFile(${i})"></i>
            </div>
        `).join('');
    }
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    handleFileSelection([]); // 리렌더링
    if (uploadedFiles.length === 0) document.getElementById('file-list-preview').classList.add('hidden');
}

function setupGlobalEventListeners() {
    const input = document.getElementById('chat-input');
    const searchInput = document.getElementById('sidebar-search');

    input.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });

    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        renderSidebar();
    });

    document.getElementById('new-chat-btn').onclick = () => {
        createNewSession(generateUUID());
        renderEmptyState();
    };

    // 글로벌 폴더 추가 버튼은 기본적으로 private에 추가하도록 설정
    const globalAddFolderBtn = document.getElementById('add-folder-btn');
    if (globalAddFolderBtn) {
        globalAddFolderBtn.onclick = () => addFolder('private');
    }

    // 엔터키 통제 (Shift+Enter는 줄바꿈, Enter는 전송)
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);
}