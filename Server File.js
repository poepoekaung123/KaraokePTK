const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

const PORT = 3000;

// Static files (HTML, CSS, JS) များကို ဧရိယာသတ်မှတ်ပေးခြင်း
app.use(express.static(path.join(__dirname, 'www')));

// Internal နှင့် External (OTG / Hard Disk) Storage လမ်းကြောင်းများ
const STORAGE_ROOTS = [
    '/sdcard/KTV',                  // Internal Storage
    '/storage/emulated/0/KTV',      // Alternative Internal Storage Path
    '/storage'                      // External USB / Hard Disk Mount Path များကို ရှာဖွေရန်
];

// Storage နှစ်ခုစလုံးမှ သီချင်းဖိုင်ကို ရှာဖွေပေးမည့် Function
function findSongPath(relativePath) {
    const cleanRelPath = relativePath.replace(/^[\/\\]/, '');

    for (let root of STORAGE_ROOTS) {
        if (!fs.existsSync(root)) continue;

        if (root === '/storage') {
            try {
                const drives = fs.readdirSync(root);
                for (let drive of drives) {
                    const fullPath = path.join(root, drive, 'KTV', cleanRelPath);
                    if (fs.existsSync(fullPath)) {
                        return fullPath;
                    }
                }
            } catch (err) {
                console.error('Error reading /storage:', err);
            }
        } else {
            const fullPath = path.join(root, cleanRelPath);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
    }
    return null;
}

// Video Streaming & Local File Playing Route
app.get('/stream', (req, res) => {
    const songPath = req.query.path; 
    if (!songPath) {
        return res.status(400).send('Bad Request: Missing path');
    }

    const actualFilePath = findSongPath(songPath);
    if (!actualFilePath || !fs.existsSync(actualFilePath)) {
        return res.status(404).send('Song file not found in Internal or External Storage');
    }

    const stat = fs.statSync(actualFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(actualFilePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(actualFilePath).pipe(res);
    }
});

// Queue Management (Socket.io)
let queue = [];
let currentSong = null;

io.on('connection', (socket) => {
    console.log('Remote/Screen connected:', socket.id);

    socket.emit('updateQueue', { queue, currentSong });

    socket.on('addSong', (song) => {
        queue.push(song);
        io.emit('updateQueue', { queue, currentSong });
    });

    socket.on('nextSong', () => {
        if (queue.length > 0) {
            currentSong = queue.shift();
        } else {
            currentSong = null;
        }
        io.emit('playNext', currentSong);
        io.emit('updateQueue', { queue, currentSong });
    });
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`Karaoke Multi-Storage Server running on port ${PORT}`);
});