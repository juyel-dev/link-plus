const QRUtils = {
    showSDP(sdp) {
        const modal = document.getElementById('modal-overlay');
        const container = document.getElementById('qr-container');
        const textarea = document.getElementById('sdp-transfer');
        
        modal.classList.remove('hidden');
        textarea.value = btoa(sdp); // Base64 encode for easier copy
        
        // Generate QR
        const qr = qrcode(0, 'M');
        qr.addData(textarea.value);
        qr.make();
        container.innerHTML = qr.createImgTag(5);
    }
};
