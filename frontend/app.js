/**
 * Codependal - Frontend Client Application Logic
 *
 * Implements real-time collaboration via Socket.IO, active cursor synchronization,
 * sandboxed iframe previews with console proxies, history diff checks, ZIP exports,
 * and AI-driven pair programming.
 *
 * Organized cleanly for human readability and high maintainability.
 */

// ==========================================
// 1. GLOBAL STATE & CONNECTION MANAGEMENT
// ==========================================

// Global error catcher for runtime debugging
window.onerror = function (msg, url, line, col, error) {
    console.error('[Codependal IDE] JS Error at line ' + line + ': ' + msg);
    return false;
};

// backend routing determination
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://codecollab-backend-ya9c.onrender.com';

const socket = io(BACKEND_URL);

/**
 * Generates a unique user identifier replacing simple anonymous authentication.
 * @returns {string} UUIDv4 string
 */
function generateUID() {
    return crypto.randomUUID();
}

// ==========================================
// 2. DOM ELEMENT MAPPING
// ==========================================
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

// Trackers and Active Parameters
let editorCleanupFns = [];
let currentRoomId = null;
let localUser = null;
let debounceTimer = null;
let htmlEditor, cssEditor, jsEditor;
let isChatOpen = false;
let isAiOpen = false;
let isNotifOpen = false;
let isParticipantsOpen = false;
let isRemoteUpdate = false; // prevents recursive loop updates
let isAiGenerating = false;
let isSafeModeOn = false;
let heartbeatTimer = null;
let currentParticipants = [];
let activeVotes = {}; 
let unreadChatCount = 0;
let unreadNotifCount = 0;
let notifications = [];
let activityEditTimers = {}; // edit activity debounce

// ==========================================
// 3. UTILITY & NOTIFICATION SYSTEMS
// ==========================================

/**
 * Toggles active view panels.
 * @param {string} viewName 'home' or 'editor'
 */
function showView(viewName) {
    dom.home.style.display = viewName === 'home' ? 'flex' : 'none';
    dom.editor.style.display = viewName === 'editor' ? 'flex' : 'none';
}

/**
 * Displays sleek glowing toast notifications at the top right of the page.
 * @param {string} message Text to display
 * @param {string} type 'success' | 'info' | 'error'
 */
function showNotification(message, type = 'error') {
    dom.notification.textContent = message;
    
    // Aesthetic HSL gradient outlines
    const bgClass = {
        error: 'bg-zinc-950/95 dark:bg-zinc-900/95 border-red-500/35 text-white',
        info: 'bg-zinc-900/95 dark:bg-white/95 border-zinc-700/20 text-white dark:text-black',
        success: 'bg-zinc-900/95 dark:bg-white/95 border-zinc-700/20 text-white dark:text-black'
    }[type] || 'bg-zinc-950/95 border-red-500/35 text-white';

    dom.notification.className = `fixed top-5 right-5 text-sm font-semibold py-3 px-5 rounded-xl border z-50 shadow-2xl transition-all duration-300 transform scale-95 opacity-0 ${bgClass}`;
    dom.notification.style.display = 'block';

    // Force repaint to guarantee CSS transition triggers
    dom.notification.getBoundingClientRect();
    dom.notification.style.opacity = '1';
    dom.notification.style.transform = 'scale(1)';

    setTimeout(() => {
        dom.notification.style.opacity = '0';
        dom.notification.style.transform = 'scale(0.95)';
        setTimeout(() => { dom.notification.style.display = 'none'; }, 300);
    }, 3000);
}

/**
 * Requests the user's name via a modern blur modal.
 * @param {string} title Modal heading description
 * @returns {Promise<string|null>}
 */
function askForName(title) {
    return new Promise(resolve => {
        dom.modalTitle.textContent = title;
        dom.nameInput.value = '';
        dom.modal.style.display = 'flex';

        const onConfirm = () => {
            const val = dom.nameInput.value.trim();
            if (val) {
                cleanup();
                resolve(val);
            }
        };

        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        const onKeypress = e => {
            if (e.key === 'Enter') onConfirm();
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

/**
 * Generates an HSL avatar color from a string.
 * @param {string} s User Name
 * @returns {string} HEX color string
 */
function stringToColor(s) {
    if (!s) return '#71717a';
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ['#18181b', '#27272a', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8', '#e4e4e7'];
    return colors[Math.abs(hash) % colors.length];
}

// ==========================================
// 4. THEME & WORKSPACE SWITCHERS
// ==========================================

function initializeTheme() {
    document.documentElement.classList.add('dark');
    localStorage.theme = 'dark';
}

/**
 * Toggles and records dark/light system variables.
 */
function toggleTheme() {
    document.documentElement.classList.add('dark');
    localStorage.theme = 'dark';
}

/**
 * Manages active workspace tabs, enabling full heights for selected panels.
 * Attached to window object for index.html onclick mapping.
 * @param {string} lang 'html' | 'css' | 'js' | 'split'
 */
window.switchEditorTab = function(lang) {
    const tabs = ['html', 'css', 'js', 'split'];
    const editorsWindow = document.getElementById('editors-window');
    
    if (!editorsWindow) return;

    // Toggle active state classes on tab buttons
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            if (t === lang) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });

    if (lang === 'split') {
        // Apply responsive grid layout for all editors
        editorsWindow.classList.add('editor-grid-view');
        ['html', 'css', 'js'].forEach(t => {
            const pane = document.getElementById(`pane-${t}`);
            if (pane) pane.classList.remove('hidden');
        });
    } else {
        // Toggle single active pane
        editorsWindow.classList.remove('editor-grid-view');
        ['html', 'css', 'js'].forEach(t => {
            const pane = document.getElementById(`pane-${t}`);
            if (pane) {
                if (t === lang) {
                    pane.classList.remove('hidden');
                } else {
                    pane.classList.add('hidden');
                }
            }
        });
    }

    // Refresh viewport bounds for CodeMirror layers
    refreshEditors();
};

/**
 * Triggers refresh recalculation for active CodeMirror viewports.
 */
function refreshEditors() {
    setTimeout(() => {
        if (htmlEditor) htmlEditor.refresh();
        if (cssEditor) cssEditor.refresh();
        if (jsEditor) jsEditor.refresh();
    }, 20);
}

// ==========================================
// 5. APPLICATION INITIALIZATION
// ==========================================
function initializeApp() {
    initializeTheme();
    const roomId = window.location.hash.substring(1);
    if (roomId) {
        handleJoinRoom(roomId);
    } else {
        showView('home');
    }
    
    // Hash change handler for routing navigation back home
    window.addEventListener('hashchange', () => {
        if (!window.location.hash.substring(1)) {
            leaveRoom();
        }
    });
    
    initResizing();
}

// ==========================================
// 6. ROOM ACTIONS & CONNECTORS
// ==========================================

/**
 * Handles creation of public or private collaborative rooms.
 * @param {boolean} isPublic Room visibility status
 */
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
        showNotification("Could not create collaborative room.");
    }
};

dom.createPrivateBtn.addEventListener('click', () => handleCreateRoom(false));
dom.createPublicBtn.addEventListener('click', () => handleCreateRoom(true));

// Connects to a random public lobby
dom.joinRandomBtn.addEventListener('click', async () => {
    showNotification("Finding a public lobby...", "info");

    try {
        const res = await fetch(`${BACKEND_URL}/api/rooms/random/public`);
        if (res.ok) {
            const data = await res.json();
            handleJoinRoom(data.roomId);
        } else {
            showNotification("No public lobbies active. Why not create one?", "info");
        }
    } catch (e) {
        console.error("Lobby search error:", e);
        showNotification("Lobby lookup failed. Try again.");
    }
});

// Joins room via pasted code ID
dom.joinBtn.addEventListener('click', () => {
    const id = dom.roomIdInput.value.trim();
    if (id) handleJoinRoom(id);
    else showNotification("Please input a valid Room Code.");
});

/**
 * Performs validation checks and joins a target room.
 * @param {string} roomId Lobbey key
 */
async function handleJoinRoom(roomId) {
    try {
        const res = await fetch(`${BACKEND_URL}/api/rooms/${roomId}`);
        if (!res.ok) {
            showNotification("Lobby not found!");
            window.location.hash = '';
            return;
        }
        const name = await askForName('Enter Your Nickname to Join');
        if (!name) {
            window.location.hash = '';
            return;
        }
        localUser = { uid: generateUID(), name };
        window.location.hash = roomId;
        enterEditor(roomId);
    } catch (e) {
        console.error("Lobby join error:", e);
        showNotification("Could not establish lobby connection.");
        window.location.hash = '';
    }
}

// ==========================================
// 7. TIME-TRAVEL COMPONENT INTERFACE
// ==========================================
const diffModal = document.getElementById('diff-modal');
const diffModalCloseBtn = document.getElementById('diff-modal-close');

diffModalCloseBtn.addEventListener('click', () => {
    diffModal.classList.add('hidden');
});

/**
 * Renders structured visual diff comparisons between code snapshots.
 */
function showDiffModal(currentSnap, previousSnap, indexNum) {
    document.getElementById('diff-modal-title').textContent = `Snapshot Version #${indexNum}`;
    const dateStr = new Date(currentSnap.timestamp).toLocaleString();
    document.getElementById('diff-modal-subtitle').textContent = `Captured by ${currentSnap.user} at ${dateStr}`;

    const diffContent = document.getElementById('diff-content');
    diffContent.innerHTML = '';

    const langs = ['html', 'css', 'js'];
    let hasDiff = false;

    langs.forEach(lang => {
        const oldVal = previousSnap ? previousSnap[lang] : '';
        const newVal = currentSnap[lang];

        if (oldVal === newVal && previousSnap) return; // Skip if no edits made

        hasDiff = true;

        // Code block header
        const heading = document.createElement('div');
        heading.className = 'bg-zinc-150 dark:bg-zinc-900 border-y border-zinc-200 dark:border-white/[0.05] text-zinc-800 dark:text-zinc-300 px-5 py-2.5 text-xs font-bold uppercase tracking-wider sticky top-0 z-10';
        heading.textContent = lang.toUpperCase();
        diffContent.appendChild(heading);

        const codeWrapper = document.createElement('pre');
        codeWrapper.className = 'w-full m-0 p-3 overflow-x-auto text-xs leading-relaxed font-mono';

        if (!window.Diff) {
            codeWrapper.textContent = newVal;
            diffContent.appendChild(codeWrapper);
            return;
        }

        // Render line diff indicators
        const edits = Diff.diffLines(oldVal, newVal);
        edits.forEach(segment => {
            const hasNL = segment.value.endsWith('\n');
            const sanitized = hasNL ? segment.value.slice(0, -1) : segment.value;

            if (!sanitized) return;

            const lines = sanitized.split('\n');
            lines.forEach(line => {
                const row = document.createElement('div');
                row.className = 'px-4 py-0.5 min-w-max whitespace-pre flex items-center';
                
                const indicator = document.createElement('span');
                indicator.className = 'inline-block w-6 text-center select-none font-bold mr-2 text-xs';

                if (segment.added) {
                    row.classList.add('bg-emerald-500/10', 'text-emerald-700', 'dark:text-emerald-455');
                    indicator.textContent = '+';
                    indicator.className += ' text-emerald-500';
                } else if (segment.removed) {
                    row.classList.add('bg-red-500/10', 'text-red-700', 'dark:text-red-455');
                    indicator.textContent = '-';
                    indicator.className += ' text-red-500';
                } else {
                    row.classList.add('text-zinc-600', 'dark:text-zinc-400');
                    indicator.textContent = ' ';
                }

                row.appendChild(indicator);
                row.appendChild(document.createTextNode(line));
                codeWrapper.appendChild(row);
            });
        });

        diffContent.appendChild(codeWrapper);
    });

    if (!hasDiff) {
        diffContent.innerHTML = '<div class="text-center text-zinc-550 py-12">No files modified in this version snapshot.</div>';
    }

    diffModal.classList.remove('hidden');
}

/**
 * Triggers interactive modal confirmation dialogues.
 */
function showConfirmModal(title, msg, onOk) {
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = msg;
    dom.confirmModal.classList.remove('hidden');

    const handleOk = () => {
        cleanup();
        onOk();
    };
    
    const handleCancel = () => cleanup();

    const cleanup = () => {
        dom.confirmModal.classList.add('hidden');
        dom.confirmOkBtn.removeEventListener('click', handleOk);
        dom.confirmCancelBtn.removeEventListener('click', handleCancel);
    };

    dom.confirmOkBtn.addEventListener('click', handleOk);
    dom.confirmCancelBtn.addEventListener('click', handleCancel);
}

// ==========================================
// 8. EDITOR INITIALIZATION & COLLABORATION
// ==========================================
const currentThemeKey = localStorage.getItem('cc-editor-theme') || 'material-darker';

/**
 * Configures instances for HTML, CSS, and JS editor buffers.
 */
function initializeEditors() {
    const defaultOptions = { 
        theme: currentThemeKey, 
        lineNumbers: true,
        lineWrapping: true
    };
    
    htmlEditor = CodeMirror.fromTextArea(document.getElementById('html-editor'), {
        ...defaultOptions, 
        mode: 'xml',
        autoCloseTags: true
    });
    
    cssEditor = CodeMirror.fromTextArea(document.getElementById('css-editor'), { 
        ...defaultOptions, 
        mode: 'css' 
    });
    
    jsEditor = CodeMirror.fromTextArea(document.getElementById('js-editor'), { 
        ...defaultOptions, 
        mode: 'javascript' 
    });

    const selector = document.getElementById('theme-selector');
    if (selector) selector.value = currentThemeKey;
}

/**
 * Updates themes dynamically across active editors.
 * @param {string} key IDE theme identifier
 */
function changeEditorTheme(key) {
    if (htmlEditor) htmlEditor.setOption('theme', key);
    if (cssEditor) cssEditor.setOption('theme', key);
    if (jsEditor) jsEditor.setOption('theme', key);
    localStorage.setItem('cc-editor-theme', key);
}

document.getElementById('theme-selector').addEventListener('change', (e) => {
    changeEditorTheme(e.target.value);
});

/**
 * Transitions application from Home landing to the main workspace workspace.
 * @param {string} roomId Room Code ID
 */
function enterEditor(roomId) {
    currentRoomId = roomId;
    showView('editor');
    dom.roomIdDisplay.textContent = roomId;
    
    if (!htmlEditor) initializeEditors();

    // Default workspace to standard HTML single tab
    window.switchEditorTab('html');

    // Notify backend
    socket.emit('join-room', { roomId, user: localUser });

    // Synchronization event triggers (local changes mapped to socket events)
    const onHtmlEdit = () => { if (!isRemoteUpdate) handleCodeChange('html', htmlEditor.getValue()); };
    htmlEditor.on('change', onHtmlEdit);
    editorCleanupFns.push(() => htmlEditor.off('change', onHtmlEdit));

    const onCssEdit = () => { if (!isRemoteUpdate) handleCodeChange('css', cssEditor.getValue()); };
    cssEditor.on('change', onCssEdit);
    editorCleanupFns.push(() => cssEditor.off('change', onCssEdit));

    const onJsEdit = () => { if (!isRemoteUpdate) handleCodeChange('js', jsEditor.getValue()); };
    jsEditor.on('change', onJsEdit);
    editorCleanupFns.push(() => jsEditor.off('change', onJsEdit));

    // Throttled cursor sharing logic
    let throttles = {};
    const broadcastCursor = (lang, editorInstance) => {
        if (throttles[lang]) return;
        throttles[lang] = setTimeout(() => { throttles[lang] = null; }, 50);
        
        const loc = editorInstance.getCursor();
        socket.emit('cursor-move', { roomId, lang, line: loc.line, ch: loc.ch });
    };

    const htmlCursor = () => broadcastCursor('html', htmlEditor);
    htmlEditor.on('cursorActivity', htmlCursor);
    editorCleanupFns.push(() => htmlEditor.off('cursorActivity', htmlCursor));

    const cssCursor = () => broadcastCursor('css', cssEditor);
    cssEditor.on('cursorActivity', cssCursor);
    editorCleanupFns.push(() => cssEditor.off('cursorActivity', cssCursor));

    const jsCursor = () => broadcastCursor('js', jsEditor);
    jsEditor.on('cursorActivity', jsCursor);
    editorCleanupFns.push(() => jsEditor.off('cursorActivity', jsCursor));

    // Submit Chat message triggers
    dom.chatForm.addEventListener('submit', handleSendMessage);
    editorCleanupFns.push(() => dom.chatForm.removeEventListener('submit', handleSendMessage));
    
    // AI submission actions
    dom.aiForm.addEventListener('submit', handleAiSubmit);
    editorCleanupFns.push(() => dom.aiForm.removeEventListener('submit', handleAiSubmit));
    
    // AI Review trigger callback
    const onAiReview = () => {
        if (!currentRoomId || isAiGenerating) return;
        isAiGenerating = true;
        dom.aiSubmitBtn.disabled = true;
        dom.aiReviewBtn.disabled = true;
        
        socket.emit('ai-review', { roomId: currentRoomId });

        const pBox = document.createElement('div');
        pBox.className = 'ai-prompt-bubble text-xs';
        pBox.innerHTML = `<span class="font-bold">${localUser.name}:</span> 🔍 Request Code Review`;
        dom.aiHistory.appendChild(pBox);
        dom.aiHistory.scrollTop = dom.aiHistory.scrollHeight;
    };
    dom.aiReviewBtn.addEventListener('click', onAiReview);
    editorCleanupFns.push(() => dom.aiReviewBtn.removeEventListener('click', onAiReview));

    // Leave lobby trigger
    dom.leaveBtn.addEventListener('click', leaveRoom);
    editorCleanupFns.push(() => dom.leaveBtn.removeEventListener('click', leaveRoom));
    
    // Clear logs
    const onClearLogs = () => dom.console.innerHTML = '';
    dom.clearConsoleBtn.addEventListener('click', onClearLogs);
    editorCleanupFns.push(() => dom.clearConsoleBtn.removeEventListener('click', onClearLogs));

    // Export & preview handlers
    dom.downloadBtn.addEventListener('click', handleDownload);
    editorCleanupFns.push(() => dom.downloadBtn.removeEventListener('click', handleDownload));
    dom.popoutBtn.addEventListener('click', handlePopout);
    editorCleanupFns.push(() => dom.popoutBtn.removeEventListener('click', handlePopout));

    // Sandbox Toggle safe mode
    const onSafeModeToggle = () => {
        isSafeModeOn = !isSafeModeOn;
        dom.safeModeBtn.classList.toggle('bg-zinc-200', isSafeModeOn);
        dom.safeModeBtn.classList.toggle('dark:bg-zinc-800', isSafeModeOn);
        dom.safeModeBtn.classList.toggle('text-zinc-900', isSafeModeOn);
        dom.safeModeBtn.classList.toggle('dark:text-white', isSafeModeOn);
        dom.safeModeBtn.title = isSafeModeOn ? 'Safe Mode ACTIVE (JS Disabled)' : 'Toggle Sandbox Safe Mode';
        showNotification(isSafeModeOn ? '🛡️ Safe Mode ON — Sandboxed JS disabled' : '🛡️ Safe Mode OFF — JS execution active', 'info');
        updateIframe();
    };
    dom.safeModeBtn.addEventListener('click', onSafeModeToggle);
    editorCleanupFns.push(() => dom.safeModeBtn.removeEventListener('click', onSafeModeToggle));

    // Snapshot listing
    const onHistoryToggle = () => {
        dom.historyPanel.classList.toggle('hidden');
        if (!dom.historyPanel.classList.contains('hidden')) {
            socket.emit('get-history', { roomId });
        }
    };
    dom.historyBtn.addEventListener('click', onHistoryToggle);
    editorCleanupFns.push(() => dom.historyBtn.removeEventListener('click', onHistoryToggle));

    const onHistoryClose = () => dom.historyPanel.classList.add('hidden');
    dom.historyCloseBtn.addEventListener('click', onHistoryClose);
    editorCleanupFns.push(() => dom.historyCloseBtn.removeEventListener('click', onHistoryClose));

    const onSnapshotSave = () => socket.emit('save-snapshot-manual', { roomId });
    dom.saveSnapshotBtn.addEventListener('click', onSnapshotSave);
    editorCleanupFns.push(() => dom.saveSnapshotBtn.removeEventListener('click', onSnapshotSave));

    window.addEventListener('message', handleConsoleMessage);
    window.addEventListener('beforeunload', handleBeforeUnload);
}

// ==========================================
// 9. CLIENT SOCKET LISTENERS
// ==========================================

socket.on('room-state', (data) => {
    isRemoteUpdate = true;
    htmlEditor.setValue(data.html);
    cssEditor.setValue(data.css);
    jsEditor.setValue(data.js);
    isRemoteUpdate = false;
    
    if (data.uid && localUser) {
        localUser.uid = data.uid;
    }
    
    updateIframe();
    updateParticipants(data.participants);

    // Chat messages
    dom.chatMessages.innerHTML = '';
    data.messages.forEach(msg => renderMessage(msg));
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    resetAiHistory();
});

/**
 * Resets AI popup helper interface state.
 */
function resetAiHistory() {
    dom.aiHistory.innerHTML = `
        <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 flex items-start gap-2">
            <svg class="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div class="text-[10px] text-yellow-800 dark:text-yellow-200/80 leading-relaxed">
                <span class="font-bold block mb-0.5">Beta Sandbox Feature</span>
                Verify generated structures and dependencies prior to moving logic to production builds.
            </div>
        </div>
        <div class="ai-response-bubble text-xs">
            Hello! I am your collaborative AI companion. Ask me to write code snippets, analyze bugs, or refactor layouts! What shall we construct today?
        </div>
    `;
    dom.aiHistory.scrollTop = 0;
}

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

// ==========================================
// 10. REAL-TIME CURSOR SYNCHRONIZATION
// ==========================================
const remoteCursors = {};
const CURSOR_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#a855f7', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'];

/**
 * Returns distinct cursor color mapping per collaborator.
 */
function getCursorColor(uid) {
    let hash = 0;
    for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash);
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

socket.on('remote-cursor', ({ uid, name, lang, line, ch }) => {
    // Purge prior user cursor trackers
    if (remoteCursors[uid] && remoteCursors[uid].bookmark) {
        remoteCursors[uid].bookmark.clear();
    }

    const editor = lang === 'html' ? htmlEditor : lang === 'css' ? cssEditor : jsEditor;
    if (!editor) return;

    const hex = getCursorColor(uid);

    // Generate zero-width container
    const cursorContainer = document.createElement('span');
    cursorContainer.className = 'remote-cursor';

    // Hover line bar
    const indicatorBar = document.createElement('span');
    indicatorBar.className = 'remote-cursor-line';
    indicatorBar.style.backgroundColor = hex;

    // Glowing avatar banner label
    const banner = document.createElement('span');
    banner.className = 'remote-cursor-label';
    banner.textContent = name;
    banner.style.backgroundColor = hex;

    cursorContainer.appendChild(indicatorBar);
    cursorContainer.appendChild(banner);

    const bookmark = editor.setBookmark({ line, ch }, { widget: cursorContainer, insertLeft: true });
    remoteCursors[uid] = { bookmark, lang };

    // Fade names out automatically
    setTimeout(() => { if (banner) banner.style.opacity = '0'; }, 3000);
});

// ==========================================
// 11. PARTICIPANT ROLES & VOTE LOGIC
// ==========================================

socket.on('participants-update', (list) => {
    updateParticipants(list);
});

socket.on('vote-update', ({ targetUid, targetName, voterName, currentVotes, requiredVotes }) => {
    activeVotes[targetUid] = { count: currentVotes, required: requiredVotes };
    showNotification(`${voterName} voted to kick ${targetName} (${currentVotes}/${requiredVotes} recorded)`, 'info');
    updateParticipants(currentParticipants);
});

socket.on('user-kicked', ({ uid, name }) => {
    if (localUser && uid === localUser.uid) {
        alert('You have been removed from this room by majority ballot.');
        leaveRoom();
    } else {
        showNotification(`💀 ${name} was expelled from the session.`, 'error');
        delete activeVotes[uid];
        updateParticipants(currentParticipants);
    }
});

// ==========================================
// 12. CHAT & SYSTEM ALERTS
// ==========================================

socket.on('new-message', (msg) => {
    renderMessage(msg);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    // Trigger glowing indicator badge if closed
    if (!isChatOpen && localUser && msg.senderUid !== localUser.uid) {
        unreadChatCount++;
        if (dom.chatBadge) dom.chatBadge.classList.remove('hidden');
    }
});

// Notifications feed colors
const EVENT_COLORS = {
    join: '#10b981',
    leave: '#ef4444',
    edit: '#6366f1',
    snapshot: '#a855f7',
    restore: '#f59e0b'
};

function getNotifMessage(data) {
    switch (data.type) {
        case 'join': return `${data.user} entered the session`;
        case 'leave': return `${data.user} left the workspace`;
        case 'edit': return `${data.user} updated ${data.detail}`;
        case 'snapshot': return `${data.user} saved workspace state`;
        case 'restore': return `${data.user} restored a past snapshot`;
        default: return `${data.user} made changes`;
    }
}

function getRelativeTime(timestamp) {
    const gap = Date.now() - new Date(timestamp).getTime();
    const s = Math.floor(gap / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

function renderNotification(data) {
    if (dom.notifEmpty) dom.notifEmpty.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'notif-item';
    row.dataset.timestamp = data.timestamp;

    const statusDot = document.createElement('span');
    statusDot.className = 'notif-dot';
    statusDot.style.backgroundColor = EVENT_COLORS[data.type] || '#71717a';

    const shell = document.createElement('div');
    shell.className = 'flex-1 min-w-0';

    const p = document.createElement('p');
    p.className = 'text-xs text-zinc-800 dark:text-zinc-200 font-medium m-0';
    p.textContent = getNotifMessage(data);

    const time = document.createElement('span');
    time.className = 'text-[10px] text-zinc-400 dark:text-zinc-550 mt-1 block';
    time.textContent = getRelativeTime(data.timestamp);

    shell.appendChild(p);
    shell.appendChild(time);
    row.appendChild(statusDot);
    row.appendChild(shell);

    dom.notifList.insertBefore(row, dom.notifList.firstChild);

    while (dom.notifList.children.length > 51) {
        dom.notifList.removeChild(dom.notifList.lastChild);
    }
}

socket.on('activity', (data) => {
    if (data.type === 'edit') {
        const hashKey = `${data.user}_${data.detail}`;
        if (activityEditTimers[hashKey]) return; 
        
        activityEditTimers[hashKey] = setTimeout(() => {
            delete activityEditTimers[hashKey];
        }, 5000);
    }

    notifications.unshift(data);
    if (notifications.length > 50) notifications.pop();

    renderNotification(data);

    if (!isNotifOpen) {
        unreadNotifCount++;
        if (dom.notifBadge) dom.notifBadge.classList.remove('hidden');
    }
});

// Clear active activity records
if (dom.notifClearBtn) {
    dom.notifClearBtn.addEventListener('click', () => {
        notifications = [];
        const items = dom.notifList.querySelectorAll('.notif-item');
        items.forEach(el => el.remove());
        if (dom.notifEmpty) dom.notifEmpty.style.display = 'flex';
    });
}

// Refresh timestamps
setInterval(() => {
    const list = document.querySelectorAll('.notif-item');
    list.forEach(item => {
        const timeEl = item.querySelector('span:last-child');
        if (timeEl && item.dataset.timestamp) {
            timeEl.textContent = getRelativeTime(item.dataset.timestamp);
        }
    });
}, 30000);

socket.on('error-msg', (msg) => {
    showNotification(msg, 'error');
    if (dom.editor.style.display === 'flex' && !htmlEditor.getValue()) {
        leaveRoom();
    }
});

// ==========================================
// 13. INTEGRATED COILOT (AI ENDPOINTS)
// ==========================================

socket.on('ai-status', ({ status, prompt, user }) => {
    if (status === 'generating') {
        dom.aiLoading.classList.remove('hidden');
        dom.aiLoadingText.textContent = `${user} is querying assistant...`;
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

    // Output prompt
    const pBox = document.createElement('div');
    pBox.className = 'ai-prompt-bubble text-xs';
    pBox.innerHTML = `<span class="font-bold">${user}:</span> ${escapeHtml(prompt)}`;
    dom.aiHistory.appendChild(pBox);

    // Build Code blocks
    const rBox = document.createElement('div');
    rBox.className = 'ai-response-bubble text-xs';

    const check = document.createElement('div');
    check.className = 'font-bold text-emerald-500 mb-2 flex items-center gap-1';
    check.innerHTML = '<span>✅</span> Template Blocks Generated';
    rBox.appendChild(check);

    function createCodeBlock(label, val) {
        if (!val || !val.trim()) return null;
        
        const shell = document.createElement('div');
        shell.className = 'ai-code-wrapper';

        const bar = document.createElement('div');
        bar.className = 'ai-code-label';
        
        const span = document.createElement('span');
        span.textContent = label;
        
        const btn = document.createElement('button');
        btn.className = 'ai-code-copy-btn';
        btn.textContent = 'Copy Code';
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(val).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy Code'; }, 1500);
            });
        });
        
        bar.appendChild(span);
        bar.appendChild(btn);

        const codeBlock = document.createElement('div');
        codeBlock.className = 'ai-code-block';
        codeBlock.textContent = val;

        shell.appendChild(bar);
        shell.appendChild(codeBlock);
        return shell;
    }

    const bHtml = createCodeBlock('HTML', html);
    const bCss = createCodeBlock('CSS', css);
    const bJs = createCodeBlock('JS', js);
    
    if (bHtml) rBox.appendChild(bHtml);
    if (bCss) rBox.appendChild(bCss);
    if (bJs) rBox.appendChild(bJs);

    dom.aiHistory.appendChild(rBox);
    dom.aiHistory.scrollTop = dom.aiHistory.scrollHeight;

    showNotification('AI layout generated!', 'success');
});

socket.on('ai-error', (msg) => {
    dom.aiLoading.classList.add('hidden');
    dom.aiSubmitBtn.disabled = false;
    if (dom.aiReviewBtn) dom.aiReviewBtn.disabled = false;
    isAiGenerating = false;
    showNotification(msg);

    const errBox = document.createElement('div');
    errBox.className = 'ai-response-bubble border-red-500/10 text-red-500 text-xs';
    errBox.textContent = '❌ ' + msg;
    dom.aiHistory.appendChild(errBox);
    dom.aiHistory.scrollTop = dom.aiHistory.scrollHeight;
});

socket.on('ai-review-result', ({ review, user }) => {
    dom.aiLoading.classList.add('hidden');
    dom.aiSubmitBtn.disabled = false;
    if (dom.aiReviewBtn) dom.aiReviewBtn.disabled = false;
    isAiGenerating = false;

    const rBox = document.createElement('div');
    rBox.className = 'ai-response-bubble text-xs';

    const bar = document.createElement('div');
    bar.innerHTML = '<span class="text-zinc-900 dark:text-white font-bold flex items-center gap-1">🕵️ Dynamic Code Audit</span>';
    bar.style.marginBottom = '8px';
    rBox.appendChild(bar);

    const pre = document.createElement('div');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.lineHeight = '1.6';
    pre.textContent = review;
    
    rBox.appendChild(pre);
    dom.aiHistory.appendChild(rBox);
    dom.aiHistory.scrollTop = dom.aiHistory.scrollHeight;

    showNotification('Code audit completed!', 'success');
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// 14. SNAPSHOT DIFF LOGIC
// ==========================================

socket.on('history-list', (list) => {
    if (!dom.historyList) return;
    if (!list || list.length === 0) {
        dom.historyList.innerHTML = '<p class="text-zinc-500 text-xs text-center py-8">No state snapshots generated yet.</p>';
        return;
    }
    
    dom.historyList.innerHTML = '';
    list.slice().reverse().forEach((snap, rIdx) => {
        const index = list.length - 1 - rIdx;
        const previous = list[index - 1];
        
        let modifications = [];
        if (!previous || snap.html !== previous.html) modifications.push('HTML');
        if (!previous || snap.css !== previous.css) modifications.push('CSS');
        if (!previous || snap.js !== previous.js) modifications.push('JS');

        const changeDescription = (!previous) ? 'Initial revision' : (modifications.length ? 'Modified: ' + modifications.join(', ') : 'Unchanged');
        const badge = snap.manual ? `<span class="bg-zinc-200 dark:bg-white/[0.08] text-zinc-900 dark:text-white text-[9px] px-2 py-0.5 rounded-lg font-bold">Manual</span>` : `<span class="bg-zinc-100 dark:bg-white/[0.04] text-zinc-500 dark:text-zinc-400 text-[9px] px-2 py-0.5 rounded-lg">Auto</span>`;

        const time = new Date(snap.timestamp);
        const stamp = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const row = document.createElement('div');
        row.className = 'bg-zinc-50/50 dark:bg-white/[0.01] border border-zinc-200 dark:border-white/[0.05] rounded-xl p-3.5 hover:border-zinc-300 dark:hover:border-white/[0.12] transition-colors';
        row.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <span class="text-zinc-700 dark:text-zinc-300 text-xs font-mono font-semibold">${stamp}</span>
                    ${badge}
                </div>
                <span class="text-zinc-500 dark:text-zinc-400 text-[10px] flex items-center gap-1.5 font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
                    </svg>
                    ${snap.user}
                </span>
            </div>
            <div class="flex items-center justify-between mb-3.5">
                <div class="text-zinc-500 dark:text-zinc-400 text-[11px] font-semibold truncate max-w-[70%]" title="${changeDescription}">
                    ${changeDescription}
                </div>
                <div class="text-zinc-400 dark:text-zinc-550 text-[10px] font-mono">#${index + 1}</div>
            </div>
            <div class="flex gap-2">
                <button class="view-diff-btn flex-1 text-center bg-zinc-100 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.06] text-zinc-700 dark:text-zinc-300 text-xs py-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-white/[0.08] transition-all font-semibold flex items-center justify-center gap-1.5">
                    View Diff
                </button>
                <button class="restore-btn flex-1 text-center bg-zinc-900 dark:bg-white border border-zinc-950 dark:border-white text-white dark:text-black text-xs py-2 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all font-semibold flex items-center justify-center gap-1.5">
                    Restore
                </button>
            </div>
        `;

        row.querySelector('.view-diff-btn').addEventListener('click', () => {
            showDiffModal(snap, previous, index + 1);
        });

        row.querySelector('.restore-btn').addEventListener('click', () => {
            showConfirmModal(
                'Restore Code Snapshot',
                'This will replace active buffer states for all users in the session. Proceed?',
                () => {
                    socket.emit('restore-snapshot', { roomId: currentRoomId, index });
                    dom.historyPanel.classList.add('hidden');
                }
            );
        });
        dom.historyList.appendChild(row);
    });
});

socket.on('snapshot-restored', ({ user, timestamp }) => {
    showNotification(`⏳ Workspace snapshot from ${new Date(timestamp).toLocaleTimeString()} restored by ${user}`, 'info');
});

// Debounced changes dispatch
function handleCodeChange(lang, value) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if (currentRoomId) {
            socket.emit('code-change', { roomId: currentRoomId, lang, value });
        }
        updateIframe();
    }, 300);
}

// ==========================================
// 15. ROOM CHAT HANDLERS
// ==========================================
const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = dom.chatInput.value.trim();
    if (!text || !currentRoomId) return;

    socket.emit('send-message', { roomId: currentRoomId, text });
    dom.chatInput.value = '';
};

function renderMessage(data) {
    const isMe = data.senderUid === localUser.uid;
    const msgContainer = document.createElement('div');
    msgContainer.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} w-full`;
    
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMe ? 'self' : 'other'}`;
    
    if (!isMe) {
        const sender = document.createElement('div');
        sender.className = 'text-[10px] font-bold text-zinc-900 dark:text-white mb-0.5';
        sender.textContent = data.senderName;
        bubble.appendChild(sender);
    }
    
    const txt = document.createElement('p');
    txt.className = 'text-xs md:text-sm m-0';
    txt.textContent = data.text;
    bubble.appendChild(txt);
    
    msgContainer.appendChild(bubble);
    dom.chatMessages.appendChild(msgContainer);
}

// ==========================================
// 16. SANDBOX PREVIEW SYSTEM
// ==========================================
function updateIframe() {
    if (!htmlEditor || !cssEditor || !jsEditor) return;
    
    if (heartbeatTimer) { 
        clearTimeout(heartbeatTimer); 
        heartbeatTimer = null; 
    }

    const consoleScript = `
        <script>
            const serialize = val => {
                if (val instanceof Error) return val.stack || val.message;
                if (typeof val === 'object' && val !== null) {
                    try { return JSON.stringify(val); } catch(e) { return '[Unserializable Object]'; }
                }
                return String(val);
            };
            const proxy = (method, type) => {
                const original = console[method];
                console[method] = (...args) => {
                    window.parent.postMessage({ s: 'iframe-console', t: type, m: args.map(serialize).join(' ') }, '*');
                    original.apply(console, args);
                };
            };
            ['log', 'error', 'warn', 'info'].forEach(m => proxy(m, m));
            window.addEventListener('error', e => window.parent.postMessage({ s: 'iframe-console', t: 'error', m: e.message }, '*'));
        </script>`;

    const jsBody = isSafeModeOn ? '// Safe Mode active: JavaScript disabled' : jsEditor.getValue();
    const heartbeat = isSafeModeOn ? '' : '<script>window.parent.postMessage({ s: "iframe-heartbeat" }, "*");</script>';
    
    const pageMarkup = `<!DOCTYPE html>
        <html>
        <head>
            <style>${cssEditor.getValue()}</style>
            ${consoleScript}
        </head>
        <body>
            ${htmlEditor.getValue()}
            <script>
                try {
                    ${jsBody}
                } catch(e) {
                    console.error(e);
                }
            </script>
            ${heartbeat}
        </body>
        </html>`;
        
    dom.output.srcdoc = pageMarkup;

    // Setup runaway infinite loop script killer
    if (!isSafeModeOn) {
        heartbeatTimer = setTimeout(() => {
            dom.output.srcdoc = `<!DOCTYPE html>
                <html>
                <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;background:#09090b;color:#f87171;text-align:center;">
                    <div>
                        <h2 style="font-weight:700;margin-bottom:8px;">⚠️ Iframe Script Terminated</h2>
                        <p style="color:#a1a1aa;font-size:13px;margin-bottom:12px;">Runaway infinite script loop detected.</p>
                        <p style="color:#64748b;font-size:11px;">Toggle safe mode to edit variables securely.</p>
                    </div>
                </body>
                </html>`;
            showNotification('⚠️ Sandbox scripts killed — infinite loop caught!', 'error');
        }, 5000);
    }
}

function handleConsoleMessage({ source, data }) {
    if (!data || typeof data !== 'object') return;

    if (data.s === 'iframe-heartbeat') {
        if (heartbeatTimer) { 
            clearTimeout(heartbeatTimer); 
            heartbeatTimer = null; 
        }
        return;
    }

    if (source !== dom.output.contentWindow || data.s !== 'iframe-console') return;
    
    const line = document.createElement('div');
    line.textContent = data.m;
    line.className = `console-${data.t}`;
    line.innerHTML = `<span class="text-zinc-550 mr-2">></span>` + line.innerHTML;
    
    dom.console.appendChild(line);
    dom.console.scrollTop = dom.console.scrollHeight;

    if (currentRoomId) {
        socket.emit('console-log', { roomId: currentRoomId, type: data.t, message: data.m });
    }
}

// ==========================================
// 17. COLLABORATOR AVATARS & DETAILS
// ==========================================
function updateParticipants(list) {
    currentParticipants = list;

    if (dom.participantCountBadge) dom.participantCountBadge.textContent = list.length;
    if (dom.participantOnlineCount) dom.participantOnlineCount.textContent = `${list.length} collaborator${list.length !== 1 ? 's' : ''} online`;

    // 1. Navbar small chip lists
    dom.participants.innerHTML = '';
    list.slice(0, 3).forEach(user => {
        const item = document.createElement('div');
        item.className = 'w-6 h-6 rounded-full border border-zinc-200 dark:border-dark flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white shadow-sm';
        item.style.backgroundColor = stringToColor(user.name);
        item.textContent = user.name.charAt(0).toUpperCase();
        item.title = user.name;
        dom.participants.appendChild(item);
    });
    
    if (list.length > 3) {
        const excess = document.createElement('div');
        excess.className = 'w-6 h-6 rounded-full border border-zinc-250 dark:border-dark bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-650 dark:text-zinc-400';
        excess.textContent = `+${list.length - 3}`;
        dom.participants.appendChild(excess);
    }

    // 2. Full details sidebar overlay
    if (dom.participantsFullList) {
        dom.participantsFullList.innerHTML = '';
        list.forEach(user => {
            const isMe = user.uid === localUser.uid;
            
            const card = document.createElement('div');
            card.className = 'flex items-center justify-between bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200/60 dark:border-white/[0.05] p-3.5 rounded-xl hover:border-zinc-300 dark:hover:border-white/[0.1] transition-premium shadow-sm';

            const left = document.createElement('div');
            left.className = 'flex items-center gap-3.5';

            const avatar = document.createElement('div');
            avatar.className = 'w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-sm';
            avatar.style.backgroundColor = stringToColor(user.name);
            avatar.textContent = user.name.charAt(0).toUpperCase();

            const meta = document.createElement('div');
            
            const name = document.createElement('div');
            name.className = 'text-xs font-bold text-zinc-900 dark:text-white flex items-center gap-2';
            name.textContent = user.name;
            
            if (isMe) {
                const indicator = document.createElement('span');
                indicator.className = 'bg-zinc-200 dark:bg-white/[0.08] text-zinc-900 dark:text-white text-[9px] px-1.5 py-0.5 rounded-lg font-extrabold';
                indicator.textContent = 'You';
                name.appendChild(indicator);
            }

            const state = document.createElement('div');
            state.className = 'text-[9px] text-zinc-450 dark:text-zinc-550 font-semibold';
            state.textContent = 'Active now';

            meta.appendChild(name);
            meta.appendChild(state);
            left.appendChild(avatar);
            left.appendChild(meta);
            card.appendChild(left);

            if (!isMe) {
                const right = document.createElement('div');
                right.className = 'flex flex-col items-end';

                const ballot = activeVotes[user.uid] || { count: 0, required: Math.max(2, Math.ceil(list.length / 2)) };

                const btn = document.createElement('button');
                btn.className = `px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border ${ballot.count > 0 ? 'bg-red-500/90 border-red-550 text-white shadow-md' : 'bg-red-500/10 border-red-500/15 text-red-500 hover:bg-red-500/20'}`;
                btn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm-1-7a1 1 0 00-1 1v3a1 1 0 002 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                    Kick (${ballot.count}/${ballot.required})
                `;
                btn.onclick = () => voteKick(user.uid);

                right.appendChild(btn);
                card.appendChild(right);
            }

            dom.participantsFullList.appendChild(card);
        });
    }
}

function voteKick(targetUid) {
    if (!currentRoomId) return;
    socket.emit('vote-kick', { roomId: currentRoomId, targetUid });
}

// ==========================================
// 18. AI COMPILATION & AUDIT DISPATCH
// ==========================================
function handleAiSubmit(e) {
    e.preventDefault();
    const txt = dom.aiInput.value.trim();
    if (!txt || !currentRoomId || isAiGenerating) return;

    socket.emit('ai-generate', { roomId: currentRoomId, prompt: txt });
    dom.aiInput.value = '';
}

// ==========================================
// 19. SLIDING POPUP TOGGLE CONTROLLERS
// ==========================================
function toggleAi() {
    const el = document.getElementById('ai-panel');
    if (!el) return;

    el.classList.toggle('active');
    isAiOpen = el.classList.contains('active');
    el.style.display = isAiOpen ? 'flex' : 'none';

    if (isAiOpen) {
        // Close other overlays
        const chat = document.getElementById('chat-panel');
        if (chat && chat.classList.contains('active')) toggleChat();

        const notif = document.getElementById('notif-panel');
        if (notif && notif.classList.contains('active')) toggleNotifications();

        const users = dom.participantsPanel;
        if (users && users.classList.contains('active')) toggleParticipants();

        setTimeout(() => {
            const input = document.getElementById('ai-input');
            if (input) input.focus();
        }, 100);
    }
}

function toggleChat() {
    const el = document.getElementById('chat-panel');
    if (!el) return;

    el.classList.toggle('active');
    isChatOpen = el.classList.contains('active');
    el.style.display = isChatOpen ? 'flex' : 'none';

    if (isChatOpen) {
        unreadChatCount = 0;
        if (dom.chatBadge) dom.chatBadge.classList.add('hidden');

        const ai = document.getElementById('ai-panel');
        if (ai && ai.classList.contains('active')) toggleAi();

        const notif = document.getElementById('notif-panel');
        if (notif && notif.classList.contains('active')) toggleNotifications();

        const users = dom.participantsPanel;
        if (users && users.classList.contains('active')) toggleParticipants();

        setTimeout(() => {
            const input = document.getElementById('chat-input');
            if (input) input.focus();
        }, 100);
    }
}

function toggleNotifications() {
    const el = document.getElementById('notif-panel');
    if (!el) return;

    el.classList.toggle('active');
    isNotifOpen = el.classList.contains('active');
    el.style.display = isNotifOpen ? 'flex' : 'none';

    if (isNotifOpen) {
        unreadNotifCount = 0;
        if (dom.notifBadge) dom.notifBadge.classList.add('hidden');

        const chat = document.getElementById('chat-panel');
        if (chat && chat.classList.contains('active')) toggleChat();

        const ai = document.getElementById('ai-panel');
        if (ai && ai.classList.contains('active')) toggleAi();

        const users = dom.participantsPanel;
        if (users && users.classList.contains('active')) toggleParticipants();
    }
}

function toggleParticipants() {
    const el = dom.participantsPanel;
    if (!el) return;

    el.classList.toggle('active');
    isParticipantsOpen = el.classList.contains('active');
    el.style.display = isParticipantsOpen ? 'flex' : 'none';

    if (isParticipantsOpen) {
        const chat = document.getElementById('chat-panel');
        if (chat && chat.classList.contains('active')) toggleChat();

        const ai = document.getElementById('ai-panel');
        if (ai && ai.classList.contains('active')) toggleAi();

        const notif = document.getElementById('notif-panel');
        if (notif && notif.classList.contains('active')) toggleNotifications();

        updateParticipants(currentParticipants);
    }
}

// ==========================================
// 20. SPLIT RESIZING & WORKSPACE CONTROLS
// ==========================================
function initResizing() {
    let active = false;

    const start = (e) => {
        const ev = e.touches ? e.touches[0] : e;
        if (e.cancelable) e.preventDefault();

        active = true;
        dom.resizer.classList.add('active');
        document.body.classList.add('resizing');
    };

    const drag = (e) => {
        if (!active) return;
        const ev = e.touches ? e.touches[0] : e;

        const container = dom.contentWrapper.getBoundingClientRect();
        const editorWidth = ev.clientX - container.left;
        const outputWidth = container.width - editorWidth - dom.resizer.offsetWidth;

        if (editorWidth > 150 && outputWidth > 150) {
            dom.editorPanel.style.flexBasis = `${editorWidth}px`;
            dom.outputPanel.style.flexBasis = `${outputWidth}px`;
        }
    };

    const stop = () => {
        if (active) {
            active = false;
            dom.resizer.classList.remove('active');
            document.body.classList.remove('resizing');
            refreshEditors();
        }
    };

    dom.resizer.addEventListener('mousedown', start);
    dom.resizer.addEventListener('touchstart', start, { passive: false });

    document.addEventListener('mousemove', drag);
    document.addEventListener('touchmove', drag, { passive: false });

    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
}

// ==========================================
// 21. EXPORTS & LEAVE CLEANUPS
// ==========================================

/**
 * Packs HTML, CSS, and JS states into a production ready ZIP archive.
 */
async function handleDownload() {
    const zip = new JSZip();
    
    // Inject relative path links to index.html exports
    const htmlPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codependal Compiled Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
${htmlEditor.getValue()}
  <script src="script.js"></script>
</body>
</html>`;

    zip.file("index.html", htmlPage);
    zip.file("style.css", cssEditor.getValue());
    zip.file("script.js", jsEditor.getValue());

    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    
    link.href = URL.createObjectURL(blob);
    link.download = "codependal-compiled-project.zip";
    link.click();
    
    URL.revokeObjectURL(link.href);
    showNotification('ZIP project downloaded successfully!', 'success');
}

/**
 * Triggers interactive preview of output buffer state in new tab page.
 */
function handlePopout() {
    const frameContent = `<!DOCTYPE html>
<html>
<head>
  <title>Sandbox Iframe Output Preview</title>
  <style>${cssEditor.getValue()}</style>
</head>
<body>
  ${htmlEditor.getValue()}
  <script>
    try {
      ${jsEditor.getValue()}
    } catch(e) {
      console.error(e);
    }
  </script>
</body>
</html>`;

    const blob = new Blob([frameContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}

/**
 * Clears room parameters, socket channels, and resets interfaces.
 */
function leaveRoom() {
    if (currentRoomId) {
        socket.emit('leave-room');
    }

    // Purge listeners
    editorCleanupFns.forEach(fn => fn());
    editorCleanupFns = [];

    currentRoomId = null;
    localUser = null;
    window.location.hash = '';

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

// Run the application init hooks
initializeApp();
