const { Client, LocalAuth } = require('whatsapp-web.js');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode');

const PORT = 3000;

// Initialize WebSocket Server
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server started on port ${PORT}`);

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: process.env.WA_DATA_PATH || './.wwebjs_auth'
    }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote', 
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--disable-web-security',
            '--ignore-certificate-errors'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    },
    authTimeoutMs: 0 // Wait indefinitely for QR scan
});

let lastQr = null;
let isReady = false;

// WebSocket Connection Handler
wss.on('connection', (ws) => {
    console.log('New client connected');

    // Send current state to new client
    if (isReady) {
        ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
    } else if (lastQr) {
        ws.send(JSON.stringify({ type: 'qr', data: lastQr }));
    } else {
        ws.send(JSON.stringify({ type: 'status', status: 'initializing' }));
    }

    // Handle incoming messages from HA
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received command:', data);

            if (data.type === 'send_message') {
                const { number, message: text, group_name } = data;
                await handleSendMessage(number, text, group_name);
            } else if (data.type === 'broadcast') {
                const { targets, message: text } = data;
                if (Array.isArray(targets) && targets.length > 0) {
                   console.log(`Broadcasting message to ${targets.length} targets.`);
                   for (const target of targets) {
                       // Heuristic: if it looks like a number, treat as number, otherwise try group
                       // But since we don't know for sure, we can try to find a group first, if not, assume number
                       // Or simple heuristic: if it contains only digits, assume number.
                       
                       // Better approach for "targets":
                       // If the user provides a list, we try to find a group with that name.
                       // If no group is found, we assume it's a number.
                       
                       await handleSendMessage(target, text, target); // Try both (number=target, group=target) checks inside
                   }
                } else {
                    console.error('No targets provided for broadcast.');
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
});

async function handleSendMessage(number, text, group_name) {
    let chatId = number;

    if (group_name) {
        // optimistically try to find a group first if group_name is provided (or if we are guessing)
        try {
            const chats = await client.getChats();
            const group = chats.find(chat => chat.isGroup && chat.name.toLowerCase() === group_name.toLowerCase());
            
            if (group) {
                chatId = group.id._serialized;
                console.log(`Found group '${group.name}' with ID: ${chatId}`);
            }
        } catch (err) {
            console.error('Error fetching chats:', err);
        }
    }

    // If we didn't find a group (or weren't looking for one specially), and we have a potential number
    // But wait, if we are in broadcast mode, 'number' and 'group_name' are the same string 'target'.
    // If we found a group above, chatId is set to group ID.
    // If we didn't find a group, logic below should handle number.
    
    // However, if logic above failed to find a group, chatId is still 'group_name' (which is 'target') because of how I called it.
    // So if I call handleSendMessage(target, text, target), 'number' is 'target'.
    
    // Check if chatId is a valid JID (contains @)
    if (chatId && !chatId.includes('@')) {
         // Basic format check for number (e.g. 1234567890@c.us)
        // whatsapp-web.js expects '1234567890@c.us' for person
        chatId = `${chatId}@c.us`;
    }

    if (chatId) {
        try {
            await client.sendMessage(chatId, text);
            console.log(`Sent message to ${chatId}: ${text}`);
        } catch (sendErr) {
            console.error(`Failed to send message to ${chatId}:`, sendErr);
        }
    } else {
         console.error('No valid destination (number or group_name) provided.');
    }
}


// Broadcast helper
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(JSON.stringify(data));
        }
    });
}

// WhatsApp Client Events
client.on('qr', (qr) => {
    console.log('QR Code received');
    lastQr = qr;
    // Generate terminal QR for local debugging logs
    qrcode.toString(qr, { type: 'terminal', small: true }, function (err, url) {
        if (!err) console.log(url);
    });
    
    broadcast({ type: 'qr', data: qr });
});

client.on('ready', () => {
    console.log('WhatsApp Client is ready!');
    isReady = true;
    lastQr = null;
    broadcast({ type: 'status', status: 'ready' });
});

client.on('authenticated', () => {
    console.log('Authenticated');
    broadcast({ type: 'status', status: 'authenticated' });
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    broadcast({ type: 'status', status: 'auth_failure' });
});

client.on('message', async msg => {
    console.log('MESSAGE RECEIVED', msg);
    
    let chatInfo = {};
    try {
        const chat = await msg.getChat();
        chatInfo = {
            chatName: chat.name,
            isGroup: chat.isGroup
        };
    } catch (err) {
        console.error('Error fetching chat info:', err);
    }

    // Broadcast incoming message to HA
    broadcast({
        type: 'message',
        data: {
            from: msg.from,
            to: msg.to,
            body: msg.body,
            timestamp: msg.timestamp,
            hasMedia: msg.hasMedia,
            author: msg.author,
            deviceType: msg.deviceType,
            isForwarded: msg.isForwarded,
            fromMe: msg.fromMe,
            ...chatInfo
        }
    });
});

// Start the client with retry logic
const startClient = async () => {
    console.log('Initializing WhatsApp client...');
    try {
        // Small delay to ensure network is stable
        await new Promise(resolve => setTimeout(resolve, 2000));
        await client.initialize();
    } catch (err) {
        console.error('Failed to initialize client:', err);
        
        // Exit to allow Docker/Supervisor to restart the container
        // This ensures run.sh runs again to clean up stale locks
        console.log('Exiting to trigger restart and lock cleanup...');
        process.exit(1);
    }
};

startClient();
