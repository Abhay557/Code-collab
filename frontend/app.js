// Global error handler to catch any runtime errors
window.onerror = function (msg, url, line, col, error) {
    console.error('[Codependal] JS Error at line ' + line + ': ' + msg);
    return false;
};
// â”€â”€â”€ Socket.IO Connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://codecollab-backend-ya9c.onrender.com'; // Change this to your live backend URL
const socket = io(BACKEND_URL);

// â”€â”€â”€ Generate a random UID (replaces Firebase anonymous auth) â”€â”€â”€â”€â”€
function generateUID() {
    return crypto.randomUUID();
}

// â”€â”€â”€ DOM References â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dom = {
    home: document.getElementById('home-view'),
    editor: document.getElementById('editor-view'),
    createPrivateBtn: document.getElementById('create-private-room-btn'),
    createPublicBtn: document.getElementById('create-public-room-btn'),
    joinRandomBtn: document.getElementById('join-random-btn'),
    joinBtn: document.getElementById('join-room-btn'),
    roomIdInput: document.getElementById('room-id-input'),
    roomIdDisplay: document.getElementById('room-id-display'),
    participants: document.getElementById('participants-list'),
    leaveBtn: document.getElementById('leave-room-btn'),
    output: document.getElementById('output-frame'),
    notification: document.getElementById('notification'),
    console: document.getElementById('console-output'),
    clearConsoleBtn: document.getElementById('clear-console-btn'),
    modal: document.getElementById('name-modal'),
    modalTitle: document.getElementById('modal-title'),
    nameInput: document.getElementById('name-input'),
    modalConfirm: document.getElementById('modal-confirm'),
    modalCancel: document.getElementById('modal-cancel'),
    confirmModal: document.getElementById('confirm-modal'),
    confirmTitle: document.getElementById('confirm-title'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmOkBtn: document.getElementById('confirm-ok-btn'),
    confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
    chatPanel: document.getElementById('chat-panel'),
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    toggleChatBtn: document.getElementById('toggle-chat-btn'),
    aiPanel: document.getElementById('ai-panel'),
    aiHistory: document.getElementById('ai-history'),
    aiForm: document.getElementById('ai-form'),
    aiInput: document.getElementById('ai-input'),
    aiSubmitBtn: document.getElementById('ai-submit-btn'),
    aiReviewBtn: document.getElementById('ai-review-btn'),
    aiLoading: document.getElementById('ai-loading'),
    aiLoadingText: document.getElementById('ai-loading-text'),
    toggleAiBtn: document.getElementById('toggle-ai-btn'),
    editorPanel: document.getElementById('editor-panel'),
    outputPanel: document.getElementById('output-panel'),
    resizer: document.getElementById('resizer'),
    safeModeBtn: document.getElementById('safe-mode-btn'),
    historyBtn: document.getElementById('history-btn'),
    historyPanel: document.getElementById('history-panel'),
    historyCloseBtn: document.getElementById('history-close-btn'),
    historyList: document.getElementById('history-list'),
    saveSnapshotBtn: document.getElementById('save-snapshot-btn'),
    downloadBtn: document.getElementById('download-btn'),
    popoutBtn: document.getElementById('popout-btn'),
    contentWrapper: document.getElementById('content-wrapper'),
    notifPanel: document.getElementById('notif-panel'),
    notifList: document.getElementById('notif-list'),
    notifEmpty: document.getElementById('notif-empty'),
    notifBadge: document.getElementById('notif-badge'),
    notifClearBtn: document.getElementById('notif-clear-btn'),
    chatBadge: document.getElementById('chat-badge'),
    participantsPanel: document.getElementById('participants-panel'),
    participantsFullList: document.getElementById('participants-list-full'),
    participantCountBadge: document.getElementById('participant-count-badge'),
    participantOnlineCount: document.getElementById('participant-online-count')
};

let editorCleanupFns = []; // Track listeners for cleanup on leave
let currentRoomId = null;
let localUser = null;
let debounceTimer = null;
let htmlEditor, cssEditor, jsEditor;
let isChatOpen = false;
let isAiOpen = false;
let isNotifOpen = false;
let isParticipantsOpen = false;
let isRemoteUpdate = false; // flag to prevent echo loops
let isAiGenerating = false;
let isSafeModeOn = false;
let heartbeatTimer = null;
let currentParticipants = [];
let activeVotes = {}; // { targetUid: { count, required } }
let unreadChatCount = 0;
let unreadNotifCount = 0;
let notifications = [];
let activityEditTimers = {}; // debounce map for edit notifications

// â”€â”€â”€ Utility Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showView(viewName) {
    dom.home.style.display = viewName === 'home' ? 'flex' : 'none';
    dom.editor.style.display = viewName === 'editor' ? 'flex' : 'none';
}

function showNotification(message, type = 'error') {
    dom.notification.textContent = message;
    const bgClass = { error: 'bg-red-500', info: 'bg-blue-500', success: 'bg-green-500' }[type] || 'bg-red-500';
    dom.notification.className = `fixed top-5 right-5 text-white py-2 px-4 rounded-lg shadow-lg z-50 ${bgClass}`;
    dom.notification.style.display = 'block';
    setTimeout(() => { dom.notification.style.display = 'none'; }, 3000);
}

function askForName(title) {
    return new Promise(resolve => {
        dom.modalTitle.textContent = title;
        dom.nameInput.value = '';
        dom.modal.style.display = 'flex';

        const onConfirm = () => {
            if (dom.nameInput.value.trim()) {
                cleanup();
                resolve(dom.nameInput.value.trim());
            }
        };

        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        const onKeypress = e => {
            if (e.key === 'Enter') {
                onConfirm();
            }
        };

        const cleanup = () => {
            dom.modal.style.display = 'none';
            dom.modalConfirm.removeEventListener('click', onConfirm);
            dom.modalCancel.removeEventListener('click', onCancel);
            dom.nameInput.removeEventListener('keypress', onKeypress);
        };

        dom.modalConfirm.addEventListener('click', onConfirm);
        dom.modalCancel.addEventListener('click', onCancel);
        dom.nameInput.addEventListener('keypress', onKeypress);
        dom.nameInput.focus();
    });
}

function stringToColor(s) {
    if (!s) return '#a1a1aa';
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ['#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444', '#6366f1'];
    return colors[Math.abs(hash) % colors.length];
}

// â”€â”€â”€ Initialize App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initializeApp() {
    const roomId = window.location.hash.substring(1);
    if (roomId) {
        handleJoinRoom(roomId);
    } else {
        showView('home');
    }
    window.addEventListener('hashchange', () => {
        if (!window.location.hash.substring(1)) {
            leaveRoom();
        }
    });
    initResizing();
}

// â”€â”€â”€ Room Creation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const handleCreateRoom = async (isPublic) => {
    const name = await askForName(`Enter Your Name to Create ${isPublic ? 'Public' : 'Private'} Room`);
    if (!name) return;

    localUser = { uid: generateUID(), name };

    try {
        const res = await fetch(`${BACKEND_URL}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPublic })
        });
        const data = await res.json();

        window.location.hash = data.roomId;
        enterEditor(data.roomId);
    } catch (e) {
        console.error("Create room error:", e);
        showNotification("Could not create room.");
    }
};

dom.createPrivateBtn.addEventListener('click', () => handleCreateRoom(false));
dom.createPublicBtn.addEventListener('click', () => handleCreateRoom(true));

// â”€â”€â”€ Join Random Public Room â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
dom.joinRandomBtn.addEventListener('click', async () => {
    showNotification("Finding a public room...", "info");

    try {
        const res = await fetch(`${BACKEND_URL}/api/rooms/random/public`);
        if (res.ok) {
            const data = await res.json();
            handleJoinRoom(data.roomId);
        } else {
            showNotification("No public rooms available. Why not create one?", "info");
        }
    } catch (error) {
        console.error("Error finding random room:", error);
        showNotification("Could not find a room. Please try again.");
    }
});

// â”€â”€â”€ Join Room by ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
dom.joinBtn.addEventListener('click', () => {
    const roomId = dom.roomIdInput.value.trim();
    if (roomId) handleJoinRoom(roomId);
    else showNotification("Please enter a Room ID.");
});

async function handleJoinRoom(roomId) {
    try {
        const res = await fetch(`${BACKEND_URL}/api/rooms/${roomId}`);
        if (!res.ok) {
            showNotification("Room not found!");
            window.location.hash = '';
            return;
        }
        const name = await askForName('Enter Your Name to Join');
        if (!name) {
            window.location.hash = '';
            return;
        }
        localUser = { uid: generateUID(), name };
        window.location.hash = roomId;
        enterEditor(roomId);
    } catch (e) {
        console.error("Join room error:", e);
        showNotification("Could not join room.");
        window.location.hash = '';
    }
}

// â”€â”€â”€ Custom Confirm Dialog Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const diffModal = document.getElementById('diff-modal');
const diffModalCloseBtn = document.getElementById('diff-modal-close');

diffModalCloseBtn.addEventListener('click', () => {
    diffModal.classList.add('hidden');
});

function showDiffModal(currentSnap, previousSnap, indexNum) {
    document.getElementById('diff-modal-title').textContent = `Snapshot #${indexNum}`;
    const timeStr = new Date(currentSnap.timestamp).toLocaleString();
    document.getElementById('diff-modal-subtitle').textContent = `Saved by ${currentSnap.user} at ${timeStr}`;

    const diffContent = document.getElementById('diff-content');
    diffContent.innerHTML = '';

    const langs = ['html', 'css', 'js'];
    let anyDiff = false;

    langs.forEach(lang => {
        const oldText = previousSnap ? previousSnap[lang] : '';
        const newText = currentSnap[lang];

        if (oldText === newText && previousSnap) return; // No change in this lang

        anyDiff = true;

        // Section header
        const header = document.createElement('div');
        header.className = 'bg-[#1a1a1a] text-zinc-300 px-4 py-2 text-xs font-bold uppercase tracking-wider sticky top-0 border-y border-white/[0.05] z-10';
        header.textContent = lang.toUpperCase();
        diffContent.appendChild(header);

        // Diff lines container
        const pre = document.createElement('pre');
        pre.className = 'w-full m-0 p-0 overflow-x-auto';

        if (!window.Diff) {
            pre.textContent = newText;
            diffContent.appendChild(pre);
            return;
        }

        const diffs = Diff.diffLines(oldText, newText);
        diffs.forEach(part => {
            const hasNewLine = part.value.endsWith('\n');
            const value = hasNewLine ? part.value.slice(0, -1) : part.value; // prevent extra empty lines

            if (!value) return;

            const lines = value.split('\n');
            lines.forEach(line => {
                const div = document.createElement('div');
                div.className = 'px-4 py-0.5 min-w-max leading-normal whitespace-pre';
                const prefix = document.createElement('span');
                prefix.className = 'inline-block w-6 text-center select-none font-bold mr-2';

                if (part.added) {
                    div.classList.add('bg-green-500/20', 'text-green-300');
                    prefix.textContent = '+';
                    prefix.classList.add('text-green-500');
                } else if (part.removed) {
                    div.classList.add('bg-red-500/20', 'text-red-300');
                    prefix.textContent = '-';
                    prefix.classList.add('text-red-500');
                } else {
                    div.classList.add('text-zinc-400');
                    prefix.textContent = ' ';
                }

                div.appendChild(prefix);
                div.appendChild(document.createTextNode(line));
                pre.appendChild(div);
            });
        });

        diffContent.appendChild(pre);
    });

    if (!anyDiff) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'text-center text-zinc-500 py-10';
        emptyMsg.textContent = 'No changes to display.';
        diffContent.appendChild(emptyMsg);
    }

    diffModal.classList.remove('hidden');
}

function showConfirmModal(title, message, onConfirm) {
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmModal.classList.remove('hidden');

    const handleOk = () => {
        cleanup();
        onConfirm();
    };

    const handleCancel = () => {
        cleanup();
    };

    const cleanup = () => {
        dom.confirmModal.classList.add('hidden');
        dom.confirmOkBtn.removeEventListener('click', handleOk);
        dom.confirmCancelBtn.removeEventListener('click', handleCancel);
    };

    dom.confirmOkBtn.addEventListener('click', handleOk);
    dom.confirmCancelBtn.addEventListener('click', handleCancel);
}

// â”€â”€â”€ CodeMirror Editors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const savedTheme = localStorage.getItem('cc-editor-theme') || 'material-darker';

function initializeEditors() {
    const opts = { theme: savedTheme, lineNumbers: true };
    htmlEditor = CodeMirror.fromTextArea(document.getElementById('html-editor'), {
        ...opts, mode: 'xml',
        autoCloseTags: true
    });
    cssEditor = CodeMirror.fromTextArea(document.getElementById('css-editor'), { ...opts, mode: 'css' });
    jsEditor = CodeMirror.fromTextArea(document.getElementById('js-editor'), { ...opts, mode: 'javascript' });

    // Set the dropdown to the saved theme
    const selector = document.getElementById('theme-selector');
    if (selector) selector.value = savedTheme;
}

function changeEditorTheme(theme) {
    if (htmlEditor) htmlEditor.setOption('theme', theme);
    if (cssEditor) cssEditor.setOption('theme', theme);
    if (jsEditor) jsEditor.setOption('theme', theme);
    localStorage.setItem('cc-editor-theme', theme);
}

document.getElementById('theme-selector').addEventListener('change', (e) => {
    changeEditorTheme(e.target.value);
});

// â”€â”€â”€ Enter Editor (replaces Firebase onSnapshot logic) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function enterEditor(roomId) {
    currentRoomId = roomId;
    showView('editor');
    dom.roomIdDisplay.textContent = roomId;
    if (!htmlEditor) initializeEditors();

    // Tell the server we're joining this room
    socket.emit('join-room', { roomId, user: localUser });

    // Code change listeners (local edits â†’ server)
    const htmlChangeHandler = () => { if (!isRemoteUpdate) handleCodeChange('html', htmlEditor.getValue()); };
    htmlEditor.on('change', htmlChangeHandler);
    editorCleanupFns.push(() => htmlEditor.off('change', htmlChangeHandler));
    const cssChangeHandler = () => { if (!isRemoteUpdate) handleCodeChange('css', cssEditor.getValue()); };
    cssEditor.on('change', cssChangeHandler);
    editorCleanupFns.push(() => cssEditor.off('change', cssChangeHandler));
    const jsChangeHandler = () => { if (!isRemoteUpdate) handleCodeChange('js', jsEditor.getValue()); };
    jsEditor.on('change', jsChangeHandler);
    editorCleanupFns.push(() => jsEditor.off('change', jsChangeHandler));

    // Cursor sharing: emit position on cursor activity (throttled)
    let cursorThrottleTimers = {};
    const emitCursor = (lang, editor) => {
        if (cursorThrottleTimers[lang]) return;
        cursorThrottleTimers[lang] = setTimeout(() => {
            cursorThrottleTimers[lang] = null;
        }, 50);
        const pos = editor.getCursor();
        socket.emit('cursor-move', { roomId, lang, line: pos.line, ch: pos.ch });
    };
    const htmlCursorHandler = () => emitCursor('html', htmlEditor);
    htmlEditor.on('cursorActivity', htmlCursorHandler);
    editorCleanupFns.push(() => htmlEditor.off('cursorActivity', htmlCursorHandler));
    const cssCursorHandler = () => emitCursor('css', cssEditor);
    cssEditor.on('cursorActivity', cssCursorHandler);
    editorCleanupFns.push(() => cssEditor.off('cursorActivity', cssCursorHandler));
    const jsCursorHandler = () => emitCursor('js', jsEditor);
    jsEditor.on('cursorActivity', jsCursorHandler);
    editorCleanupFns.push(() => jsEditor.off('cursorActivity', jsCursorHandler));

    // General event listeners
    dom.chatForm.addEventListener('submit', handleSendMessage);
    editorCleanupFns.push(() => dom.chatForm.removeEventListener('submit', handleSendMessage));
    dom.aiForm.addEventListener('submit', handleAiSubmit);
    editorCleanupFns.push(() => dom.aiForm.removeEventListener('submit', handleAiSubmit));
    const aiReviewHandler = () => {
        if (!currentRoomId || isAiGenerating) return;
        isAiGenerating = true;
        dom.aiSubmitBtn.disabled = true;
        dom.aiReviewBtn.disabled = true;
        socket.emit('ai-review', { roomId: currentRoomId });

        const promptDiv = document.createElement('div');
        promptDiv.className = 'ai-prompt-bubble text-white text-xs';
        promptDiv.innerHTML = `<span class="font-bold">${localUser.name}:</span> ðŸ” Code Review`;
        dom.aiHistory.appendChild(promptDiv);
    };
    dom.aiReviewBtn.addEventListener('click', aiReviewHandler);
    editorCleanupFns.push(() => dom.aiReviewBtn.removeEventListener('click', aiReviewHandler));
    dom.leaveBtn.addEventListener('click', leaveRoom);
    editorCleanupFns.push(() => dom.leaveBtn.removeEventListener('click', leaveRoom));
    const clearConsoleHandler = () => dom.console.innerHTML = '';
    dom.clearConsoleBtn.addEventListener('click', clearConsoleHandler);
    editorCleanupFns.push(() => dom.clearConsoleBtn.removeEventListener('click', clearConsoleHandler));
    dom.downloadBtn.addEventListener('click', handleDownload);
    editorCleanupFns.push(() => dom.downloadBtn.removeEventListener('click', handleDownload));
    dom.popoutBtn.addEventListener('click', handlePopout);
    editorCleanupFns.push(() => dom.popoutBtn.removeEventListener('click', handlePopout));
    const safeModeHandler = () => {
        isSafeModeOn = !isSafeModeOn;
        dom.safeModeBtn.classList.toggle('bg-white/20', isSafeModeOn);
        dom.safeModeBtn.classList.toggle('bg-black/80', !isSafeModeOn);
        dom.safeModeBtn.title = isSafeModeOn ? 'Safe Mode ON (JS disabled)' : 'Toggle Safe Mode (disable JS)';
        showNotification(isSafeModeOn ? 'ðŸ›¡ï¸ Safe Mode ON â€” JS disabled in preview' : 'ðŸ›¡ï¸ Safe Mode OFF â€” JS enabled', 'info');
        updateIframe();
    };
    dom.safeModeBtn.addEventListener('click', safeModeHandler);
    editorCleanupFns.push(() => dom.safeModeBtn.removeEventListener('click', safeModeHandler));

    // History panel toggle
    const historyBtnHandler = () => {
        dom.historyPanel.classList.toggle('hidden');
        if (!dom.historyPanel.classList.contains('hidden')) {
            socket.emit('get-history', { roomId });
        }
    };
    dom.historyBtn.addEventListener('click', historyBtnHandler);
    editorCleanupFns.push(() => dom.historyBtn.removeEventListener('click', historyBtnHandler));
    const historyCloseHandler = () => {
        dom.historyPanel.classList.add('hidden');
    };
    dom.historyCloseBtn.addEventListener('click', historyCloseHandler);
    editorCleanupFns.push(() => dom.historyCloseBtn.removeEventListener('click', historyCloseHandler));
    const saveSnapshotHandler = () => {
        socket.emit('save-snapshot-manual', { roomId });
    };
    dom.saveSnapshotBtn.addEventListener('click', saveSnapshotHandler);
    editorCleanupFns.push(() => dom.saveSnapshotBtn.removeEventListener('click', saveSnapshotHandler));

    window.addEventListener('message', handleConsoleMessage);
    window.addEventListener('beforeunload', handleBeforeUnload);
}

// â”€â”€â”€ Socket.IO Listeners (replaces Firebase onSnapshot) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Receive full room state when first joining
socket.on('room-state', (data) => {
    isRemoteUpdate = true;
    htmlEditor.setValue(data.html);
    cssEditor.setValue(data.css);
    jsEditor.setValue(data.js);
    isRemoteUpdate = false;
    // Accept server-assigned UID if provided
    if (data.uid && localUser) {
        localUser.uid = data.uid;
    }
    updateIframe();
    updateParticipants(data.participants);

    // Render existing messages
    dom.chatMessages.innerHTML = '';
    data.messages.forEach(msg => renderMessage(msg));
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    // Reset AI History for new room
    resetAiHistory();
});

function resetAiHistory() {
    dom.aiHistory.innerHTML = `
                <!-- Beta Warning -->
                <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-start gap-2">
                    <svg class="w-5 h-5 text-yellow-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div class="text-[10px] text-yellow-200/80 leading-relaxed">
                        <span class="font-bold text-yellow-500 block mb-0.5">Beta Feature</span>
                        AI may generate incorrect code. Always verify output before using in production.
                    </div>
                </div>
                <!-- Welcome Message -->
                <div class="ai-response-bubble text-sm">
                    Hello! I'm your AI coding assistant. I can write HTML, CSS, and JS for you. What shall we build?
                </div>
            `;
    dom.aiHistory.scrollTop = 0;
}

// Receive real-time code updates from other users
socket.on('code-update', ({ lang, value }) => {
    isRemoteUpdate = true;
    const editor = lang === 'html' ? htmlEditor : lang === 'css' ? cssEditor : jsEditor;
    const cursor = editor.getCursor();
    const scrollInfo = editor.getScrollInfo();
    editor.setValue(value);
    editor.setCursor(cursor);
    editor.scrollTo(scrollInfo.left, scrollInfo.top);
    isRemoteUpdate = false;
    updateIframe();
});

// â”€â”€â”€ Remote Cursor Rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const remoteCursors = {}; // { uid: { bookmark, lang } }

const CURSOR_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];
function getCursorColor(uid) {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash);
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

socket.on('remote-cursor', ({ uid, name, lang, line, ch }) => {
    // Remove old bookmark for this user
    if (remoteCursors[uid] && remoteCursors[uid].bookmark) {
        remoteCursors[uid].bookmark.clear();
    }

    const editor = lang === 'html' ? htmlEditor : lang === 'css' ? cssEditor : jsEditor;
    if (!editor) return;

    const color = getCursorColor(uid);

    // Create zero-width cursor container
    const cursorEl = document.createElement('span');
    cursorEl.className = 'remote-cursor';

    // Visible cursor line
    const cursorLine = document.createElement('span');
    cursorLine.className = 'remote-cursor-line';
    cursorLine.style.backgroundColor = color;

    // Name label
    const label = document.createElement('span');
    label.className = 'remote-cursor-label';
    label.textContent = name;
    label.style.backgroundColor = color;

    cursorEl.appendChild(cursorLine);
    cursorEl.appendChild(label);

    const bookmark = editor.setBookmark({ line, ch }, { widget: cursorEl, insertLeft: true });
    remoteCursors[uid] = { bookmark, lang };

    // Auto-fade label after 3 seconds
    setTimeout(() => { if (label) label.style.opacity = '0'; }, 3000);
});

// Receive participant updates
socket.on('participants-update', (participants) => {
    updateParticipants(participants);
});

socket.on('vote-update', ({ targetUid, targetName, voterName, currentVotes, requiredVotes }) => {
    activeVotes[targetUid] = { count: currentVotes, required: requiredVotes };
    showNotification(`${voterName} voted to kick ${targetName} (${currentVotes}/${requiredVotes} required)`, 'info');
    updateParticipants(currentParticipants);
});

socket.on('user-kicked', ({ uid, name }) => {
    if (localUser && uid === localUser.uid) {
        alert('You have been kicked from the room by majority vote.');
        leaveRoom();
    } else {
        showNotification(`ðŸ’€ ${name} was kicked from the room.`, 'warning');
        delete activeVotes[uid];
        updateParticipants(currentParticipants);
    }
});

// Receive new chat messages
socket.on('new-message', (message) => {
    console.log("New message received:", message);
    renderMessage(message);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    // Show unread badge if chat is closed and message is from someone else
    if (!isChatOpen && localUser && message.senderUid !== localUser.uid) {
        unreadChatCount++;
        if (dom.chatBadge) dom.chatBadge.classList.remove('hidden');
    }
});

// ─── Activity/Notification System ──────────────────────────────────
const NOTIF_COLORS = {
    join: '#22c55e',    // emerald
    leave: '#ef4444',   // red
    edit: '#3b82f6',    // blue
    snapshot: '#a855f7', // purple
    restore: '#eab308'  // amber
};

function getNotifMessage(data) {
    switch (data.type) {
        case 'join': return `${data.user} joined the room`;
        case 'leave': return `${data.user} left the room`;
        case 'edit': return `${data.user} edited ${data.detail}`;
        case 'snapshot': return `${data.user} saved a snapshot`;
        case 'restore': return `${data.user} restored a snapshot`;
        default: return `${data.user} performed an action`;
    }
}

function getRelativeTime(timestamp) {
    const diff = Date.now() - new Date(timestamp).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 5) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
}

function renderNotification(data) {
    // Hide empty state
    if (dom.notifEmpty) dom.notifEmpty.style.display = 'none';

    const item = document.createElement('div');
    item.className = 'notif-item';
    item.dataset.timestamp = data.timestamp;

    const dot = document.createElement('span');
    dot.className = 'notif-dot';
    dot.style.backgroundColor = NOTIF_COLORS[data.type] || '#71717a';

    const content = document.createElement('div');
    content.style.cssText = 'flex: 1; min-width: 0;';

    const msg = document.createElement('p');
    msg.style.cssText = 'font-size: 13px; color: #e4e4e7; margin: 0;';
    msg.textContent = getNotifMessage(data);

    const time = document.createElement('span');
    time.className = 'notif-time';
    time.style.cssText = 'font-size: 11px; color: #52525b; margin-top: 2px; display: block;';
    time.textContent = getRelativeTime(data.timestamp);

    content.appendChild(msg);
    content.appendChild(time);
    item.appendChild(dot);
    item.appendChild(content);

    // Prepend (newest first)
    dom.notifList.insertBefore(item, dom.notifList.firstChild);

    // Cap at 50 items
    while (dom.notifList.children.length > 51) { // +1 for empty state div
        dom.notifList.removeChild(dom.notifList.lastChild);
    }
}

socket.on('activity', (data) => {
    // Edit debouncing: same user + same detail within 5 seconds → skip
    if (data.type === 'edit') {
        const key = `${data.user}_${data.detail}`;
        if (activityEditTimers[key]) return; // already have a recent one
        activityEditTimers[key] = setTimeout(() => {
            delete activityEditTimers[key];
        }, 5000);
    }

    // Store notification
    notifications.unshift(data);
    if (notifications.length > 50) notifications.pop();

    // Render it
    renderNotification(data);

    // Update badge if panel is closed
    if (!isNotifOpen) {
        unreadNotifCount++;
        if (dom.notifBadge) dom.notifBadge.classList.remove('hidden');
    }
});

// Clear All button
if (dom.notifClearBtn) {
    dom.notifClearBtn.addEventListener('click', () => {
        notifications = [];
        // Remove all notif-items but keep the empty state
        const items = dom.notifList.querySelectorAll('.notif-item');
        items.forEach(item => item.remove());
        if (dom.notifEmpty) dom.notifEmpty.style.display = 'flex';
    });
}

// Refresh relative timestamps every 30 seconds
setInterval(() => {
    const timeEls = document.querySelectorAll('.notif-time');
    timeEls.forEach(el => {
        const item = el.closest('.notif-item');
        if (item && item.dataset.timestamp) {
            el.textContent = getRelativeTime(item.dataset.timestamp);
        }
    });
}, 30000);

// Handle server errors
socket.on('error-msg', (msg) => {
    showNotification(msg, 'error');

    // If we're stuck in editor view without a state, go back home
    if (dom.editor.style.display === 'flex' && !htmlEditor.getValue()) {
        leaveRoom();
    }
});

// â”€â”€â”€ AI Socket.IO Listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
socket.on('ai-status', ({ status, prompt, user }) => {
    if (status === 'generating') {
        dom.aiLoading.classList.remove('hidden');
        dom.aiLoadingText.textContent = `${user} asked AI to generate...`;
        dom.aiSubmitBtn.disabled = true;
        isAiGenerating = true;
    } else if (status === 'error') {
        dom.aiLoading.classList.add('hidden');
        dom.aiSubmitBtn.disabled = false;
        isAiGenerating = false;
    }
});

socket.on('ai-result', ({ html, css, js, prompt, user }) => {
    dom.aiLoading.classList.add('hidden');
    dom.aiSubmitBtn.disabled = false;
    isAiGenerating = false;

    // Add user prompt to AI history
    const promptDiv = document.createElement('div');
    promptDiv.className = 'ai-prompt-bubble text-white text-xs';
    promptDiv.innerHTML = `<span class="font-bold">${user}:</span> ${escapeHtml(prompt)}`;
    dom.aiHistory.appendChild(promptDiv);

    // Build response with code blocks
    const responseDiv = document.createElement('div');
    responseDiv.className = 'ai-response-bubble text-gray-200 text-xs';

    const statusLine = document.createElement('div');
    statusLine.textContent = 'âœ… Code generated';
    statusLine.style.marginBottom = '8px';
    responseDiv.appendChild(statusLine);

    // Helper to create a code block
    function createCodeBlock(label, code) {
        if (!code || !code.trim()) return null;
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-code-wrapper';

        const header = document.createElement('div');
        header.className = 'ai-code-label';
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        const copyBtn = document.createElement('button');
        copyBtn.className = 'ai-code-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(code).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
            });
        });
        header.appendChild(labelSpan);
        header.appendChild(copyBtn);

        const block = document.createElement('div');
        block.className = 'ai-code-block';
        block.textContent = code;

        wrapper.appendChild(header);
        wrapper.appendChild(block);
        return wrapper;
    }

    const htmlBlock = createCodeBlock('HTML', html);
    const cssBlock = createCodeBlock('CSS', css);
    const jsBlock = createCodeBlock('JS', js);
    if (htmlBlock) responseDiv.appendChild(htmlBlock);
    if (cssBlock) responseDiv.appendChild(cssBlock);
    if (jsBlock) responseDiv.appendChild(jsBlock);

    dom.aiHistory.appendChild(responseDiv);
    dom.aiHistory.scrollTop = dom.aiHistory.scrollHeight;

    showNotification('AI code generated!', 'success');
});

socket.on('ai-error', (msg) => {
    dom.aiLoading.classList.add('hidden');
    dom.aiSubmitBtn.disabled = false;
    if (dom.aiReviewBtn) dom.aiReviewBtn.disabled = false;
    isAiGenerating = false;
    showNotification(msg);

    const errorDiv = document.createElement('div');
    errorDiv.className = 'ai-response-bubble text-red-400 text-xs';
    errorDiv.textContent = 'âŒ ' + msg;
    dom.aiHistory.appendChild(errorDiv);
});

// AI Code Review result
socket.on('ai-review-result', ({ review, user }) => {
    dom.aiLoading.classList.add('hidden');
    dom.aiSubmitBtn.disabled = false;
    if (dom.aiReviewBtn) dom.aiReviewBtn.disabled = false;
    isAiGenerating = false;

    const responseDiv = document.createElement('div');
    responseDiv.className = 'ai-response-bubble text-gray-200 text-xs';

    const header = document.createElement('div');
    header.innerHTML = '<span class="text-blue-400 font-bold">ðŸ” Code Review</span>';
    header.style.marginBottom = '8px';
    responseDiv.appendChild(header);

    const content = document.createElement('div');
    content.style.whiteSpace = 'pre-wrap';
    content.style.lineHeight = '1.6';
    content.textContent = review;
    responseDiv.appendChild(content);

    dom.aiHistory.appendChild(responseDiv);
    dom.aiHistory.scrollTop = dom.aiHistory.scrollHeight;

    showNotification('ðŸ” Code review complete!', 'success');
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// â”€â”€â”€ Time-Travel History Listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
socket.on('history-list', (history) => {
    if (!dom.historyList) return;
    if (!history || history.length === 0) {
        dom.historyList.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No snapshots yet. Start editing to create history.</p>';
        return;
    }
    dom.historyList.innerHTML = '';
    history.slice().reverse().forEach((snap, reverseIdx) => {
        const realIndex = history.length - 1 - reverseIdx;

        // Diff logic to see what changed
        const prevSnap = history[realIndex - 1];
        let changedFiles = [];
        if (!prevSnap || snap.html !== prevSnap.html) changedFiles.push('HTML');
        if (!prevSnap || snap.css !== prevSnap.css) changedFiles.push('CSS');
        if (!prevSnap || snap.js !== prevSnap.js) changedFiles.push('JS');

        const changedText = (!prevSnap) ? 'Initial code' : (changedFiles.length ? 'Changed: ' + changedFiles.join(', ') : 'No changes');
        const badgeHtml = snap.manual ? `<span class="bg-blue-500/20 text-blue-400 text-[9px] px-1.5 py-0.5 rounded font-medium">Manual</span>` : `<span class="bg-gray-700/50 text-gray-400 text-[9px] px-1.5 py-0.5 rounded">Auto</span>`;

        const time = new Date(snap.timestamp);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const item = document.createElement('div');
        item.className = 'bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 hover:border-white/[0.15] transition-colors cursor-default';
        item.innerHTML = `
                    <div class="flex items-center justify-between mb-1.5">
                        <div class="flex items-center gap-2">
                            <span class="text-zinc-300 text-xs font-mono font-medium">${timeStr}</span>
                            ${badgeHtml}
                        </div>
                        <span class="text-gray-400 text-[10px] flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
                            </svg>
                            ${snap.user}
                        </span>
                    </div>
                    <div class="flex items-center justify-between mb-3">
                        <div class="text-gray-400 text-[11px] font-medium max-w-[65%] truncate" title="${changedText}">
                            ${changedText}
                        </div>
                        <div class="text-gray-500 text-[10px] font-mono">#${realIndex + 1}</div>
                    </div>
                    <div class="flex gap-2">
                        <button class="view-diff-btn flex-1 text-center bg-white/[0.04] border border-white/[0.08] text-zinc-400 text-[11px] py-1.5 rounded-md hover:bg-white hover:text-black transition-all font-semibold flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-white/[0.2]">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            View
                        </button>
                        <button class="restore-btn flex-1 text-center bg-white/[0.04] border border-white/[0.08] text-zinc-400 text-[11px] py-1.5 rounded-md hover:bg-white hover:text-black transition-all font-semibold flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-white/[0.2]">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                            </svg>
                            Restore
                        </button>
                    </div>
                `;

        item.querySelector('.view-diff-btn').addEventListener('click', () => {
            showDiffModal(snap, prevSnap, realIndex + 1);
        });

        item.querySelector('.restore-btn').addEventListener('click', () => {
            showConfirmModal(
                'Restore Snapshot',
                'Are you sure you want to restore this snapshot? This will replace the current code for all users in the room.',
                () => {
                    socket.emit('restore-snapshot', { roomId: currentRoomId, index: realIndex });
                    dom.historyPanel.classList.add('hidden');
                }
            );
        });
        dom.historyList.appendChild(item);
    });
});

socket.on('snapshot-restored', ({ user, timestamp }) => {
    showNotification(`â±ï¸ ${user} restored a snapshot from ${new Date(timestamp).toLocaleTimeString()}`, 'info');
});

// â”€â”€â”€ Code Change Handler (debounced, sends to server) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleCodeChange(lang, value) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (currentRoomId) {
            socket.emit('code-change', { roomId: currentRoomId, lang, value });
        }
        updateIframe();
    }, 300);
}

// â”€â”€â”€ Chat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = dom.chatInput.value.trim();
    console.log("Sending message:", text, "Room:", currentRoomId);
    if (!text || !currentRoomId) {
        console.error("Missing text or room ID");
        return;
    }

    socket.emit('send-message', { roomId: currentRoomId, text });
    dom.chatInput.value = '';
};

function renderMessage(data) {
    const isMe = data.senderUid === localUser.uid;
    const msgContainer = document.createElement('div');
    msgContainer.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
    const bubble = document.createElement('div');
    bubble.className = `px-3 py-2 rounded-lg max-w-xs text-white ${isMe ? 'bg-white/[0.1] border border-white/[0.08]' : 'bg-white/[0.04] border border-white/[0.06]'}`;
    if (!isMe) {
        const sender = document.createElement('div');
        sender.className = 'text-xs font-bold text-zinc-400';
        sender.textContent = data.senderName;
        bubble.appendChild(sender);
    }
    const msgText = document.createElement('p');
    msgText.className = 'text-sm break-words';
    msgText.textContent = data.text;
    bubble.appendChild(msgText);
    msgContainer.appendChild(bubble);
    dom.chatMessages.appendChild(msgContainer);
}

// â”€â”€â”€ iframe Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function updateIframe() {
    if (!htmlEditor || !cssEditor || !jsEditor) return;
    // Clear any pending heartbeat timer
    if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }

    const consoleScript = `
        <scr` + `ipt>const f=a=>{if(a instanceof Error)return a.stack||a.message;if(typeof a==='object'&&a!==null)try{return JSON.stringify(a)}catch(e){return'[Unserializable]'}return String(a)};const o=(m,t)=>{const c=console[m];console[m]=(...a)=>{window.parent.postMessage({s:'iframe-console',t,m:a.map(f).join(' ')},'*');c.apply(console,a)}};['log','error','warn','info'].forEach(m=>o(m,m));window.addEventListener('error',e=>window.parent.postMessage({s:'iframe-console',t:'error',m:e.message},'*'));</scr` + `ipt>`;

    const jsCode = isSafeModeOn ? '// Safe Mode: JS execution disabled' : jsEditor.getValue();
    const heartbeatScript = isSafeModeOn ? '' : '<scr' + 'ipt>window.parent.postMessage({s:"iframe-heartbeat"},"*");</scr' + 'ipt>';
    const content = '<html><head><style>' + cssEditor.getValue() + '</style>' + consoleScript + '</head><body>' + htmlEditor.getValue() + '<scr' + 'ipt>try{' + jsCode + '}catch(e){console.error(e);}</scr' + 'ipt>' + heartbeatScript + '</body></html>';
    dom.output.srcdoc = content;

    // Start heartbeat timer (only if JS is enabled)
    if (!isSafeModeOn) {
        heartbeatTimer = setTimeout(() => {
            // No heartbeat received â€” iframe is likely frozen
            dom.output.srcdoc = `<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;background:#1e293b;color:#f87171;"><div style="text-align:center"><h2>âš ï¸ Script Killed</h2><p>Possible infinite loop detected. JS execution was stopped.</p><p style="color:#94a3b8;font-size:14px">Toggle Safe Mode to preview without JS.</p></div></body></html>`;
            showNotification('âš ï¸ Script killed â€” possible infinite loop detected!', 'error');
        }, 5000);
    }
}

function handleConsoleMessage({ source, data }) {
    if (!data || typeof data !== 'object') return;

    // Handle heartbeat
    if (data.s === 'iframe-heartbeat') {
        if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
        return;
    }

    if (source !== dom.output.contentWindow || data.s !== 'iframe-console') return;
    const logEntry = document.createElement('div');
    logEntry.textContent = data.m;
    logEntry.className = `console-${data.t}`;
    logEntry.innerHTML = `<span class="text-gray-500 mr-2">&gt;</span>` + logEntry.innerHTML;
    dom.console.appendChild(logEntry);
    dom.console.scrollTop = dom.console.scrollHeight;

    // Send console output to server so AI can see it
    if (currentRoomId) {
        socket.emit('console-log', { roomId: currentRoomId, type: data.t, message: data.m });
    }
}

// ─── Participants Display ──────────────────────────────────
function updateParticipants(participants) {
    currentParticipants = participants;

    // Update badge and count text
    if (dom.participantCountBadge) dom.participantCountBadge.textContent = participants.length;
    if (dom.participantOnlineCount) dom.participantOnlineCount.textContent = `${participants.length} member${participants.length !== 1 ? 's' : ''} present`;

    // 1. Header chips (simplified version)
    dom.participants.innerHTML = '';
    participants.slice(0, 3).forEach(p => {
        const chip = document.createElement('div');
        chip.className = 'w-6 h-6 rounded-full border border-[#0a0a0a] flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white';
        chip.style.backgroundColor = getCursorColor(p.uid);
        chip.textContent = p.name.charAt(0).toUpperCase();
        chip.title = p.name;
        dom.participants.appendChild(chip);
    });
    if (participants.length > 3) {
        const more = document.createElement('div');
        more.className = 'w-6 h-6 rounded-full border border-[#0a0a0a] bg-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-400';
        more.textContent = `+${participants.length - 3}`;
        dom.participants.appendChild(more);
    }

    // 2. Full panel list
    if (dom.participantsFullList) {
        dom.participantsFullList.innerHTML = '';
        participants.forEach(p => {
            const isMe = p.uid === localUser.uid;
            const item = document.createElement('div');
            item.className = 'flex items-center justify-between bg-white/[0.03] border border-white/[0.06] p-3 rounded-xl hover:border-white/[0.1] transition-all';

            const left = document.createElement('div');
            left.className = 'flex items-center gap-3';

            const avatar = document.createElement('div');
            avatar.className = 'w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg';
            avatar.style.backgroundColor = getCursorColor(p.uid);
            avatar.textContent = p.name.charAt(0).toUpperCase();

            const info = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'text-sm font-semibold text-white flex items-center gap-2';
            name.textContent = p.name;
            if (isMe) {
                const badge = document.createElement('span');
                badge.className = 'bg-blue-500/10 text-blue-500 text-[10px] px-1.5 py-0.5 rounded-md';
                badge.textContent = 'You';
                name.appendChild(badge);
            }

            const status = document.createElement('div');
            status.className = 'text-[10px] text-zinc-500 font-medium';
            status.textContent = 'Active now';

            info.appendChild(name);
            info.appendChild(status);
            left.appendChild(avatar);
            left.appendChild(info);
            item.appendChild(left);

            if (!isMe) {
                const right = document.createElement('div');
                right.className = 'flex flex-col items-end gap-1.5';

                const voteBtn = document.createElement('button');
                const voteData = activeVotes[p.uid] || { count: 0, required: Math.max(2, Math.ceil(participants.length / 2)) };

                const hasVoted = false; // We don't track who voted specifically on client yet, but we could

                voteBtn.className = `px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${voteData.count > 0 ? 'bg-red-500 text-white border-red-500' : 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20'}`;
                voteBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm-1-7a1 1 0 00-1 1v3a1 1 0 002 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                            Vote Kick (${voteData.count}/${voteData.required})
                        `;
                voteBtn.onclick = () => voteKick(p.uid);

                right.appendChild(voteBtn);
                item.appendChild(right);
            }

            dom.participantsFullList.appendChild(item);
        });
    }
}

function voteKick(targetUid) {
    if (!currentRoomId) return;
    socket.emit('vote-kick', { roomId: currentRoomId, targetUid });
}

// â”€â”€â”€ AI Prompt Submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleAiSubmit(e) {
    e.preventDefault();
    const prompt = dom.aiInput.value.trim();
    if (!prompt || !currentRoomId || isAiGenerating) return;

    socket.emit('ai-generate', { roomId: currentRoomId, prompt });
    dom.aiInput.value = '';
}

// â”€â”€â”€ Panel Toggles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toggleAi() {
    const panel = document.getElementById('ai-panel');
    if (!panel) return;

    panel.classList.toggle('active');
    isAiOpen = panel.classList.contains('active');

    // Force display to ensure visibility
    panel.style.display = isAiOpen ? 'flex' : 'none';

    // Exclusive panels: Close Chat and Notifications if opening AI
    if (isAiOpen) {
        const chatPanel = document.getElementById('chat-panel');
        if (chatPanel && chatPanel.classList.contains('active')) toggleChat();

        const notifPanel = document.getElementById('notif-panel');
        if (notifPanel && notifPanel.classList.contains('active')) toggleNotifications();

        const participantsPanel = dom.participantsPanel;
        if (participantsPanel && participantsPanel.classList.contains('active')) toggleParticipants();

        setTimeout(() => {
            const input = document.getElementById('ai-input');
            if (input) input.focus();
        }, 100);
    }
}

function toggleChat() {
    const panel = document.getElementById('chat-panel');
    if (!panel) { alert('ERROR: chat-panel not found!'); return; }

    panel.classList.toggle('active');
    isChatOpen = panel.classList.contains('active');

    // Force display to ensure visibility
    panel.style.display = isChatOpen ? 'flex' : 'none';

    if (isChatOpen) {
        // Reset chat badge
        unreadChatCount = 0;
        if (dom.chatBadge) dom.chatBadge.classList.add('hidden');

        // Exclusive panels: Close others
        const aiPanel = document.getElementById('ai-panel');
        if (aiPanel && aiPanel.classList.contains('active')) toggleAi();

        const notifPanel = document.getElementById('notif-panel');
        if (notifPanel && notifPanel.classList.contains('active')) toggleNotifications();

        const participantsPanel = dom.participantsPanel;
        if (participantsPanel && participantsPanel.classList.contains('active')) toggleParticipants();

        setTimeout(() => {
            const input = document.getElementById('chat-input');
            if (input) input.focus();
        }, 100);
    }
}

function toggleNotifications() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;

    panel.classList.toggle('active');
    isNotifOpen = panel.classList.contains('active');

    panel.style.display = isNotifOpen ? 'flex' : 'none';

    if (isNotifOpen) {
        // Reset notification badge
        unreadNotifCount = 0;
        if (dom.notifBadge) dom.notifBadge.classList.add('hidden');

        // Exclusive panels: Close others
        const chatPanel = document.getElementById('chat-panel');
        if (chatPanel && chatPanel.classList.contains('active')) toggleChat();

        const aiPanel = document.getElementById('ai-panel');
        if (aiPanel && aiPanel.classList.contains('active')) toggleAi();

        const participantsPanel = dom.participantsPanel;
        if (participantsPanel && participantsPanel.classList.contains('active')) toggleParticipants();
    }
}

function toggleParticipants() {
    const panel = dom.participantsPanel;
    if (!panel) return;

    panel.classList.toggle('active');
    isParticipantsOpen = panel.classList.contains('active');

    panel.style.display = isParticipantsOpen ? 'flex' : 'none';

    if (isParticipantsOpen) {
        // Exclusive panels: Close others
        const chatPanel = document.getElementById('chat-panel');
        if (chatPanel && chatPanel.classList.contains('active')) toggleChat();

        const aiPanel = document.getElementById('ai-panel');
        if (aiPanel && aiPanel.classList.contains('active')) toggleAi();

        const notifPanel = document.getElementById('notif-panel');
        if (notifPanel && notifPanel.classList.contains('active')) toggleNotifications();

        updateParticipants(currentParticipants);
    }
}

// â”€â”€â”€ Panel Resizing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initResizing() {
    let isResizing = false;

    const startResize = (e) => {
        // Ensure we handle both mouse and touch events
        const event = e.touches ? e.touches[0] : e;
        if (e.cancelable) e.preventDefault();

        isResizing = true;
        dom.resizer.classList.add('active');
        document.body.classList.add('resizing');
    };

    const doResize = (e) => {
        if (!isResizing) return;
        const event = e.touches ? e.touches[0] : e;

        const wrapper = dom.contentWrapper.getBoundingClientRect();
        const clientX = event.clientX;
        const editorWidth = clientX - wrapper.left;
        const outputWidth = wrapper.width - editorWidth - dom.resizer.offsetWidth;

        // Keep both panels at a reasonable minimum width
        if (editorWidth > 100 && outputWidth > 100) {
            dom.editorPanel.style.flexBasis = `${editorWidth}px`;
            dom.outputPanel.style.flexBasis = `${outputWidth}px`;
        }
    };

    const stopResize = () => {
        if (isResizing) {
            isResizing = false;
            dom.resizer.classList.remove('active');
            document.body.classList.remove('resizing');
            refreshEditors();
        }
    };

    // Mousedown / Touchstart
    dom.resizer.addEventListener('mousedown', startResize);
    dom.resizer.addEventListener('touchstart', startResize, { passive: false });

    // Mousemove / Touchmove
    document.addEventListener('mousemove', doResize);
    document.addEventListener('touchmove', doResize, { passive: false });

    // Mouseup / Touchend
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchend', stopResize);
}



// â”€â”€â”€ Download as ZIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleDownload() {
    const zip = new JSZip();
    const htmlContent = `<!DOCTYPE html>\n<html>\n<head>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n${htmlEditor.getValue()}\n  <script src="script.js"><\/script>\n</body>\n</html>`;
    zip.file("index.html", htmlContent);
    zip.file("style.css", cssEditor.getValue());
    zip.file("script.js", jsEditor.getValue());
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "code-collab-project.zip";
    link.click();
    URL.revokeObjectURL(link.href);
}

// â”€â”€â”€ Popout Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handlePopout() {
    const content = `<html><head><title>Output</title><style>${cssEditor.getValue()}<\/style></head><body>${htmlEditor.getValue()}<script>${jsEditor.getValue()}<\/script></body></html>`;
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}

function refreshEditors() {
    setTimeout(() => {
        if (htmlEditor) htmlEditor.refresh();
        if (cssEditor) cssEditor.refresh();
        if (jsEditor) jsEditor.refresh();
    }, 10);
}

// â”€â”€â”€ Leave Room â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function leaveRoom() {
    if (currentRoomId) {
        socket.emit('leave-room');
    }

    // Clean up all event listeners
    editorCleanupFns.forEach(fn => fn());
    editorCleanupFns = [];

    currentRoomId = null;
    localUser = null;
    window.location.hash = '';

    // Reset UI states
    resetAiHistory();
    dom.chatMessages.innerHTML = '';

    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('message', handleConsoleMessage);

    showView('home');
}

function handleBeforeUnload() {
    if (currentRoomId) {
        socket.emit('leave-room');
    }
}



// â”€â”€â”€ Start the App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
initializeApp();

// â”€â”€â”€ Scroll Reveal Animations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', () => {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal').forEach(el => {
        observer.observe(el);
    });
});
