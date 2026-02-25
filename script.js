const CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

class LinkPlus {
    constructor() {
        this.localStream = null;
        this.peers = {}; // peerId -> { connection, dataChannel }
        this.roomId = null;
        this.username = localStorage.getItem('username') || 'Anonymous';
        
        this.initEventListeners();
        this.checkUrlHash();
    }

    initEventListeners() {
        document.getElementById('create-room-btn').onclick = () => this.createRoom();
        document.getElementById('send-btn').onclick = () => this.sendMessage();
        document.getElementById('toggle-video').onclick = () => this.toggleMedia('video');
        document.getElementById('toggle-audio').onclick = () => this.toggleMedia('audio');
    }

    async createRoom() {
        this.roomId = Math.random().toString(36).substring(2, 14).toUpperCase();
        this.showMainUI();
        // In a serverless setup, we generate an Offer and show it as a QR/Link
        this.initiatePeerConnection(true);
    }

    async initiatePeerConnection(isOffer, targetPeerId = null) {
        const pc = new RTCPeerConnection(CONFIG);
        const dc = pc.createDataChannel("chat", { negotiated: true, id: 0 });

        pc.onicecandidate = (e) => {
            if (!e.candidate) {
                // When gathering is finished, show the SDP
                QRUtils.showSDP(JSON.stringify(pc.localDescription));
            }
        };

        dc.onmessage = (e) => this.handleMessage(e.data);
        
        if (isOffer) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
        }

        this.peers[targetPeerId || 'pending'] = { pc, dc };
    }

    handleMessage(data) {
        const msg = JSON.parse(data);
        const msgDiv = document.createElement('div');
        msgDiv.className = `bubble received`;
        msgDiv.textContent = `${msg.user}: ${msg.text}`;
        document.getElementById('messages').appendChild(msgDiv);
        this.scrollToBottom();
    }

    sendMessage() {
        const input = document.getElementById('msg-input');
        const text = input.value;
        if (!text) return;

        const payload = JSON.stringify({ user: this.username, text, ts: Date.now() });
        
        Object.values(this.peers).forEach(peer => {
            if (peer.dc.readyState === 'open') peer.dc.send(payload);
        });

        // Add to local UI
        const msgDiv = document.createElement('div');
        msgDiv.className = `bubble sent`;
        msgDiv.textContent = text;
        document.getElementById('messages').appendChild(msgDiv);
        input.value = '';
        this.scrollToBottom();
    }

    scrollToBottom() {
        const container = document.getElementById('message-container');
        container.scrollTop = container.scrollHeight;
    }

    showMainUI() {
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('main-interface').classList.remove('hidden');
        document.getElementById('room-id-display').textContent = `Room: ${this.roomId}`;
    }
}

const app = new LinkPlus();
