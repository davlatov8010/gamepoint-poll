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

// Boshlang'ich holat
let state = {
    isActive: false,
    votes: { A: 0, B: 0 },
    votedUsers: [],
    config: {
        keyA: '!M',
        keyB: '!F',
        teamAName: 'Team Alpha',
        teamBName: 'Team Beta',
        logoA: 'https://via.placeholder.com/100',
        logoB: 'https://via.placeholder.com/100',
        videoId: ''
    }
};

let votedUsersSet = new Set();

// Ma'lumotlarni yuklash funksiyasi
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

// Ma'lumotlarni saqlash funksiyasi
function saveData() {
    state.votedUsers = Array.from(votedUsersSet);
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

loadData();

// Rasm yuklash mexanizmi
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

let liveChat;

io.on('connection', (socket) => {
    broadcastUpdate();
});

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

// Rasm yuklash API
app.post('/api/upload', upload.fields([{ name: 'logoA' }, { name: 'logoB' }]), (req, res) => {
    if (req.files && req.files['logoA']) state.config.logoA = '/uploads/' + req.files['logoA'][0].filename;
    if (req.files && req.files['logoB']) state.config.logoB = '/uploads/' + req.files['logoB'][0].filename;
    saveData();
    broadcastUpdate();
    res.json(state.config);
});

// Boshqaruv API (START, PAUSE, RESTART, UPDATE)
app.post('/api/control', (req, res) => {
    const { action, config } = req.body;
    
    if (config) {
        state.config = { ...state.config, ...config };
    }

    if (action === 'start') {
        state.isActive = true;
        if (state.config.videoId) {
            if (liveChat) { try { liveChat.stop(); } catch(e){} }
            liveChat = new LiveChat({ liveId: state.config.videoId });
            liveChat.on('chat', (item) => {
                if (!state.isActive) return;
                const msg = item.message[0].text.trim().toUpperCase();
                const uid = item.author.channelId;
                if (!votedUsersSet.has(uid)) {
                    if (msg === state.config.keyA.toUpperCase()) {
                        state.votes.A++;
                        votedUsersSet.add(uid);
                        saveData();
                        broadcastUpdate();
                    } else if (msg === state.config.keyB.toUpperCase()) {
                        state.votes.B++;
                        votedUsersSet.add(uid);
                        saveData();
                        broadcastUpdate();
                    }
                }
            });
            liveChat.start();
        }
    } else if (action === 'pause') {
        state.isActive = false;
        if (liveChat) { try { liveChat.stop(); } catch(e){} }
    } else if (action === 'restart') {
        state.votes = { A: 0, B: 0 };
        votedUsersSet.clear();
        state.votedUsers = [];
        saveData();
    }

    saveData();
    broadcastUpdate();
    res.sendStatus(200);
});

// Qo'lda ovoz berish API
app.post('/api/manual-vote', (req, res) => {
    if (req.body.team === 'A') state.votes.A++;
    else state.votes.B++;
    saveData();
    broadcastUpdate();
    res.sendStatus(200);
});

// Joriy holatni olish API (Admin panel yuklanganda)
app.get('/api/state', (req, res) => {
    res.json(state);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
