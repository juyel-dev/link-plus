const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let peerConn, dataChannel, localStream;
let isHost = false;

// UI Elements
const ui = {
    setup: document.getElementById('signaling-screen'),
    workspace: document.getElementById('workspace'),
    localToken: document.getElementById('local-token'),
    remoteToken: document.getElementById('remote-token'),
    chatBox: document.getElementById('chat-box'),
    status: document.getElementById('connection-status')
};

// --- 1. MEDIA SETUP (Camera & Screen Share) ---
async function setupMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
        localStream.getTracks().forEach(track => peerConn.addTrack(track, localStream));
    } catch (e) {
        console.warn("Camera access denied or unavailable.");
    }
}

document.getElementById('toggle-screen').onclick = async () => {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        const sender = peerConn.getSenders().find(s => s.track.kind === 'video');
        sender.replaceTrack(screenTrack);
        
        document.getElementById('local-video').srcObject = screenStream;

        // Revert to camera when screen sharing stops
        screenTrack.onended = async () => {
            sender.replaceTrack(localStream.getVideoTracks()[0]);
            document.getElementById('local-video').srcObject = localStream;
        };
    } catch (e) { console.error("Screen share failed", e); }
};

// --- 2. ADVANCED SIGNALING (Base64 Tokens) ---
document.getElementById('btn-host').onclick = async () => {
    isHost = true;
    document.getElementById('host-section').classList.remove('hidden');
    initWebRTC();
};

document.getElementById('btn-connect').onclick = async () => {
    if (!peerConn) initWebRTC();
    
    try {
        const token = ui.remoteToken.value.trim();
        const sdpStr = atob(token); // Decode Base64
        const desc = new RTCSessionDescription(JSON.parse(sdpStr));
        await peerConn.setRemoteDescription(desc);

        if (!isHost) {
            const answer = await peerConn.createAnswer();
            await peerConn.setLocalDescription(answer);
        }
        ui.setup.classList.add('hidden');
        ui.workspace.classList.remove('hidden');
    } catch (e) {
        alert("Invalid Token! Make sure you copied the whole string.");
    }
};

async function initWebRTC() {
    peerConn = new RTCPeerConnection(config);
    await setupMedia();

    // Data Channel (Text + Files)
    if (isHost) {
        dataChannel = peerConn.createDataChannel("secure-data");
        setupDataChannel();
    } else {
        peerConn.ondatachannel = (e) => {
            dataChannel = e.channel;
            setupDataChannel();
        };
    }

    // Media Receiving
    peerConn.ontrack = (e) => {
        document.getElementById('remote-video').srcObject = e.streams[0];
    };

    // Advanced ICE Gathering (Wait for all candidates before generating token)
    peerConn.onicecandidate = (e) => {
        if (e.candidate === null) {
            // ICE gathering complete, generate single Base64 token
            const sdpJson = JSON.stringify(peerConn.localDescription);
            const base64Token = btoa(sdpJson); 
            ui.localToken.value = base64Token;
        }
    };

    if (isHost) {
        const offer = await peerConn.createOffer();
        await peerConn.setLocalDescription(offer);
    }
}

// --- 3. SECURE MESSAGING & FILE CHUNKING ---
function setupDataChannel() {
    dataChannel.binaryType = "arraybuffer";
    dataChannel.onopen = () => {
        ui.status.innerText = "Secure Connection Active";
        ui.status.className = "badge badge-green";
    };

    let incomingFileInfo = null;
    let incomingFileData = [];
    let bytesReceived = 0;

    dataChannel.onmessage = (e) => {
        if (typeof e.data === 'string') {
            const msg = JSON.parse(e.data);
            if (msg.type === 'text') {
                appendChat('Peer', msg.content, 'msg-peer');
            } else if (msg.type === 'file-meta') {
                incomingFileInfo = msg.meta;
                incomingFileData = [];
                bytesReceived = 0;
            } else if (msg.type === 'file-done') {
                const blob = new Blob(incomingFileData);
                const url = URL.createObjectURL(blob);
                appendChat('Peer', `<a href="${url}" download="${incomingFileInfo.name}" style="color:white; text-decoration:underline;">📥 Download ${incomingFileInfo.name}</a>`, 'msg-peer');
                incomingFileInfo = null;
            }
        } else {
            // Receiving ArrayBuffer File Chunk
            incomingFileData.push(e.data);
            bytesReceived += e.data.byteLength;
        }
    };
}

// Send Text Message
document.getElementById('send-btn').onclick = () => {
    const input = document.getElementById('chat-input');
    if (!input.value.trim()) return;
    
    dataChannel.send(JSON.stringify({ type: 'text', content: input.value }));
    appendChat('Me', input.value, 'msg-me');
    input.value = '';
};

// Send File (Chunking Logic)
document.getElementById('file-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const CHUNK_SIZE = 16384; // 16KB max for WebRTC stability
    const progressEl = document.getElementById('file-progress');
    document.getElementById('file-progress-container').classList.remove('hidden');
    document.getElementById('file-name').innerText = `Sending: ${file.name}`;

    // Send Metadata
    dataChannel.send(JSON.stringify({ type: 'file-meta', meta: { name: file.name, size: file.size } }));

    // Read and chunk file
    const arrayBuffer = await file.arrayBuffer();
    let offset = 0;

    const sendChunk = () => {
        while (offset < arrayBuffer.byteLength) {
            if (dataChannel.bufferedAmount > 65535) {
                // Buffer full, pause and wait
                setTimeout(sendChunk, 50);
                return;
            }
            const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
            dataChannel.send(chunk);
            offset += CHUNK_SIZE;
            progressEl.value = (offset / file.size) * 100;
        }
        
        // Done
        dataChannel.send(JSON.stringify({ type: 'file-done' }));
        document.getElementById('file-progress-container').classList.add('hidden');
        appendChat('Me', `📎 Sent file: ${file.name}`, 'msg-me');
    };
    sendChunk();
};

function appendChat(user, htmlContent, className) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    div.innerHTML = `<strong>${user}:</strong><br>${htmlContent}`;
    ui.chatBox.appendChild(div);
    ui.chatBox.scrollTop = ui.chatBox.scrollHeight;
}

// UI Helpers
document.getElementById('copy-token').onclick = () => {
    navigator.clipboard.writeText(ui.localToken.value);
    alert("Token copied! Send it securely to your peer.");
};
