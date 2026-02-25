let _db;
window.openLinkDB = () => new Promise((res, rej) => {
    const req = indexedDB.open('linkplus', 1);
    req.onupgradeneeded = ev => {
        _db = ev.target.result;
        if (!_db.objectStoreNames.contains('tempFiles')) _db.createObjectStore('tempFiles', {keyPath: 'id'});
    };
    req.onsuccess = ev => { _db = ev.target.result; res(_db); };
    req.onerror = rej;
});
