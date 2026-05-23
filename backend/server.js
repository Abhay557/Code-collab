require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// ─── Constants ────────────────────────────────────────────────────────
const MAX_ROOM_CAPACITY = 6;

// ─── Input Validation Constants ───────────────────────────────────────
const MAX_CODE_SIZE = 500 * 1024; // 500KB per language
const MAX_CHAT_LENGTH = 2000;
const MAX_NAME_LENGTH = 30;
const ROOM_ID_REGEX = /^[a-z0-9]{5,10}$/;

// ─── CORS Allowlist ───────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5173',
    process.env.FRONTEND_URL
].filter(Boolean);

// ─── Persistent Room Store ────────────────────────────────────────────
class RoomStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.rooms = new Map();
        this._saveTimer = null;
        this._saveDelay = 2000; // 2 second debounce

        // Ensure the data directory exists
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Load from disk on startup
        this._loadSync();
    }

    _loadSync() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const data = JSON.parse(raw);
                for (const [roomId, roomData] of Object.entries(data)) {
                    // Restore votes from arrays back to Sets
                    const votes = {};
                    if (roomData.votes) {
                        for (const [targetUid, voterArray] of Object.entries(roomData.votes)) {
                            votes[targetUid] = new Set(voterArray);
                        }
                    }
                    this.rooms.set(roomId, {
                        ...roomData,
                        votes,
                        participants: [],       // Connections are lost on restart
                        historyTimer: null       // setTimeout refs can't be serialized
                    });
                }
                console.log(`📂 Loaded ${this.rooms.size} room(s) from ${this.filePath}`);
            }
        } catch (err) {
            console.error('⚠️  Failed to load rooms from disk:', err.message);
        }
    }

    _serialize() {
        const obj = {};
        for (const [roomId, room] of this.rooms.entries()) {
            // Convert votes Sets to arrays for JSON serialization
            const votesObj = {};
            if (room.votes) {
                for (const [targetUid, voterSet] of Object.entries(room.votes)) {
                    votesObj[targetUid] = Array.from(voterSet);
                }
            }
            // Skip historyTimer (non-serializable setTimeout ref)
            const { historyTimer, votes, ...rest } = room;
            obj[roomId] = { ...rest, votes: votesObj };
        }
        return JSON.stringify(obj, null, 2);
    }

    save() {
        // Debounced save — coalesces rapid mutations
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            try {
                fs.writeFileSync(this.filePath, this._serialize(), 'utf-8');
            } catch (err) {
                console.error('⚠️  Failed to persist rooms:', err.message);
            }
        }, this._saveDelay);
    }

    get(roomId) {
        return this.rooms.get(roomId) || null;
    }

    set(roomId, room) {
        this.rooms.set(roomId, room);
    }

    delete(roomId) {
        this.rooms.delete(roomId);
        this.save();
    }

    forEach(fn) {
        this.rooms.forEach(fn);
    }

    get size() {
        return this.rooms.size;
    }
}

const store = new RoomStore(path.join(__dirname, 'data', 'rooms.json'));

function getRoomData(roomId) {
    return store.get(roomId);
}

function createRoom(roomId, isPublic) {
    const room = {
        roomId,
        html: '<h1>Welcome!</h1>\n<p>Start coding and see your changes live.</p>',
        css: 'body {\n  font-family: sans-serif;\n  padding: 1em;\n}',
        js: 'console.log("Hello from your new room!");',
        isPublic,
        participants: [],
        messages: [],
        consoleLogs: [],
        votes: {},              // targetUid -> Set of voterUids
        kickedUids: [],         // list of banned UIDs
        history: [],            // Time-travel snapshots
        historyTimer: null,     // Debounce timer for snapshots
        createdAt: new Date()
    };
    store.set(roomId, room);
    store.save();
    return room;
}

// ─── Express + Socket.IO Setup ────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // Trust first proxy (Render, Railway, etc.)
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ─── Middleware ────────────────────────────────────────────────────────
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());
// app.use(express.static(path.join(__dirname, 'public'))); // Removed since frontend is split

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,                  // 60 requests per minute per IP
    message: { error: 'Too many requests, please slow down.' }
});
app.use('/api', apiLimiter);

// ─── REST API ─────────────────────────────────────────────────────────

// Create a room
app.post('/api/rooms', (req, res) => {
    const { isPublic } = req.body;

    // Validate isPublic is a boolean
    if (typeof isPublic !== 'undefined' && typeof isPublic !== 'boolean') {
        return res.status(400).json({ error: 'isPublic must be a boolean.' });
    }

    const roomId = Math.random().toString(36).substring(2, 9);
    const room = createRoom(roomId, !!isPublic);
    res.json({ roomId, room });
});

// Check if a room exists (this MUST come before /api/rooms/random/public)
app.get('/api/rooms/random/public', (req, res) => {
    const publicRooms = [];
    store.forEach((room, id) => {
        if (room.isPublic && room.participants.length < MAX_ROOM_CAPACITY) {
            publicRooms.push(id);
        }
    });
    if (publicRooms.length > 0) {
        const randomId = publicRooms[Math.floor(Math.random() * publicRooms.length)];
        res.json({ roomId: randomId });
    } else {
        res.status(404).json({ error: 'No public rooms available.' });
    }
});

app.get('/api/rooms/:id', (req, res) => {
    const room = getRoomData(req.params.id);
    if (room) {
        res.json({ exists: true, room });
    } else {
        res.status(404).json({ exists: false });
    }
});

// ─── AI Code Cleanup Helpers ──────────────────────────────────────────

const cleanBlock = (code) => {
    if (!code) return null;
    let c = code.trim();
    const prefixesToRemove = [
        '(body content only, no html/head/body tags)',
        '<body content only, no html/head/body tags>',
        '(complete styles)',
        '<complete styles>',
        '(complete JavaScript)',
        '<complete JavaScript>',
        '(JavaScript code)'
    ];
    for (const prefix of prefixesToRemove) {
        if (c.startsWith(prefix)) {
            c = c.substring(prefix.length).trim();
        }
    }
    return c || null;
};

const cleanCode = (code, type) => {
    if (!code) return null;
    let cleaned = code.trim();
    if (type === 'html') {
        // Aggressively remove all structural boilerplate Tags including any with attributes
        cleaned = cleaned.replace(/<body[^>]*>/gi, '').replace(/<\/body>/gi, '');
        cleaned = cleaned.replace(/<html[^>]*>/gi, '').replace(/<\/html>/gi, '');
        cleaned = cleaned.replace(/<head[^>]*>/gi, '').replace(/<\/head>/gi, '');
        cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        cleaned = cleaned.replace(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi, '');
        // Also remove any dangling / closing tags that might have survived
        cleaned = cleaned.replace(/<\/?style[^>]*>/gi, '').replace(/<\/?script[^>]*>/gi, '');
    }
    const lines = cleaned.split('\n');
    let startIndex = 0;
    while (startIndex < lines.length) {
        const line = lines[startIndex].trim();
        if (!line) {
            startIndex++;
            continue;
        }
        // Filter out typical AI chatty lines and hallucinated instructions
        if (line.startsWith('(') || line.startsWith('Note:') || line.match(/^Here is/i) || line.match(/^Sure,/i) ||
            line.match(/body content only/i) || line.match(/no html\/head\/body tags/i) || line.match(/code for window popup/i)) {
            startIndex++;
        } else {
            break;
        }
    }
    return lines.slice(startIndex).join('\n').trim();
};

// ─── AI Response Parser ───────────────────────────────────────────────

function parseCodeBlocks(text) {
    const result = { html: null, css: null, js: null };
    const blockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let match;
    let foundFences = false;

    while ((match = blockRegex.exec(text)) !== null) {
        foundFences = true;
        let lang = match[1].toLowerCase().trim();
        const code = match[2].trim();
        if (lang === 'html' || lang === 'xml') result.html = code;
        else if (lang === 'css') result.css = code;
        else if (lang === 'js' || lang === 'javascript') result.js = code;
        else if (lang === '') {
            if (code.trim().startsWith('<')) result.html = code;
            else if (code.includes('{') && code.includes(':')) result.css = code;
            else result.js = code;
        }
    }

    if (!foundFences) {
        let remainingText = text;
        const scriptMatch = remainingText.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
        if (scriptMatch) {
            result.js = scriptMatch[1].trim();
            remainingText = remainingText.replace(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/i, '');
        }
    }

    // Extraction of embedded style/script from HTML block
    if (result.html) {
        while (true) {
            const styleMatch = result.html.match(/<style[^>]*>([\s\S]*?)(?:<\/style>|(?=<\/head>|<\/body>|<\/html>|$))/i);
            if (!styleMatch) break;
            const cssContent = styleMatch[1].trim();
            if (cssContent) result.css = (result.css ? result.css + '\n\n' : '') + cssContent;
            result.html = (result.html.substring(0, styleMatch.index) + result.html.substring(styleMatch.index + styleMatch[0].length)).trim();
        }
        while (true) {
            const scriptMatch = result.html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)(?:<\/script>|(?=<\/body>|<\/html>|$))/i);
            if (!scriptMatch) break;
            const jsContent = scriptMatch[1].trim();
            if (jsContent) result.js = (result.js ? result.js + '\n\n' : '') + jsContent;
            result.html = (result.html.substring(0, scriptMatch.index) + result.html.substring(scriptMatch.index + scriptMatch[0].length)).trim();
        }
    }

    result.html = cleanCode(result.html, 'html');
    result.css = cleanCode(result.css, 'css');
    result.js = cleanCode(result.js, 'js');

    return result;
}

// ─── SOCKET.IO Events ────────────────────────────────────────────────
io.on('connection', (socket) => {
    let currentRoom = null;
    let currentUser = null;

    // Join a room
    socket.on('join-room', ({ roomId, user }) => {
        // ── Input Validation ──
        if (!roomId || typeof roomId !== 'string' || !ROOM_ID_REGEX.test(roomId)) {
            socket.emit('error-msg', 'Invalid room ID format.');
            return;
        }
        if (!user || typeof user.name !== 'string') {
            socket.emit('error-msg', 'Invalid user data.');
            return;
        }
        const validatedName = user.name.trim();
        if (validatedName.length < 1 || validatedName.length > MAX_NAME_LENGTH) {
            socket.emit('error-msg', `Name must be between 1 and ${MAX_NAME_LENGTH} characters.`);
            return;
        }

        const room = getRoomData(roomId);
        if (!room) {
            socket.emit('error-msg', 'Room not found.');
            return;
        }

        // ── Server-side UID Generation ──
        const serverUid = crypto.randomUUID();
        const serverUser = { uid: serverUid, name: validatedName };

        // Check if kicked (by name, since UIDs are now server-generated)
        if (room.kickedUids.includes(serverUid)) {
            socket.emit('error-msg', 'You have been kicked from this room.');
            return;
        }

        currentRoom = roomId;
        currentUser = serverUser;
        socket.join(roomId);

        // Check capacity
        if (room.participants.length >= MAX_ROOM_CAPACITY) {
            socket.emit('error-msg', `Room is full. Maximum ${MAX_ROOM_CAPACITY} participants allowed.`);
            return;
        }

        room.participants.push(serverUser);
        store.save();

        // Send full room state to the joining user (includes server-assigned UID)
        socket.emit('room-state', {
            uid: serverUid,
            html: room.html,
            css: room.css,
            js: room.js,
            participants: room.participants,
            messages: room.messages
        });

        // Broadcast updated participants to everyone in the room
        io.to(roomId).emit('participants-update', room.participants);

        // Notify others that a user joined
        socket.to(roomId).emit('activity', { type: 'join', user: serverUser.name, timestamp: new Date().toISOString() });
    });

    // Code change
    socket.on('code-change', ({ roomId, lang, value }) => {
        // ── Input Validation ──
        if (!lang || !['html', 'css', 'js'].includes(lang)) return;
        if (typeof value !== 'string' || value.length > MAX_CODE_SIZE) return;

        const room = getRoomData(roomId);
        if (!room) return;

        // Update the room data
        room[lang] = value;
        store.save();

        // Broadcast to everyone EXCEPT the sender
        socket.to(roomId).emit('code-update', { lang, value });

        // Notify others about the edit
        socket.to(roomId).emit('activity', { type: 'edit', user: currentUser ? currentUser.name : 'Unknown', detail: lang.toUpperCase(), timestamp: new Date().toISOString() });

        // Debounced snapshot for time-travel (save every 10 seconds of activity)
        if (room.historyTimer) clearTimeout(room.historyTimer);
        room.historyTimer = setTimeout(() => {
            room.history.push({
                html: room.html,
                css: room.css,
                js: room.js,
                timestamp: new Date().toISOString(),
                user: currentUser ? currentUser.name : 'Unknown'
            });
            // Cap at 50 entries
            if (room.history.length > 50) room.history.shift();
            store.save();
        }, 10000);
    });

    // Cursor sharing
    socket.on('cursor-move', ({ roomId, lang, line, ch }) => {
        if (!currentUser) return;
        socket.to(roomId).emit('remote-cursor', {
            uid: currentUser.uid,
            name: currentUser.name,
            lang,
            line,
            ch
        });
    });

    // Console log from iframe (client sends these so AI can see them)
    socket.on('console-log', ({ roomId, type, message }) => {
        const room = getRoomData(roomId);
        if (!room) return;
        room.consoleLogs.push({ type, message, timestamp: Date.now() });
        // Keep only last 30 entries to avoid memory bloat
        if (room.consoleLogs.length > 30) {
            room.consoleLogs = room.consoleLogs.slice(-30);
        }
    });

    // Chat message
    socket.on('send-message', ({ roomId, text }) => {
        // ── Input Validation ──
        if (typeof text !== 'string') return;
        const trimmedText = text.trim();
        if (trimmedText.length < 1 || trimmedText.length > MAX_CHAT_LENGTH) return;

        const room = getRoomData(roomId);
        if (!room || !currentUser) return;

        const message = {
            text: trimmedText,
            senderName: currentUser.name,
            senderUid: currentUser.uid,
            timestamp: new Date().toISOString()
        };

        room.messages.push(message);
        store.save();

        // Broadcast to EVERYONE in the room (including sender)
        io.to(roomId).emit('new-message', message);
    });

    // AI Code Generation
    socket.on('ai-generate', async ({ roomId, prompt }) => {
        const room = getRoomData(roomId);
        if (!room || !currentUser) return;

        const AI_BACKEND = process.env.AI_BACKEND_URL;

        if (!AI_BACKEND || AI_BACKEND === 'https://your-space.hf.space') {
            socket.emit('ai-error', 'AI backend URL not configured. Set AI_BACKEND_URL in .env');
            return;
        }

        // Notify room that AI is generating
        io.to(roomId).emit('ai-status', { status: 'generating', prompt, user: currentUser.name });

        // Build enhanced prompt with current code context
        const recentLogs = room.consoleLogs.slice(-20);
        const consoleSection = recentLogs.length > 0
            ? `\nBrowser Console Output (most recent):\n\`\`\`\n${recentLogs.map(l => `[${l.type.toUpperCase()}] ${l.message}`).join('\n')}\n\`\`\`\n`
            : '\nBrowser Console: (no output)\n';

        const codeContext = `The user has the following code in their collaborative editor:

HTML:
\`\`\`html
${room.html}
\`\`\`

CSS:
\`\`\`css
${room.css}
\`\`\`

JavaScript:
\`\`\`js
${room.js}
\`\`\`
${consoleSection}
User's request: "${prompt}"

Please generate the complete updated code based on the user's request. 
CRITICAL RULES: 
1. DO NOT include <html>, <head>, or <body> or <title> tags. 
2. EXCLUDE all <style> and <script> tags from your HTML block. 
3. Put ALL CSS in the \`\`\`css block and ALL JavaScript in the \`\`\`js block. 
4. The HTML block should contain ONLY the elements that live inside a <body> (e.g. <div>, <button>, etc.).
5. If a block is unchanged, omit it or provide it as-is.
6. DO NOT add any conversational text before or after the code blocks.`;

        try {
            const response = await fetch(`${AI_BACKEND}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: codeContext }],
                    max_tokens: 2048,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('AI backend error:', response.status, errText);
                socket.emit('ai-error', `AI service error (${response.status}). Try again.`);
                io.to(roomId).emit('ai-status', { status: 'error' });
                return;
            }

            const data = await response.json();

            // Parse AI response into separate HTML/CSS/JS blocks
            const chatContent = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
            const rawText = chatContent || data.raw || data.response || data.text || data.generated_text || '';
            let parsed = { html: null, css: null, js: null };

            if (data.html || data.css || data.js) {
                parsed.html = cleanBlock(data.html || null);
                parsed.css = cleanBlock(data.css || null);
                parsed.js = cleanBlock(data.js || null);
            } else if (rawText) {
                parsed = parseCodeBlocks(rawText);
            }

            // Consistently apply aggressive cleanup to all parsed blocks
            parsed.html = cleanCode(parsed.html, 'html');
            parsed.css = cleanCode(parsed.css, 'css');
            parsed.js = cleanCode(parsed.js, 'js');

            // Logic to avoid echoing identical code in the chat UI
            if (parsed.html === room.html) parsed.html = null;
            if (parsed.css === room.css) parsed.css = null;
            if (parsed.js === room.js) parsed.js = null;

            // DO NOT update room.html/css/js here. 
            // We only send it to the chat UI for the user to manually review.

            console.log(`🤖 AI generated code in ${data.time_ms}ms for room ${roomId}`);

            // Broadcast ONLY the newly generated code to the frontend chat UI
            io.to(roomId).emit('ai-result', {
                html: parsed.html,
                css: parsed.css,
                js: parsed.js,
                prompt,
                rawResponse: data.raw || '',
                user: currentUser.name
            });

        } catch (err) {
            console.error('AI generation error:', err);
            socket.emit('ai-error', 'Failed to connect to AI service.');
            io.to(roomId).emit('ai-status', { status: 'error' });
        }
    });

    // Vote Kick logic
    socket.on('vote-kick', ({ roomId, targetUid }) => {
        const room = getRoomData(roomId);
        if (!room || !currentUser) return;

        const target = room.participants.find(p => p.uid === targetUid);
        if (!target) return;
        if (targetUid === currentUser.uid) return; // Can't kick self

        // Initialize votes for target
        if (!room.votes[targetUid]) room.votes[targetUid] = new Set();

        // Add voter
        room.votes[targetUid].add(currentUser.uid);
        store.save();

        const currentVotes = room.votes[targetUid].size;
        const requiredVotes = Math.max(2, Math.ceil(room.participants.length / 2));

        // Notify room about the vote count
        io.to(roomId).emit('vote-update', {
            targetUid,
            targetName: target.name,
            voterName: currentUser.name,
            currentVotes,
            requiredVotes
        });

        if (currentVotes >= requiredVotes && room.participants.length >= 3) {
            // Kick the user
            room.kickedUids.push(targetUid);
            room.participants = room.participants.filter(p => p.uid !== targetUid);
            delete room.votes[targetUid];
            store.save();

            // Notify everyone
            io.to(roomId).emit('user-kicked', { uid: targetUid, name: target.name });
            io.to(roomId).emit('participants-update', room.participants);
            io.to(roomId).emit('activity', {
                type: 'leave',
                user: target.name,
                detail: 'Kicked by vote',
                timestamp: new Date().toISOString()
            });

            // The target will handle their own disconnection on the 'user-kicked' event
        }
    });

    // AI Code Review
    socket.on('ai-review', async ({ roomId }) => {
        const room = getRoomData(roomId);
        if (!room || !currentUser) return;

        const AI_BACKEND = process.env.AI_BACKEND_URL;
        if (!AI_BACKEND || AI_BACKEND === 'https://your-space.hf.space') {
            socket.emit('ai-error', 'AI backend URL not configured.');
            return;
        }

        io.to(roomId).emit('ai-status', { status: 'generating', prompt: 'Code Review', user: currentUser.name });

        const reviewPrompt = `You are a senior code reviewer. Analyze the following code for:
1. Bugs and potential errors
2. Best practices violations
3. Accessibility issues
4. Performance concerns
5. Security vulnerabilities

Provide a concise, actionable review. Use bullet points. Do NOT rewrite the code — only give text feedback.

HTML:
\`\`\`html
${room.html}
\`\`\`

CSS:
\`\`\`css
${room.css}
\`\`\`

JavaScript:
\`\`\`js
${room.js}
\`\`\`

Respond with ONLY the review feedback as plain text with bullet points. No code blocks.`;

        try {
            const response = await fetch(`${AI_BACKEND}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: reviewPrompt }],
                    max_tokens: 2048,
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('AI review backend error:', response.status, errText);
                socket.emit('ai-error', `AI service error (${response.status}). Try again.`);
                io.to(roomId).emit('ai-status', { status: 'error' });
                return;
            }

            const data = await response.json();
            const chatContent = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : null;
            const reviewText = chatContent || data.raw || data.response || data.text || data.generated_text || 'No review generated.';

            io.to(roomId).emit('ai-review-result', {
                review: reviewText,
                user: currentUser.name
            });

        } catch (err) {
            console.error('AI review error:', err);
            socket.emit('ai-error', 'Failed to connect to AI service for review.');
            io.to(roomId).emit('ai-status', { status: 'error' });
        }
    });

    // Leave room
    socket.on('leave-room', () => {
        handleDisconnect();
    });

    // Time-Travel: Force manual snapshot
    socket.on('save-snapshot-manual', ({ roomId }) => {
        const room = getRoomData(roomId);
        if (!room) return;

        // Force a save immediately
        if (room.historyTimer) {
            clearTimeout(room.historyTimer);
            room.historyTimer = null;
        }

        room.history.push({
            html: room.html,
            css: room.css,
            js: room.js,
            timestamp: new Date().toISOString(),
            user: currentUser ? currentUser.name : 'Unknown',
            manual: true // flag to indicate it was user-initiated
        });

        if (room.history.length > 50) room.history.shift();
        store.save();

        // Broadcast updated history right away
        io.to(roomId).emit('history-list', room.history);

        // Notify room about the snapshot
        io.to(roomId).emit('activity', { type: 'snapshot', user: currentUser ? currentUser.name : 'Unknown', timestamp: new Date().toISOString() });
    });

    // Time-Travel: Get history
    socket.on('get-history', ({ roomId }) => {
        const room = getRoomData(roomId);
        if (!room) return;
        socket.emit('history-list', room.history);
    });

    // Time-Travel: Restore snapshot
    socket.on('restore-snapshot', ({ roomId, index }) => {
        const room = getRoomData(roomId);
        if (!room || !room.history[index]) return;

        const snapshot = room.history[index];
        room.html = snapshot.html;
        room.css = snapshot.css;
        room.js = snapshot.js;
        store.save();

        // Broadcast restored state to all users
        io.to(roomId).emit('room-state', {
            html: room.html,
            css: room.css,
            js: room.js,
            participants: room.participants,
            messages: room.messages
        });

        io.to(roomId).emit('snapshot-restored', {
            user: currentUser ? currentUser.name : 'Someone',
            timestamp: snapshot.timestamp
        });

        // Notify room about the restore
        io.to(roomId).emit('activity', { type: 'restore', user: currentUser ? currentUser.name : 'Someone', timestamp: new Date().toISOString() });
    });

    // Disconnect (tab close, network drop)
    socket.on('disconnect', () => {
        handleDisconnect();
    });

    function handleDisconnect() {
        if (currentRoom && currentUser) {
            const room = getRoomData(currentRoom);
            if (room) {
                // Notify others that a user left
                socket.to(currentRoom).emit('activity', { type: 'leave', user: currentUser.name, timestamp: new Date().toISOString() });

                room.participants = room.participants.filter(p => p.uid !== currentUser.uid);
                io.to(currentRoom).emit('participants-update', room.participants);
                store.save();

                // Clean up empty rooms after 5 minutes
                if (room.participants.length === 0) {
                    const roomToClean = currentRoom;
                    setTimeout(() => {
                        const check = getRoomData(roomToClean);
                        if (check && check.participants.length === 0) {
                            store.delete(roomToClean);
                            console.log(`🗑️  Room ${roomToClean} cleaned up (empty).`);
                        }
                    }, 5 * 60 * 1000);
                }
            }
            socket.leave(currentRoom);
        }
        currentRoom = null;
        currentUser = null;
    }
});

// ─── Start Server ─────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`\n Code Collab server running on http://localhost:${PORT}`);
    console.log(` Socket.IO ready for real-time connections`);
    console.log(`  Rate limiting: 60 requests/min per IP`);
    console.log(` Room persistence: ${path.join(__dirname, 'data', 'rooms.json')}\n`);
});
