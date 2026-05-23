const { io } = require('socket.io-client');
const http = require('http');
const fs = require('fs');
const path = require('path');

function post(url, data) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const postData = JSON.stringify(data);
        const options = {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body ? JSON.parse(body) : null
                });
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function runSocketTests() {
    console.log('=== RUNNING SOCKET.IO INTEGRATION TESTS ===');
    
    let roomId;
    try {
        // 1. Create a room first
        const createRes = await post('http://localhost:3000/api/rooms', { isPublic: false });
        roomId = createRes.body.roomId;
        console.log(`Created room: ${roomId}`);
    } catch (err) {
        console.error('Failed to create room via API:', err);
        process.exit(1);
    }

    // 2. Connect client
    const socket = io('http://localhost:3000', {
        transports: ['websocket'],
        forceNew: true
    });

    socket.on('connect', () => {
        console.log('Socket connected successfully!');

        // 3. Join Room
        socket.emit('join-room', {
            roomId: roomId,
            user: { name: 'Alice' }
        });
    });

    socket.on('error-msg', (msg) => {
        console.error('Received error-msg:', msg);
        socket.disconnect();
        process.exit(1);
    });

    socket.on('room-state', (data) => {
        console.log('Received room-state event!');
        console.log('- Server Assigned UID:', data.uid);
        console.log('- HTML content:', JSON.stringify(data.html));
        console.log('- Participants count:', data.participants.length);

        if (!data.uid) {
            console.error('TEST FAILED: No server-assigned UID received!');
            socket.disconnect();
            process.exit(1);
        }

        if (data.participants.length !== 1 || data.participants[0].name !== 'Alice') {
            console.error('TEST FAILED: Alice not found in participants list!');
            socket.disconnect();
            process.exit(1);
        }

        // 4. Test code change input validation
        console.log('Sending valid code change...');
        socket.emit('code-change', {
            roomId: roomId,
            lang: 'html',
            value: '<h1>Alice was here</h1>'
        });

        // 5. Test invalid code change (too large)
        console.log('Sending invalid code change (value size exceeds limit)...');
        const hugeCode = 'a'.repeat(600 * 1024); // 600KB (max is 500KB)
        socket.emit('code-change', {
            roomId: roomId,
            lang: 'html',
            value: hugeCode
        });
    });

    // Listen for code updates to verify valid code change broadcast
    socket.on('code-update', (data) => {
        console.log('Received code-update:', data);
        if (data.lang === 'html' && data.value === '<h1>Alice was here</h1>') {
            console.log('Valid code change was successfully broadcasted!');
            
            // Wait for 3 seconds to let room persistence debounce write the file
            console.log('Waiting for persistence debouncer...');
            setTimeout(() => {
                const roomsFilePath = path.join(__dirname, 'backend', 'data', 'rooms.json');
                if (fs.existsSync(roomsFilePath)) {
                    const content = JSON.parse(fs.readFileSync(roomsFilePath, 'utf8'));
                    const persistedRoom = content[roomId];
                    if (persistedRoom && persistedRoom.html === '<h1>Alice was here</h1>') {
                        console.log('Room persistence verified: html was successfully written to rooms.json on disk!');
                        console.log('\nAll Socket.IO integration tests completed successfully!');
                        socket.disconnect();
                        process.exit(0);
                    } else {
                        console.error('TEST FAILED: Room not found or code not updated in rooms.json! Persisted Room:', persistedRoom);
                        socket.disconnect();
                        process.exit(1);
                    }
                } else {
                    console.error('TEST FAILED: data/rooms.json does not exist!');
                    socket.disconnect();
                    process.exit(1);
                }
            }, 3000);
        }
    });
}

runSocketTests();
