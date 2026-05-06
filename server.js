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

// Ma'lumotlarni yuklash
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const rawData = fs.readFileSync(DATA_FILE);
            const savedData = JSON.parse(rawData);
            state = { ...state, ...savedData };
            votedUsersSet = new Set(state.votedUsers || []);
        } catch (e) { console.error("JSON yuklashda xato:", e); }
    }
}

// Ma'lumotlarni saqlash
function saveData() {
    state.votedUsers = Array.from(votedUsersSet);
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

loadData();

const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

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

// API: Nazorat paneli
app.post('/api/control', (req, res) => {
    const { action, config } = req.body;
    
    if (config) {
        state.config = { ...state.config, ...config };
    }

    if (action === 'start') {
        state.isActive = true;
        if (state.config.videoId) {
            // Avvalgi ulanishni to'xtatish
            if (liveChat) { try { liveChat.stop(); } catch(e){} }

            try {
                liveChat = new LiveChat({ liveId: state.config.videoId });

                liveChat.on('chat', (item) => {
                    if (!state.isActive || !item.message) return;
                    
                    const msgText = item.message[0].text;
                    const author = item.author.name;
                    const uid = item.author.channelId;

                    // Admin panelga xabarni yuborish
                    io.emit('chat_log', { author, msg: msgText });

                    if (!votedUsersSet.has(uid)) {
                        const cleanMsg = msgText.trim().toUpperCase();
                        if (cleanMsg === state.config.keyA.toUpperCase()) {
                            state.votes.A++;
                            votedUsersSet.add(uid);
                            saveData();
                            broadcastUpdate();
                        } else if (cleanMsg === state.config.keyB.toUpperCase()) {
                            state.votes.B++;
                            votedUsersSet.add(uid);
                            saveData();
                            broadcastUpdate();
                        }
                    }
                });

                liveChat.on('error', (err) => {
                    io.emit('chat_log', { author: 'TIZIM', msg: 'Xato: ' + err.message });
                });

                liveChat.start()
                    .then(() => io.emit('chat_log', { author: 'TIZIM', msg: 'Muvaffaqiyatli ulandi! Chat kutilmoqda...' }))
                    .catch(e => {
                        io.emit('chat_log', { author: 'TIZIM', msg: 'YouTube xatosi: ' + e.message });
                        state.isActive = false;
                    });

            } catch (e) {
                console.error("Chat ulanishda xato:", e);
            }
        }
    } else if (action === 'pause') {
        state.isActive = false;
        if (liveChat) { liveChat.stop(); }
        io.emit('chat_log', { author: 'TIZIM', msg: 'To\'xtatildi.' });
    } else if (action === 'restart') {
        state.votes = { A: 0, B: 0 };
        votedUsersSet.clear();
        saveData();
        broadcastUpdate();
        io.emit('chat_log', { author: 'TIZIM', msg: 'Ovozlar nollandi.' });
    }

    saveData();
    broadcastUpdate();
    res.sendStatus(200);
});

app.post('/api/upload', upload.fields([{ name: 'logoA' }, { name: 'logoB' }]), (req, res) => {
    if (req.files['logoA']) state.config.logoA = '/uploads/' + req.files['logoA'][0].filename;
    if (req.files['logoB']) state.config.logoB = '/uploads/' + req.files['logoB'][0].filename;
    saveData();
    broadcastUpdate();
    res.json(state.config);
});

app.get('/api/state', (req, res) => res.json(state));

app.post('/api/manual-vote', (req, res) => {
    if (req.body.team === 'A') state.votes.A++;
    else state.votes.B++;
    saveData();
    broadcastUpdate();
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
