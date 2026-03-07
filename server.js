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

// ─── AI Response Parser ───────────────────────────────────────────────
// ─── AI Response Parser ───────────────────────────────────────────────

function parseCodeBlocks(text) {
    console.log('--- RAW AI RESPONSE ---');
    console.log(text);
    console.log('-----------------------');

    // Write to debug file
    try {
        fs.writeFileSync('debug_ai_response.txt', text);
    } catch (e) {
        console.error('Failed to write debug file:', e);
    }

    const result = { html: null, css: null, js: null };

    // 1. Try matching fenced code blocks: ```lang\n...code...\n```
    const blockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let match;
    let foundFences = false;

    while ((match = blockRegex.exec(text)) !== null) {
        foundFences = true;
        let lang = match[1].toLowerCase().trim();
        const code = match[2].trim();

        if (lang === 'html' || lang === 'xml') {
            result.html = code;
        } else if (lang === 'css') {
            result.css = code;
        } else if (lang === 'js' || lang === 'javascript') {
            result.js = code;
        } else if (lang === '') {
            if (code.trim().startsWith('<')) result.html = code;
            else if (code.includes('{') && code.includes(':')) result.css = code;
            else result.js = code;
        }
    }

    // 2. Fallback: If no fences, try extraction from raw text
    if (!foundFences) {
        console.log('No code fences found. Attempting extraction...');
        let remainingText = text;

        // Extract CSS from <style>...</style> (Case-insensitive, multiline)
        const styleMatch = remainingText.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        if (styleMatch) {
            result.css = styleMatch[1].trim();
            // Remove the style block from text so it doesn't get grabbed by HTML parser
            remainingText = remainingText.replace(/<style[^>]*>[\s\S]*?<\/style>/i, '');
        }

        // Extract JS from <script>...</script> (ignoring scripts with src)
        const scriptMatch = remainingText.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
        if (scriptMatch) {
            result.js = scriptMatch[1].trim();
            remainingText = remainingText.replace(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/i, '');
        }

        // 3. Try Section Headers on remaining text (e.g. "HTML:", "**CSS**")
        if (result.html === null) {
            const htmlMatch = remainingText.match(/(?:^|\n)(?:\*\*|#+\s*)?HTML(?:\*\*|:)?(?:\s*\n|\s+)([\s\S]*?)(?=(?:^|\n)(?:\*\*|#+\s*)?(?:CSS|JS|JAVASCRIPT)|$)/i);
            if (htmlMatch) {
                result.html = htmlMatch[1].trim();
            }
        }
    }

    // 4. Final Fallback: Treat entire text as HTML
    if (result.html === null && result.css === null && result.js === null) {
        const trimmed = text.trim();
        if (trimmed.startsWith('<')) result.html = trimmed;
    }

    // 5. Post-Processing: Extract embedded <style> and <script> from result.html
    if (result.html) {
        // Log to file for debugging
        try {
            fs.appendFileSync('debug_extraction.log', `\n--- NEW POST-PROCESSING ---\nHTML Length: ${result.html.length}\n`);
        } catch (e) { }

        // Extract ALL CSS
        while (true) {
            // Lenient regex: allows missing </style> if followed by </head>, </body>, </html>, or End of String
            const styleMatch = result.html.match(/<style[^>]*>([\s\S]*?)(?:<\/style>|(?=<\/head>|<\/body>|<\/html>|$))/i);
            if (!styleMatch) break;

            try { fs.appendFileSync('debug_extraction.log', `Found style at index ${styleMatch.index}\n`); } catch (e) { }

            const cssContent = styleMatch[1].trim();
            if (cssContent) {
                result.css = (result.css ? result.css + '\n\n' : '') + cssContent;
            }
            // Safe removal using substring (avoids regex replacement issues)
            const before = result.html.substring(0, styleMatch.index);
            const after = result.html.substring(styleMatch.index + styleMatch[0].length);
            result.html = (before + after).trim();
        }

        // Extract ALL JS
        while (true) {
            // Lenient regex: allows missing </script> if followed by </body>, </html>, or End of String
            const scriptMatch = result.html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)(?:<\/script>|(?=<\/body>|<\/html>|$))/i);
            if (!scriptMatch) break;

            try { fs.appendFileSync('debug_extraction.log', `Found script at index ${scriptMatch.index}\n`); } catch (e) { }

            const jsContent = scriptMatch[1].trim();
            if (jsContent) {
                result.js = (result.js ? result.js + '\n\n' : '') + jsContent;
            }
            // Safe removal using substring
            const before = result.html.substring(0, scriptMatch.index);
            const after = result.html.substring(scriptMatch.index + scriptMatch[0].length);
            result.html = (before + after).trim();
        }
    }

    // 6. Clean up code blocks
    const cleanCode = (code, type) => {
        if (!code) return null;

        // Strip wrapper tags for HTML
        if (type === 'html') {
            // Remove <body> wrappers (standard and AI hallucinations like <body content-only>)
            code = code.replace(/<body[^>]*>/i, '').replace(/<\/body>/i, '');
            // Remove <html> wrappers
            code = code.replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '');
            // Remove <head> wrappers
            code = code.replace(/<head[^>]*>/i, '').replace(/<\/head>/i, '');
        }

        // Strip chatty command lines at start
        const lines = code.split('\n');
        let startIndex = 0;

        // Log first line bytes for debugging
        if (lines.length > 0) {
            const firstLine = lines[0].trim();
            const hex = Buffer.from(firstLine).toString('hex');
            try {
                const logPath = path.join(__dirname, 'debug_extraction.log');
                fs.appendFileSync(logPath, `CleanCode Check: "${firstLine}" Hex: ${hex}\n`);
            } catch (e) { }
        }

        while (startIndex < lines.length) {
            const line = lines[startIndex].trim();
            if (!line) {
                startIndex++;
                continue;
            }
            // Skip lines starting with ( or Note: or Here is... AND aggressive filter for known bad strings
            if (line.startsWith('(') || line.startsWith('Note:') || line.match(/^Here is/i) || line.match(/^Sure,/i) ||
                line.match(/body content only/i) || line.match(/no html\/head\/body tags/i)) {
                startIndex++;
            } else {
                break;
            }
        }
        return lines.slice(startIndex).join('\n').trim();
    };

    result.html = cleanCode(result.html, 'html');
    result.css = cleanCode(result.css, 'css');
    result.js = cleanCode(result.js, 'js');

    console.log('--- PARSED RESULT ---');
    console.log(result);
    console.log('---------------------');

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

Please generate the complete updated code based on the user's request. If the user is asking to fix or debug their code, analyze the existing code, the console output, and provide corrected versions. Always respond with separate \`\`\`html, \`\`\`css, and \`\`\`js code blocks.`;

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
                // Backend provided pre-parsed fields, but they may contain AI hallucinated placeholders
                parsed.html = data.html || null;
                parsed.css = data.css || null;
                parsed.js = data.js || null;

                // Helper to clean placeholders specifically sent by Qwen Instruct
                const cleanBlock = (code) => {
                    if (!code) return null;
                    let c = code.trim();

                    // Remove the placeholder if it appears at the start of the code
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

                    return c || null; // Return null if the code is now empty
                };

                parsed.html = cleanBlock(parsed.html);
                parsed.css = cleanBlock(parsed.css);
                parsed.js = cleanBlock(parsed.js);

            } else if (rawText) {
                parsed = parseCodeBlocks(rawText);
            }

            // Update room data with AI-generated code (only if new code was found)
            room.html = parsed.html || room.html;
            room.css = parsed.css || room.css;
            room.js = parsed.js || room.js;

            console.log(`🤖 AI generated code in ${data.time_ms}ms for room ${roomId}`);

            // Broadcast ONLY the newly generated code to the frontend chat UI
            // If the AI didn't generate code for a file, it will be null here (which is correct)
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
