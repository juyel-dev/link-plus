self.onmessage = function(e) {
    const { file, chunkSize = 65536 } = e.data;
    const reader = new FileReader();

    reader.onload = function() {
        const base64 = reader.result.split(',')[1];
        const totalChunks = Math.ceil(base64.length / chunkSize);
        
        for (let i = 0; i < totalChunks; i++) {
            const chunk = base64.slice(i * chunkSize, (i + 1) * chunkSize);
            self.postMessage({
                type: 'chunk',
                chunk,
                index: i,
                total: totalChunks,
                fileName: file.name
            });
        }
    };
    reader.readAsDataURL(file);
};
