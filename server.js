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

const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage });

let liveChat;

function broadcastUpdate() {
    const total = state.votes.A + state.votes.B || 1;
    io.emit('update', {
        percentA: Math.round((state.votes.A / total) * 100),
        percentB: Math.round((state.votes.B / total) * 100),
        config: state.config,
        isActive: state.isActive
    });
}

app.post('/api/control', (req, res) => {
    const { action, config } = req.body;
    if (config) state.config = { ...state.config, ...config };

    if (action === 'start' && state.config.videoId) {
        state.isActive = true;
        try {
            if (liveChat) { liveChat.stop(); }
            liveChat = new LiveChat({ liveId: state.config.videoId });
            
            liveChat.on('chat', (item) => {
                if (!state.isActive || !item.message) return;
                const msg = item.message[0].text.trim().toUpperCase();
                const uid = item.author.channelId;
                if (!votedUsersSet.has(uid)) {
                    if (msg === state.config.keyA.toUpperCase()) { state.votes.A++; votedUsersSet.add(uid); }
                    else if (msg === state.config.keyB.toUpperCase()) { state.votes.B++; votedUsersSet.add(uid); }
                    saveData(); broadcastUpdate();
                }
            });

            liveChat.on('error', (err) => { 
                console.error("Chat Error:", err);
                state.isActive = false;
            });

            liveChat.start().catch(e => {
                console.error("Start failed:", e);
                state.isActive = false;
            });
        } catch (e) { console.error("Crash prevention:", e); }
    } else if (action === 'pause') {
        state.isActive = false;
        if (liveChat) liveChat.stop();
    } else if (action === 'restart') {
        state.votes = { A: 0, B: 0 };
        votedUsersSet.clear();
    }

    saveData();
    broadcastUpdate();
    res.sendStatus(200);
});

app.get('/api/state', (req, res) => res.json(state));
app.post('/api/manual-vote', (req, res) => {
    if (req.body.team === 'A') state.votes.A++; else state.votes.B++;
    saveData(); broadcastUpdate(); res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server: ${PORT}`));
