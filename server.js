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

// Ma'lumotlarni saqlash uchun fayl yo'li
const DATA_FILE = './state.json';

// Dastlabki holat
let state = {
    isActive: false,
    votes: { A: 0, B: 0 },
    votedUsers: [], // JSON faylda saqlash uchun Array qilamiz
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

// Fayldan ma'lumotlarni yuklash funksiyasi
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE);
        const savedData = JSON.parse(rawData);
        state = savedData;
        // votedUsers ni yana Set ga aylantiramiz (tez ishlashi uchun)
        state.votedUsersSet = new Set(state.votedUsers);
        console.log("Ma'lumotlar fayldan yuklandi.");
    } else {
        state.votedUsersSet = new Set();
    }
}

// Ma'lumotlarni faylga saqlash funksiyasi
function saveData() {
    state.votedUsers = Array.from(state.votedUsersSet);
    const dataToSave = { ...state };
    delete dataToSave.votedUsersSet; // Set ni JSON ga yozib bo'lmaydi
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
}

loadData();

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
        votes: state.votes // Admin panelda sonlarni ko'rish uchun
    });
}

app.post('/api/upload', upload.fields([{ name: 'logoA' }, { name: 'logoB' }]), (req, res) => {
    if (req.files.logoA) state.config.logoA = '/uploads/' + req.files.logoA[0].filename;
    if (req.files.logoB) state.config.logoB = '/uploads/' + req.files.logoB[0].filename;
    saveData();
    broadcastUpdate();
    res.json(state.config);
});

app.post('/api/control', (req, res) => {
    const { action, videoId, config } = req.body;
    
    if (config) state.config = { ...state.config, ...config };

    if (action === 'start') {
        const targetId = videoId || state.config.videoId;
        if (!targetId) return res.status(400).send("Video ID yo'q");
        
        state.config.videoId = targetId;
        state.isActive = true;
        
        if (liveChat) { try { liveChat.stop(); } catch(e) {} }
        
        liveChat = new LiveChat({ liveId: targetId });
        liveChat.on('chat', (item) => {
            if (!state.isActive) return;
            if (!item.message || !item.message[0] || !item.message[0].text) return;

            const userMsg = item.message.map(m => m.text).join("").trim().toUpperCase();
            const userId = item.author.channelId;

            if (!state.votedUsersSet.has(userId)) {
                if (userMsg === state.config.keyA.toUpperCase()) {
                    state.votes.A++;
                    state.votedUsersSet.add(userId);
                    saveData();
                    broadcastUpdate();
                } else if (userMsg === state.config.keyB.toUpperCase()) {
                    state.votes.B++;
                    state.votedUsersSet.add(userId);
                    saveData();
                    broadcastUpdate();
                }
            }
        });
        liveChat.start();
        console.log(`Chat kuzatilyapti: ${targetId}`);
    } else if (action === 'pause') {
        state.isActive = false;
    } else if (action === 'restart') {
        state.votes = { A: 0, B: 0 };
        state.votedUsersSet.clear();
        state.votedUsers = [];
    }
    
    saveData();
    broadcastUpdate();
    res.sendStatus(200);
});

app.post('/api/manual-vote', (req, res) => {
    if (req.body.team === 'A') state.votes.A++;
    else state.votes.B++;
    saveData();
    broadcastUpdate();
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ishga tushdi: http://localhost:${PORT}`);
});