// =============== CONFIG & GLOBALS ===============
const CONFIG = {
    STUN: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
    CHUNK_SIZE: 64 * 1024,   // 64KB
    MAX_IMAGE_SIZE: 15 * 1024 * 1024
};

let roomId = '';
let myUsername = localStorage.getItem('username') || `User${Math.floor(Math.random()*9999)}`;
let localStream = null;
let peers = new Map(); // peerId => {pc, dc, name, videoEl, candidates:[] }
let currentSignalingPeerId = null;
let worker = new Worker('worker.js');
let db = null;

// =============== INDEXEDDB ===============
async function initDB() {
    db = await window.openLinkDB(); // from indexeddb.js
}

// =============== ROOM & DEEP LINK ===============
function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const arr = new Uint8Array(10);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join('');
}

function initRoom() {
    const hash = location.hash.slice(1);
    const params = new URLSearchParams(hash);
    roomId = params.get('room') || generateRoomId();
    location.hash = `room=${roomId}`;
    document.getElementById('room-id').textContent = roomId;
    document.title = `link+ – ${roomId}`;
}

// =============== PEER CONNECTION FACTORY ===============
function createPeerConnection(peerId, isInitiator = false) {
    const pc = new RTCPeerConnection({ iceServers: CONFIG.STUN });

    pc.onicecandidate = e => {
        if (e.candidate) {
            const p = peers.get(peerId);
            if (p) p.candidates.push(e.candidate);
            updateLocalCandidatesUI();
        }
    };

    pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') updateLocalCandidatesUI();
    };

    pc.ondatachannel = e => {
        const dc = e.channel;
        setupDataChannel(peerId, dc);
    };

    pc.ontrack = e => {
        const p = peers.get(peerId);
        if (p && p.videoEl) p.videoEl.srcObject = e.streams[0];
    };

    const dc = pc.createDataChannel('linkplus', { ordered: true, reliable: true });
    setupDataChannel(peerId, dc);

    peers.set(peerId, { pc, dc, name: peerId, candidates: [], videoEl: null });

    if (isInitiator) {
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => showSignalingModal(peerId));
    }

    updatePeersList();
    return pc;
}

function setupDataChannel(peerId, dc) {
    dc.onopen = () => {
        console.log(`DC open with ${peerId}`);
        dc.send(JSON.stringify({ type: 'hello', username: myUsername }));
        updateDeliveryStatus(peerId, 'connected');
    };

    dc.onmessage = async e => {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        handleIncomingData(peerId, data);
    };

    dc.onclose = () => cleanupPeer(peerId);
}

// =============== INCOMING DATA HANDLER ===============
async function handleIncomingData(peerId, payload) {
    if (payload.type === 'hello') {
        const p = peers.get(peerId);
        if (p) p.name = payload.username;
        updatePeersList();
        return;
    }

    if (payload.type === 'text') {
        addMessage(payload.text, 'received', peerId);
        // send delivery ack
        const dc = peers.get(peerId)?.dc;
        if (dc) dc.send(JSON.stringify({ type: 'delivered', id: payload.id }));
    }

    if (payload.type === 'file-meta') {
        // start receiving chunks
        window.currentFile = { id: payload.id, name: payload.name, size: payload.size, chunks: [], received: 0 };
    }

    if (payload.type === 'file-chunk') {
        if (!window.currentFile) return;
        window.currentFile.chunks[payload.index] = payload.data;
        window.currentFile.received += payload.data.byteLength;
        // progress UI ...
        if (window.currentFile.received >= window.currentFile.size) {
            const blob = new Blob(window.currentFile.chunks);
            showImagePreview(blob, window.currentFile.name);
            window.currentFile = null;
        }
    }

    if (payload.type === 'typing') {
        showTypingIndicator(peerId);
    }
}

// =============== FILE CHUNK SEND (via worker) ===============
async function sendFile(file, targetPeerIds = null) {
    const targets = targetPeerIds || Array.from(peers.keys());
    const compressed = await compressImageViaWorker(file); // returns Blob

    const arrayBuffer = await compressed.arrayBuffer();
    const totalChunks = Math.ceil(arrayBuffer.byteLength / CONFIG.CHUNK_SIZE);

    const meta = {
        type: 'file-meta',
        id: Date.now().toString(36),
        name: file.name,
        size: arrayBuffer.byteLength,
        chunks: totalChunks
    };

    targets.forEach(id => {
        const dc = peers.get(id)?.dc;
        if (dc && dc.readyState === 'open') dc.send(JSON.stringify(meta));
    });

    for (let i = 0; i < totalChunks; i++) {
        const start = i * CONFIG.CHUNK_SIZE;
        const chunk = arrayBuffer.slice(start, start + CONFIG.CHUNK_SIZE);
        const payload = { type: 'file-chunk', index: i, data: chunk };
        targets.forEach(id => {
            const dc = peers.get(id)?.dc;
            if (dc) dc.send(payload); // ArrayBuffer is sent directly
        });
    }
}

// Worker communication
function compressImageViaWorker(file) {
    return new Promise(resolve => {
        worker.onmessage = e => resolve(e.data.blob);
        worker.postMessage({ type: 'compress', file });
    });
}

// =============== VIDEO / AUDIO ===============
async function startMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const localVideo = document.createElement('video');
    localVideo.srcObject = localStream;
    localVideo.muted = true;
    localVideo.autoplay = true;
    localVideo.playsInline = true;
    document.getElementById('video-grid').appendChild(localVideo);

    // add to all existing peers
    for (const [id, p] of peers) {
        localStream.getTracks().forEach(track => p.pc.addTrack(track, localStream));
    }
}

// =============== SIGNALING UI ===============
function showSignalingModal(peerId) {
    currentSignalingPeerId = peerId;
    document.getElementById('modal-peer-name').textContent = peers.get(peerId).name || peerId;
    document.getElementById('signaling-modal').classList.remove('hidden');
    updateLocalSDPUI();
}

function updateLocalSDPUI() {
    const p = peers.get(currentSignalingPeerId);
    if (!p) return;
    document.getElementById('local-sdp').value = JSON.stringify(p.pc.localDescription);
    document.getElementById('local-candidates').value = p.candidates.map(c => JSON.stringify(c)).join('\n');
}

// Event listeners (added in init())
document.getElementById('create-offer-btn').onclick = async () => {
    const p = peers.get(currentSignalingPeerId);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    updateLocalSDPUI();
};

// set remote + answer logic, add candidates, etc. (full implementation follows same pattern)

// =============== CHAT UI ===============
function addMessage(text, direction, from) {
    const div = document.createElement('div');
    div.className = `message ${direction}`;
    div.innerHTML = `<strong>${from}:</strong> ${text}`;
    document.getElementById('messages').appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
}

// =============== INIT ===============
async function init() {
    await initDB();
    initRoom();
    registerServiceWorker();

    // dark mode from localStorage
    if (localStorage.getItem('dark') === 'false') document.documentElement.style.setProperty('--bg', '#f8f9fa');

    document.getElementById('add-peer-btn').onclick = () => {
        const name = prompt('Peer label (e.g. Alice):', 'Peer' + (peers.size + 1));
        if (!name) return;
        createPeerConnection(name, true); // initiator
    };

    document.getElementById('copy-link-btn').onclick = () => {
        navigator.clipboard.writeText(location.href);
        showToast('Deep link copied!');
    };

    // file upload
    document.getElementById('file-upload').onchange = e => {
        if (e.target.files[0]) sendFile(e.target.files[0]);
    };

    // keyboard send
    document.getElementById('chat-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') sendTextMessage();
    });

    // all other listeners attached similarly...
    showToast('link+ ready – share the room link and exchange SDP manually');
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').then(() => console.log('SW registered'));
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.opacity = 1;
    setTimeout(() => t.style.opacity = 0, 2800);
}

// Start everything
window.onload = init;
