require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

try {
    fs.writeFileSync('debug_extraction.log', `SERVER STARTUP AT ${new Date().toISOString()}\n`);
} catch (e) { console.error('Failed to write debug log', e); }

const PORT = process.env.PORT || 3000;

// ─── In-Memory Room Store ─────────────────────────────────────────────
const rooms = new Map();

function getRoomData(roomId) {
    return rooms.get(roomId) || null;
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
        createdAt: new Date()
    };
    rooms.set(roomId, room);
    return room;
}

// ─── Express + Socket.IO Setup ────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // Trust first proxy (Render, Railway, etc.)
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ─── Middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    const roomId = Math.random().toString(36).substring(2, 9);
    const room = createRoom(roomId, !!isPublic);
    res.json({ roomId, room });
});

// Check if a room exists (this MUST come before /api/rooms/random/public)
app.get('/api/rooms/random/public', (req, res) => {
    const publicRooms = [];
    rooms.forEach((room, id) => {
        if (room.isPublic && room.participants.length < 6) {
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
    console.log('--- RAW AI RESPONSE ---');
    console.log(text);
    console.log('-----------------------');
    try { fs.writeFileSync('debug_ai_response.txt', text); } catch (e) { }

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
        const room = getRoomData(roomId);
        if (!room) {
            socket.emit('error-msg', 'Room not found.');
            return;
        }

        currentRoom = roomId;
        currentUser = user;
        socket.join(roomId);

        // Add participant (avoid duplicates by uid)
        room.participants = room.participants.filter(p => p.uid !== user.uid);
        room.participants.push(user);

        // Send full room state to the joining user
        socket.emit('room-state', {
            html: room.html,
            css: room.css,
            js: room.js,
            participants: room.participants,
            messages: room.messages
        });

        // Broadcast updated participants to everyone in the room
        io.to(roomId).emit('participants-update', room.participants);
    });

    // Code change
    socket.on('code-change', ({ roomId, lang, value }) => {
        const room = getRoomData(roomId);
        if (!room) return;

        // Update the room data
        room[lang] = value;

        // Broadcast to everyone EXCEPT the sender
        socket.to(roomId).emit('code-update', { lang, value });
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
        const room = getRoomData(roomId);
        if (!room || !currentUser) return;

        const message = {
            text,
            senderName: currentUser.name,
            senderUid: currentUser.uid,
            timestamp: new Date().toISOString()
        };

        room.messages.push(message);

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
                body: JSON.stringify({ prompt: codeContext, max_tokens: 2048, temperature: 0.7 })
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
            const rawText = data.raw || data.response || data.text || data.generated_text || '';
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

    // Leave room
    socket.on('leave-room', () => {
        handleDisconnect();
    });

    // Disconnect (tab close, network drop)
    socket.on('disconnect', () => {
        handleDisconnect();
    });

    function handleDisconnect() {
        if (currentRoom && currentUser) {
            const room = getRoomData(currentRoom);
            if (room) {
                room.participants = room.participants.filter(p => p.uid !== currentUser.uid);
                io.to(currentRoom).emit('participants-update', room.participants);

                // Clean up empty rooms after 5 minutes
                if (room.participants.length === 0) {
                    const roomToClean = currentRoom;
                    setTimeout(() => {
                        const check = getRoomData(roomToClean);
                        if (check && check.participants.length === 0) {
                            rooms.delete(roomToClean);
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
    console.log(`\n🚀 Code Collab server running on http://localhost:${PORT}`);
    console.log(`⚡ Socket.IO ready for real-time connections`);
    console.log(`🛡️  Rate limiting: 60 requests/min per IP\n`);
});
