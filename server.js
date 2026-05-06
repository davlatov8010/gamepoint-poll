const express = require('express');
const multer = require('multer');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { LiveChat } = require('youtube-chat');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

const DATA_FILE = './state.json';
let state = {
    isActive: false,
    votes: { A: 0, B: 0 },
    votedUsers: [],
    config: { keyA: '!M', keyB: '!F', teamAName: 'Team Alpha', teamBName: 'Team Beta', logoA: '', logoB: '', videoId: '' }
};

let votedUsersSet = new Set();

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const rawData = fs.readFileSync(DATA_FILE);
            state = JSON.parse(rawData);
            votedUsersSet = new Set(state.votedUsers || []);
        } catch (e) { console.error("JSON Error:", e); }
    }
}
function saveData() {
    state.votedUsers = Array.from(votedUsersSet);
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}
loadData();

let liveChat;

function broadcastUpdate() {
    const total = state.votes.A + state.votes.B || 1;
    io.emit('update', {
        percentA: Math.round((state.votes.A / total) * 100),
        percentB: Math.round((state.votes.B / total) * 100),
        config: state.config,
        votes: state.votes,
        isActive: state.isActive
    });
}

app.post('/api/control', (req, res) => {
    const { action, config } = req.body;
    if (config) state.config = { ...state.config, ...config };

    if (action === 'start' && state.config.videoId) {
        state.isActive = true;
        // Eski ulanishni tozalash
        if (liveChat) { try { liveChat.stop(); } catch(e){} }
        
        try {
            liveChat = new LiveChat({ liveId: state.config.videoId });
            
            liveChat.on('chat', (item) => {
                if (!state.isActive || !item.message) return;
                const msgText = item.message[0].text;
                io.emit('chat_log', { author: item.author.name, msg: msgText });

                const uid = item.author.channelId;
                if (!votedUsersSet.has(uid)) {
                    const cleanMsg = msgText.trim().toUpperCase();
                    if (cleanMsg === state.config.keyA.toUpperCase()) {
                        state.votes.A++; votedUsersSet.add(uid);
                        saveData(); broadcastUpdate();
                    } else if (cleanMsg === state.config.keyB.toUpperCase()) {
                        state.votes.B++; votedUsersSet.add(uid);
                        saveData(); broadcastUpdate();
                    }
                }
            });

            liveChat.on('error', (err) => {
                io.emit('chat_log', { author: 'TIZIM', msg: 'Ulanishda xato: ' + err.message });
            });

            // Ulanishni boshlash
            liveChat.start()
                .then(() => io.emit('chat_log', { author: 'TIZIM', msg: 'Muvaffaqiyatli ulandi!' }))
                .catch(e => io.emit('chat_log', { author: 'TIZIM', msg: 'Start xatosi: ' + e.message }));

        } catch (e) {
            io.emit('chat_log', { author: 'TIZIM', msg: 'Kritik xato: ' + e.message });
        }
    } else if (action === 'pause') {
        state.isActive = false;
        if (liveChat) liveChat.stop();
        io.emit('chat_log', { author: 'TIZIM', msg: 'Toxtatildi.' });
    } else if (action === 'restart') {
        state.votes = { A: 0, B: 0 };
        votedUsersSet.clear();
        saveData(); broadcastUpdate();
        io.emit('chat_log', { author: 'TIZIM', msg: 'Ovozlar nollandi.' });
    }

    saveData(); broadcastUpdate();
    res.sendStatus(200);
});

app.get('/api/state', (req, res) => res.json(state));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server is running` ));
