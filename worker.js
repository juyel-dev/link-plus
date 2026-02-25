self.onmessage = async function(e) {
    if (e.data.type === 'compress') {
        const file = e.data.file;
        const bitmap = await createImageBitmap(file);
        const canvas = new OffscreenCanvas(1280, 720);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.82});
        self.postMessage({blob});
    }
};
