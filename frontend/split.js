const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.html');
let content = fs.readFileSync(indexPath, 'utf-8');

// 1. Extract and remove CSS
const styleRegex = /<style>([\s\S]*?)<\/style>/i;
const styleMatch = content.match(styleRegex);
if (styleMatch) {
    fs.writeFileSync(path.join(__dirname, 'styles.css'), styleMatch[1].trim() + '\n');
    content = content.replace(styleRegex, '<link rel="stylesheet" href="/styles.css">');
    console.log('Extracted styles.css');
}

// 2. Extract and remove JS
// The main script tag is the last one with significant content
const scriptRegex = /<script>\s*\/\/\s*Global error handler([\s\S]*?)<\/script>/i;
const scriptMatch = content.match(scriptRegex);
if (scriptMatch) {
    let jsContent = '// Global error handler' + scriptMatch[1];
    
    // Apply Fix 1: window.onerror
    jsContent = jsContent.replace(
        /window\.onerror\s*=\s*function\s*\([^)]*\)\s*\{\s*alert\('[^']*'\s*\+\s*line\s*\+\s*'[^']*'\s*\+\s*msg\);\s*return\s*false;\s*\};/g,
        `window.onerror = function (msg, url, line, col, error) {
            console.error('[Codependal] JS Error at line ' + line + ': ' + msg);
            return false;
        };`
    );

    // Apply Fix 2: generateUID
    jsContent = jsContent.replace(
        /function\s+generateUID\(\)\s*\{\s*return\s*'u_'\s*\+\s*Math\.random\(\)\.toString\(36\)\.substring\(2,\s*11\)\s*\+\s*Date\.now\(\)\.toString\(36\);\s*\}/g,
        `function generateUID() {
            return crypto.randomUUID();
        }`
    );

    // Apply Fix 3: server-assigned UID
    jsContent = jsContent.replace(
        /isRemoteUpdate\s*=\s*false;\s*updateIframe\(\);/g,
        `isRemoteUpdate = false;
            // Accept server-assigned UID if provided
            if (data.uid && localUser) {
                localUser.uid = data.uid;
            }
            updateIframe();`
    );

    // Apply Fix 4: Event Listener Leaks
    // Add cleanup tracking array at the top
    jsContent = jsContent.replace(
        /let\s+currentRoomId\s*=\s*null;/g,
        `let editorCleanupFns = []; // Track listeners for cleanup on leave\n        let currentRoomId = null;`
    );

    // In enterEditor
    jsContent = jsContent.replace(/htmlEditor\.on\('change',\s*\(\)\s*=>\s*\{\s*if\s*\(!isRemoteUpdate\)\s*handleCodeChange\('html',\s*htmlEditor\.getValue\(\)\);\s*\}\);/g, `const htmlChangeHandler = () => { if (!isRemoteUpdate) handleCodeChange('html', htmlEditor.getValue()); };\n            htmlEditor.on('change', htmlChangeHandler);\n            editorCleanupFns.push(() => htmlEditor.off('change', htmlChangeHandler));`);
    jsContent = jsContent.replace(/cssEditor\.on\('change',\s*\(\)\s*=>\s*\{\s*if\s*\(!isRemoteUpdate\)\s*handleCodeChange\('css',\s*cssEditor\.getValue\(\)\);\s*\}\);/g, `const cssChangeHandler = () => { if (!isRemoteUpdate) handleCodeChange('css', cssEditor.getValue()); };\n            cssEditor.on('change', cssChangeHandler);\n            editorCleanupFns.push(() => cssEditor.off('change', cssChangeHandler));`);
    jsContent = jsContent.replace(/jsEditor\.on\('change',\s*\(\)\s*=>\s*\{\s*if\s*\(!isRemoteUpdate\)\s*handleCodeChange\('js',\s*jsEditor\.getValue\(\)\);\s*\}\);/g, `const jsChangeHandler = () => { if (!isRemoteUpdate) handleCodeChange('js', jsEditor.getValue()); };\n            jsEditor.on('change', jsChangeHandler);\n            editorCleanupFns.push(() => jsEditor.off('change', jsChangeHandler));`);

    jsContent = jsContent.replace(/htmlEditor\.on\('cursorActivity',\s*\(\)\s*=>\s*emitCursor\('html',\s*htmlEditor\)\);/g, `const htmlCursorHandler = () => emitCursor('html', htmlEditor);\n            htmlEditor.on('cursorActivity', htmlCursorHandler);\n            editorCleanupFns.push(() => htmlEditor.off('cursorActivity', htmlCursorHandler));`);
    jsContent = jsContent.replace(/cssEditor\.on\('cursorActivity',\s*\(\)\s*=>\s*emitCursor\('css',\s*cssEditor\)\);/g, `const cssCursorHandler = () => emitCursor('css', cssEditor);\n            cssEditor.on('cursorActivity', cssCursorHandler);\n            editorCleanupFns.push(() => cssEditor.off('cursorActivity', cssCursorHandler));`);
    jsContent = jsContent.replace(/jsEditor\.on\('cursorActivity',\s*\(\)\s*=>\s*emitCursor\('js',\s*jsEditor\)\);/g, `const jsCursorHandler = () => emitCursor('js', jsEditor);\n            jsEditor.on('cursorActivity', jsCursorHandler);\n            editorCleanupFns.push(() => jsEditor.off('cursorActivity', jsCursorHandler));`);

    // Event listeners
    const listenersToWrap = [
        { el: 'dom.chatForm', ev: 'submit', handler: 'handleSendMessage' },
        { el: 'dom.aiForm', ev: 'submit', handler: 'handleAiSubmit' },
        { el: 'dom.leaveBtn', ev: 'click', handler: 'leaveRoom' },
        { el: 'dom.clearConsoleBtn', ev: 'click', handler: `() => dom.console.innerHTML = ''` },
        { el: 'dom.downloadBtn', ev: 'click', handler: 'handleDownload' },
        { el: 'dom.popoutBtn', ev: 'click', handler: 'handlePopout' },
        { el: 'dom.safeModeBtn', ev: 'click', handler: `() => {\n                isSafeModeOn = !isSafeModeOn;\n                dom.safeModeBtn.classList.toggle('bg-white/20', isSafeModeOn);\n                dom.safeModeBtn.classList.toggle('bg-black/80', !isSafeModeOn);\n                dom.safeModeBtn.title = isSafeModeOn ? 'Safe Mode ON (JS disabled)' : 'Toggle Safe Mode (disable JS)';\n                showNotification(isSafeModeOn ? '🛡️ Safe Mode ON — JS disabled in preview' : '🛡️ Safe Mode OFF — JS enabled', 'info');\n                updateIframe();\n            }` },
        { el: 'dom.historyBtn', ev: 'click', handler: `() => {\n                dom.historyPanel.classList.toggle('hidden');\n                if (!dom.historyPanel.classList.contains('hidden')) {\n                    socket.emit('get-history', { roomId });\n                }\n            }` },
        { el: 'dom.historyCloseBtn', ev: 'click', handler: `() => {\n                dom.historyPanel.classList.add('hidden');\n            }` },
        { el: 'dom.saveSnapshotBtn', ev: 'click', handler: `() => {\n                socket.emit('save-snapshot-manual', { roomId });\n            }` },
        { el: 'dom.aiReviewBtn', ev: 'click', handler: `() => {\n                if (!currentRoomId || isAiGenerating) return;\n                isAiGenerating = true;\n                dom.aiSubmitBtn.disabled = true;\n                dom.aiReviewBtn.disabled = true;\n                socket.emit('ai-review', { roomId: currentRoomId });\n\n                const promptDiv = document.createElement('div');\n                promptDiv.className = 'ai-prompt-bubble text-white text-xs';\n                promptDiv.innerHTML = \`<span class="font-bold">\${localUser.name}:</span> 🔍 Code Review\`;\n                dom.aiHistory.appendChild(promptDiv);\n            }` }
    ];

    for (const {el, ev, handler} of listenersToWrap) {
        // We will do a generic replacement for the block
        // Actually it's easier to manually replace the exact string or just run a regex
    }
    
    // Manual replacements for the event listeners to add cleanup
    const replacements = [
        {
            search: /dom\.chatForm\.addEventListener\('submit',\s*handleSendMessage\);/g,
            replace: `dom.chatForm.addEventListener('submit', handleSendMessage);\n            editorCleanupFns.push(() => dom.chatForm.removeEventListener('submit', handleSendMessage));`
        },
        {
            search: /dom\.aiForm\.addEventListener\('submit',\s*handleAiSubmit\);/g,
            replace: `dom.aiForm.addEventListener('submit', handleAiSubmit);\n            editorCleanupFns.push(() => dom.aiForm.removeEventListener('submit', handleAiSubmit));`
        },
        {
            search: /dom\.aiReviewBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?dom\.aiHistory\.appendChild\(promptDiv\);\s*\}\);/g,
            replace: match => `const aiReviewHandler = ${match.replace(/dom\.aiReviewBtn\.addEventListener\('click',\s*/, '').replace(/\);$/, '')};\n            dom.aiReviewBtn.addEventListener('click', aiReviewHandler);\n            editorCleanupFns.push(() => dom.aiReviewBtn.removeEventListener('click', aiReviewHandler));`
        },
        {
            search: /dom\.leaveBtn\.addEventListener\('click',\s*leaveRoom\);/g,
            replace: `dom.leaveBtn.addEventListener('click', leaveRoom);\n            editorCleanupFns.push(() => dom.leaveBtn.removeEventListener('click', leaveRoom));`
        },
        {
            search: /dom\.clearConsoleBtn\.addEventListener\('click',\s*\(\)\s*=>\s*dom\.console\.innerHTML\s*=\s*''\);/g,
            replace: `const clearConsoleHandler = () => dom.console.innerHTML = '';\n            dom.clearConsoleBtn.addEventListener('click', clearConsoleHandler);\n            editorCleanupFns.push(() => dom.clearConsoleBtn.removeEventListener('click', clearConsoleHandler));`
        },
        {
            search: /dom\.downloadBtn\.addEventListener\('click',\s*handleDownload\);/g,
            replace: `dom.downloadBtn.addEventListener('click', handleDownload);\n            editorCleanupFns.push(() => dom.downloadBtn.removeEventListener('click', handleDownload));`
        },
        {
            search: /dom\.popoutBtn\.addEventListener\('click',\s*handlePopout\);/g,
            replace: `dom.popoutBtn.addEventListener('click', handlePopout);\n            editorCleanupFns.push(() => dom.popoutBtn.removeEventListener('click', handlePopout));`
        },
        {
            search: /dom\.safeModeBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?updateIframe\(\);\s*\}\);/g,
            replace: match => `const safeModeHandler = ${match.replace(/dom\.safeModeBtn\.addEventListener\('click',\s*/, '').replace(/\);$/, '')};\n            dom.safeModeBtn.addEventListener('click', safeModeHandler);\n            editorCleanupFns.push(() => dom.safeModeBtn.removeEventListener('click', safeModeHandler));`
        },
        {
            search: /dom\.historyBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?\}\);/g,
            replace: match => `const historyBtnHandler = ${match.replace(/dom\.historyBtn\.addEventListener\('click',\s*/, '').replace(/\);$/, '')};\n            dom.historyBtn.addEventListener('click', historyBtnHandler);\n            editorCleanupFns.push(() => dom.historyBtn.removeEventListener('click', historyBtnHandler));`
        },
        {
            search: /dom\.historyCloseBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*dom\.historyPanel\.classList\.add\('hidden'\);\s*\}\);/g,
            replace: `const historyCloseHandler = () => {\n                dom.historyPanel.classList.add('hidden');\n            };\n            dom.historyCloseBtn.addEventListener('click', historyCloseHandler);\n            editorCleanupFns.push(() => dom.historyCloseBtn.removeEventListener('click', historyCloseHandler));`
        },
        {
            search: /dom\.saveSnapshotBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*socket\.emit\('save-snapshot-manual',\s*\{\s*roomId\s*\}\);\s*\}\);/g,
            replace: `const saveSnapshotHandler = () => {\n                socket.emit('save-snapshot-manual', { roomId });\n            };\n            dom.saveSnapshotBtn.addEventListener('click', saveSnapshotHandler);\n            editorCleanupFns.push(() => dom.saveSnapshotBtn.removeEventListener('click', saveSnapshotHandler));`
        }
    ];

    for (const r of replacements) {
        jsContent = jsContent.replace(r.search, r.replace);
    }

    // In leaveRoom, clear the array
    jsContent = jsContent.replace(
        /currentRoomId\s*=\s*null;/g,
        `// Clean up all event listeners\n            editorCleanupFns.forEach(fn => fn());\n            editorCleanupFns = [];\n\n            currentRoomId = null;`
    );

    fs.writeFileSync(path.join(__dirname, 'app.js'), jsContent.trim() + '\n');
    content = content.replace(scriptRegex, '<script src="/app.js"></script>');
    console.log('Extracted app.js');
}

fs.writeFileSync(indexPath, content);
console.log('Updated index.html');
