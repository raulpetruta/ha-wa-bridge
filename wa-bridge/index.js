const { WebSocketServer } = require('ws');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');

let configOptions = {};
try {
    if (fs.existsSync('/data/options.json')) {
        configOptions = JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    }
} catch (err) {
    console.error('Error reading options.json:', err);
}

const detectOwnMessages = configOptions.detect_own_messages || process.env.DETECT_OWN_MESSAGES === 'true' || false;

// Incoming message filtering
// Mode: 'all' (default) | 'disabled' | 'groups_only'
const incomingMode = configOptions.incoming_messages_mode || process.env.INCOMING_MESSAGES_MODE || 'all';

// Optional list of group names to forward (applies to groups_only mode and as a filter in 'all' mode).
// If empty, no group-name filtering is applied.
let allowedGroups = configOptions.allowed_groups || process.env.ALLOWED_GROUPS || [];
if (typeof allowedGroups === 'string') {
    // Support comma-separated env var: ALLOWED_GROUPS="Group A,Group B"
    allowedGroups = allowedGroups.split(',').map(g => g.trim()).filter(Boolean);
}
const allowedGroupsLower = allowedGroups.map(g => g.toLowerCase());

// Optional list of phone numbers to forward (applies to numbers_only mode and as a filter in 'all' mode).
// Numbers should be in international format without the '+': e.g. "40741234567"
// If empty, no number filtering is applied.
let allowedNumbers = configOptions.allowed_numbers || process.env.ALLOWED_NUMBERS || [];
if (typeof allowedNumbers === 'string') {
    // Support comma-separated env var: ALLOWED_NUMBERS="40741234567,49123456789"
    allowedNumbers = allowedNumbers.split(',').map(n => n.trim()).filter(Boolean);
}
const allowedNumbersSet = new Set(allowedNumbers.map(n => `${n}@c.us`));

// Incoming message logging level
// Mode: 'FULL' (default) | 'COMPACT' | 'NONE'
const incomingLogLevel = (configOptions.incoming_message_log_level || process.env.INCOMING_MESSAGE_LOG_LEVEL || 'FULL').toUpperCase();

// Directory for received photos, videos, and files. Empty disables saving.
// Add-on option media_download_path, or MEDIA_DOWNLOAD_PATH for Docker Compose.
const mediaDownloadPath = String(configOptions.media_download_path || process.env.MEDIA_DOWNLOAD_PATH || '').trim();
const mediaDownloadRoot = mediaDownloadPath ? path.resolve(mediaDownloadPath) : '';

const dataPath = process.env.WA_DATA_PATH || './.wwebjs_auth';
const authPath = path.join(dataPath, 'baileys_auth');

const MEDIA_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'application/pdf': '.pdf',
};

const logger = pino({ level: 'silent' });

let makeWASocket;
let useMultiFileAuthState;
let DisconnectReason;
let downloadMediaMessage;
let getAggregateVotesInPollMessage;
let generateWAMessageFromContent;
let Browsers;

let sock = null;
let starting = false;
let lastQr = null;
let isReady = false;
const groupsByJid = new Map();
const groupsByName = new Map();
const pollMessages = new Map();
const pollVoteState = new Map();

console.log(`Incoming messages mode: ${incomingMode}`);
console.log(`Incoming message log level: ${incomingLogLevel}`);
if (mediaDownloadRoot) {
    console.log(`Incoming media will be saved to: ${mediaDownloadRoot}`);
}
if (allowedGroupsLower.length > 0) {
    console.log(`Allowed groups filter: ${allowedGroups.join(', ')}`);
}
if (allowedNumbersSet.size > 0) {
    console.log(`Allowed numbers filter: ${allowedNumbers.join(', ')}`);
}

function extensionForMedia(media) {
    const fromName = media.filename ? path.extname(media.filename).toLowerCase() : '';
    if (/^\.[a-z0-9]{1,8}$/.test(fromName)) {
        return fromName;
    }
    const mime = String(media.mimetype || '').split(';')[0].trim().toLowerCase();
    return MEDIA_EXTENSIONS[mime] || '';
}

function buildMediaFilename(media) {
    const ext = extensionForMedia(media);
    const stem = path.basename(media.filename || '', path.extname(media.filename || ''))
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40);
    const stamp = Math.floor(Date.now() / 1000);
    const suffix = crypto.randomBytes(3).toString('hex');
    return stem ? `${stamp}-${suffix}-${stem}${ext}` : `${stamp}-${suffix}${ext}`;
}

async function saveIncomingBuffer(buffer, media) {
    const filename = buildMediaFilename(media);
    const target = path.resolve(mediaDownloadRoot, filename);
    if (target !== mediaDownloadRoot && !target.startsWith(`${mediaDownloadRoot}${path.sep}`)) {
        throw new Error(`Refusing to write outside ${mediaDownloadRoot}`);
    }

    await fs.promises.mkdir(mediaDownloadRoot, { recursive: true });
    await fs.promises.writeFile(target, buffer);
    console.log(`Saved incoming media to ${target}`);
    return {
        path: target,
        filename,
        mimetype: media.mimetype || null,
    };
}

function logIncomingData(type, data, rawObj) {
    if (incomingLogLevel === 'NONE') return;

    if (incomingLogLevel === 'COMPACT') {
        const sender = data.from || data.voter || 'unknown';
        const group = data.isGroup ? ` (Group: ${data.chatName})` : (data.group_id ? ` (Group ID: ${data.group_id})` : '');
        console.log(`[${type}] received from ${sender}${group}`);
    } else {
        console.log(`[${type}] RECEIVED`, rawObj);
    }
}

function toLegacyJid(jid) {
    if (!jid) return jid;
    return String(jid).replace(/@s\.whatsapp\.net$/, '@c.us');
}

function phoneFromJid(jid) {
    if (!jid) return '';
    let value = String(jid).split('@')[0];
    if (value.includes(':')) {
        value = value.split(':')[0];
    }
    return value;
}

function toGroupJid(id) {
    const raw = String(id).replace(/@g\.us$/, '');
    return `${raw}@g.us`;
}

function toSendJid(chatId) {
    if (!chatId) return chatId;
    if (String(chatId).endsWith('@c.us')) {
        return String(chatId).replace(/@c\.us$/, '@s.whatsapp.net');
    }
    if (String(chatId).includes('@')) {
        return String(chatId);
    }
    return `${chatId}@s.whatsapp.net`;
}

function unwrapMessage(message) {
    if (!message) return message;
    if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
    if (message.documentWithCaptionMessage?.message) return unwrapMessage(message.documentWithCaptionMessage.message);
    return message;
}

function messageBody(message) {
    const content = unwrapMessage(message);
    if (!content) return '';
    return content.conversation
        || content.extendedTextMessage?.text
        || content.imageMessage?.caption
        || content.videoMessage?.caption
        || content.documentMessage?.caption
        || '';
}

function mediaInfo(message) {
    const content = unwrapMessage(message);
    if (!content) return null;
    const inner = content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage || content.stickerMessage;
    if (!inner) return null;
    return {
        mimetype: inner.mimetype || '',
        filename: inner.fileName || inner.title || '',
    };
}

function pollKey(key) {
    if (!key?.remoteJid || !key?.id) return '';
    return `${key.remoteJid}:${key.id}`;
}

function rememberPoll(msg) {
    const content = unwrapMessage(msg?.message);
    if (!content?.pollCreationMessage && !content?.pollCreationMessageV3) return;
    const key = pollKey(msg.key);
    if (key) pollMessages.set(key, msg);
}

function rememberGroup(group) {
    if (!group?.id) return;
    groupsByJid.set(group.id, group);
    if (group.subject) {
        groupsByName.set(group.subject.toLowerCase(), group);
    }
}

async function refreshGroups() {
    const groups = await sock.groupFetchAllParticipating();
    groupsByJid.clear();
    groupsByName.clear();
    for (const group of Object.values(groups)) {
        rememberGroup(group);
    }
    return groups;
}

async function groupName(jid) {
    const cached = groupsByJid.get(jid);
    if (cached?.subject) return cached.subject;
    try {
        const meta = await sock.groupMetadata(jid);
        rememberGroup(meta);
        return meta.subject || '';
    } catch (err) {
        console.error(`Error fetching group ${jid}:`, err);
        return '';
    }
}

const PORT = 3000;

const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server started on port ${PORT}`);

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    });
}

wss.on('connection', (ws) => {
    console.log('New client connected');

    if (isReady) {
        ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
    } else if (lastQr) {
        ws.send(JSON.stringify({ type: 'qr', data: lastQr }));
    } else {
        ws.send(JSON.stringify({ type: 'status', status: 'initializing' }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received command:', data);

            if (!sock || !isReady) {
                console.error('Bridge is not connected to WhatsApp.');
                return;
            }

            if (data.type === 'send_message') {
                const { number, message: text, group_name, group_id, media } = data;
                await handleSendMessage(number, text, group_name, group_id, media);
            } else if (data.type === 'send_poll') {
                const { number, group_name, group_id, message: pollQuestion, options, allow_multiple_answers } = data;
                await handleSendPoll(number, group_name, group_id, pollQuestion, options, allow_multiple_answers);
            } else if (data.type === 'broadcast') {
                const { targets, message: text, media } = data;
                if (Array.isArray(targets) && targets.length > 0) {
                    console.log(`Broadcasting message to ${targets.length} targets.`);
                    for (const target of targets) {
                        await handleSendMessage(target, text, target, null, media);
                    }
                } else {
                    console.error('No targets provided for broadcast.');
                }
            } else if (data.type === 'get_groups') {
                await handleGetGroups(ws);
            } else if (data.type === 'set_group_subject') {
                const { group_id, subject } = data;
                await handleSetGroupSubject(ws, group_id, subject);
            } else if (data.type === 'set_group_picture') {
                const { group_id, media } = data;
                await handleSetGroupPicture(ws, group_id, media);
            } else if (data.type === 'send_event') {
                const { number, group_name, group_id, name, description, location, start_time, end_time, call_type } = data;
                await handleSendEvent(number, group_name, group_id, name, description, location, start_time, end_time, call_type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
});

async function resolveChatId(number, group_name, group_id) {
    if (group_id) {
        const chatId = toGroupJid(group_id);
        console.log(`Using group ID directly: ${chatId}`);
        return chatId;
    }

    if (group_name) {
        try {
            let group = groupsByName.get(String(group_name).toLowerCase());
            if (!group) {
                await refreshGroups();
                group = groupsByName.get(String(group_name).toLowerCase());
            }
            if (group) {
                console.log(`Found group '${group.subject}' with ID: ${group.id}`);
                return group.id;
            }
        } catch (err) {
            console.error('Error fetching chats:', err);
        }
    }

    if (number && !String(number).includes('@')) {
        return toSendJid(number);
    }

    return number ? toSendJid(number) : null;
}

function outgoingContent(text, media) {
    if (!media) {
        return { text: text || '' };
    }

    const buffer = Buffer.from(media.data, 'base64');
    const mime = media.mimetype || 'application/octet-stream';
    const caption = text || undefined;

    if (mime.startsWith('image/')) {
        return { image: buffer, caption, mimetype: mime };
    }
    if (mime.startsWith('video/')) {
        return { video: buffer, caption, mimetype: mime };
    }
    if (mime.startsWith('audio/')) {
        return { audio: buffer, mimetype: mime, ptt: false };
    }
    return {
        document: buffer,
        mimetype: mime,
        fileName: media.filename || 'file',
        caption,
    };
}

async function handleSendMessage(number, text, group_name, group_id, media) {
    const chatId = await resolveChatId(number, group_name, group_id);

    if (chatId) {
        try {
            await sock.sendMessage(chatId, outgoingContent(text, media));
            console.log(`Sent ${media ? 'media ' : ''}message to ${chatId}: ${text || '(no caption)'}`);
        } catch (sendErr) {
            console.error(`Failed to send message to ${chatId}:`, sendErr);
        }
    } else {
        console.error('No valid destination (number or group_name) provided.');
    }
}

async function handleSendPoll(number, group_name, group_id, pollQuestion, options, allow_multiple_answers) {
    const chatId = await resolveChatId(number, group_name, group_id);

    if (chatId) {
        try {
            const sent = await sock.sendMessage(chatId, {
                poll: {
                    name: pollQuestion,
                    values: options,
                    selectableCount: allow_multiple_answers ? 0 : 1,
                },
            });
            if (sent) rememberPoll(sent);
            console.log(`Sent poll to ${chatId}: ${pollQuestion}`);
        } catch (sendErr) {
            console.error(`Failed to send poll to ${chatId}:`, sendErr);
        }
    } else {
        console.error('No valid destination (number or group_name) provided for poll.');
    }
}

async function handleSendEvent(number, group_name, group_id, eventName, eventDescription, eventLocation, eventStartTime, eventEndTime, eventCallType) {
    const chatId = await resolveChatId(number, group_name, group_id);

    if (!chatId) {
        console.error('No valid destination (number or group_name) provided for event.');
        return;
    }

    try {
        const eventMessage = {
            name: eventName,
            isCanceled: false,
            isScheduleCall: eventCallType === 'video' || eventCallType === 'voice',
            startTime: Math.floor(new Date(eventStartTime).getTime() / 1000),
        };
        if (eventDescription) eventMessage.description = eventDescription;
        if (eventEndTime) eventMessage.endTime = Math.floor(new Date(eventEndTime).getTime() / 1000);
        if (eventLocation) {
            const location = String(eventLocation);
            eventMessage.location = location.startsWith('http')
                ? { name: location, url: location }
                : { name: location };
        }

        const created = generateWAMessageFromContent(chatId, { eventMessage }, {
            userJid: sock.user.id,
        });
        await sock.relayMessage(chatId, created.message, { messageId: created.key.id });
        console.log(`Sent event to ${chatId}: ${eventName}`);
    } catch (sendErr) {
        console.error(`Failed to send event to ${chatId}:`, sendErr);
    }
}

async function handleGetGroups(ws) {
    try {
        const groups = await refreshGroups();
        const data = Object.values(groups).map(group => ({
            id: group.id,
            name: group.subject,
        }));
        console.log(`Returning ${data.length} groups.`);
        ws.send(JSON.stringify({ type: 'get_groups_response', data }));
    } catch (err) {
        console.error('Error fetching groups:', err);
        ws.send(JSON.stringify({ type: 'get_groups_response', data: [], error: err.message }));
    }
}

async function handleSetGroupSubject(ws, group_id, subject) {
    if (!group_id || !subject) {
        console.error('group_id and subject are required for set_group_subject.');
        ws.send(JSON.stringify({ type: 'set_group_subject_response', success: false, error: 'group_id and subject are required' }));
        return;
    }

    const chatId = toGroupJid(group_id);

    try {
        await sock.groupUpdateSubject(chatId, subject);
        const cached = groupsByJid.get(chatId);
        if (cached) rememberGroup({ ...cached, subject });
        console.log(`Set group subject for ${chatId} to "${subject}"`);
        ws.send(JSON.stringify({ type: 'set_group_subject_response', success: true }));
    } catch (err) {
        console.error(`Failed to set group subject for ${chatId}:`, err);
        ws.send(JSON.stringify({ type: 'set_group_subject_response', success: false, error: err.message }));
    }
}

async function handleSetGroupPicture(ws, group_id, media) {
    if (!group_id || !media) {
        console.error('group_id and media are required for set_group_picture.');
        ws.send(JSON.stringify({ type: 'set_group_picture_response', success: false, error: 'group_id and media are required' }));
        return;
    }

    const chatId = toGroupJid(group_id);

    try {
        const buffer = Buffer.from(media.data, 'base64');
        await sock.updateProfilePicture(chatId, buffer);
        console.log(`Set group picture for ${chatId}`);
        ws.send(JSON.stringify({ type: 'set_group_picture_response', success: true }));
    } catch (err) {
        console.error(`Failed to set group picture for ${chatId}:`, err);
        ws.send(JSON.stringify({ type: 'set_group_picture_response', success: false, error: err.message }));
    }
}

function passesIncomingFilters({ isGroup, chatName, senderJid }) {
    if (incomingMode === 'groups_only' && !isGroup) return false;

    if (incomingMode === 'numbers_only') {
        if (isGroup || !allowedNumbersSet.has(senderJid)) return false;
    }

    if (allowedGroupsLower.length > 0) {
        if (!isGroup || !allowedGroupsLower.includes((chatName || '').toLowerCase())) return false;
    }

    if (allowedNumbersSet.size > 0 && incomingMode !== 'numbers_only') {
        if (isGroup || !allowedNumbersSet.has(senderJid)) return false;
    }

    return true;
}

async function handleIncomingMessage(msg) {
    if (!msg.message || !msg.key) return;
    rememberPoll(msg);

    if (msg.key.fromMe && !detectOwnMessages) return;
    if (msg.key.remoteJid === 'status@broadcast') return;

    const remoteJid = msg.key.remoteJid;
    const isGroup = String(remoteJid).endsWith('@g.us');
    const senderJid = toLegacyJid(isGroup ? (msg.key.participant || remoteJid) : remoteJid);
    let chatName = '';

    if (isGroup) {
        chatName = await groupName(remoteJid);
    }

    if (!passesIncomingFilters({ isGroup, chatName, senderJid })) return;

    const info = mediaInfo(msg.message);
    const content = unwrapMessage(msg.message);
    const payloadData = {
        from: isGroup ? remoteJid : senderJid,
        to: isGroup ? remoteJid : toLegacyJid(sock.user?.id),
        body: messageBody(msg.message),
        timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
        hasMedia: Boolean(info),
        author: isGroup ? senderJid : null,
        deviceType: null,
        isForwarded: Boolean(content?.extendedTextMessage?.contextInfo?.isForwarded
            || content?.imageMessage?.contextInfo?.isForwarded
            || content?.videoMessage?.contextInfo?.isForwarded),
        fromMe: Boolean(msg.key.fromMe),
        chatName,
        isGroup,
        groupId: isGroup ? remoteJid : null,
    };

    if (info && mediaDownloadRoot) {
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                logger,
                reuploadRequest: sock.updateMediaMessage,
            });
            const saved = await saveIncomingBuffer(buffer, info);
            payloadData.mediaPath = saved.path;
            payloadData.mediaFilename = saved.filename;
            payloadData.mediaMimetype = saved.mimetype;
        } catch (err) {
            console.error('Error saving incoming media:', err);
        }
    }

    logIncomingData('MESSAGE', payloadData, msg);
    broadcast({ type: 'message', data: payloadData });
}

function emitPollVotes(key, votes) {
    const id = pollKey(key);
    const previous = pollVoteState.get(id) || new Map();
    const next = new Map();
    const isGroup = String(key.remoteJid).endsWith('@g.us');
    const chatName = isGroup ? (groupsByJid.get(key.remoteJid)?.subject || '') : '';

    for (const option of votes) {
        for (const voterJid of option.voters) {
            const legacy = toLegacyJid(voterJid);
            const selected = next.get(legacy) || [];
            selected.push({ name: option.name });
            next.set(legacy, selected);
        }
    }

    for (const [voterJid, selectedOptions] of next) {
        const before = JSON.stringify(previous.get(voterJid) || []);
        if (before === JSON.stringify(selectedOptions)) continue;

        const voter = phoneFromJid(voterJid);
        if (!passesIncomingFilters({ isGroup, chatName, senderJid: `${voter}@c.us` })) continue;

        const payloadData = {
            voter,
            group_id: isGroup ? phoneFromJid(key.remoteJid) : null,
            selectedOptions,
            pollCreationMessageId: key.id,
            timestamp: Math.floor(Date.now() / 1000),
        };
        logIncomingData('VOTE_UPDATE', payloadData, { key, selectedOptions });
        broadcast({ type: 'poll_vote', data: payloadData });
    }

    pollVoteState.set(id, next);
}

async function handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        console.log('QR Code received');
        lastQr = qr;
        isReady = false;
        qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
            if (!err) console.log(url);
        });
        broadcast({ type: 'qr', data: qr });
    }

    if (connection === 'open') {
        console.log('WhatsApp Client is ready!');
        isReady = true;
        lastQr = null;
        broadcast({ type: 'status', status: 'authenticated' });
        broadcast({ type: 'status', status: 'ready' });
        try {
            await refreshGroups();
        } catch (err) {
            console.error('Error fetching groups after connect:', err);
        }
    }

    if (connection === 'close') {
        isReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        console.error('WhatsApp connection closed', statusCode || lastDisconnect?.error || '');

        if (loggedOut) {
            broadcast({ type: 'status', status: 'auth_failure' });
            await fs.promises.rm(authPath, { recursive: true, force: true });
        }

        setTimeout(() => {
            startSocket().catch((err) => {
                console.error('Failed to reconnect:', err);
                process.exit(1);
            });
        }, 3000);
    }
}

async function startSocket() {
    if (starting) return;
    starting = true;
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const socket = makeWASocket({
            auth: state,
            logger,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
        });
        sock = socket;
        socket.ev.on('creds.update', saveCreds);
        socket.ev.on('connection.update', (update) => {
            handleConnectionUpdate(update).catch((err) => {
                console.error('Error handling connection update:', err);
            });
        });

        if (incomingMode !== 'disabled') {
            socket.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                for (const msg of messages) {
                    try {
                        await handleIncomingMessage(msg);
                    } catch (err) {
                        console.error('Error handling incoming message:', err);
                    }
                }
            });
            socket.ev.on('messages.update', (updates) => {
                for (const { key, update } of updates) {
                    if (!update?.pollUpdates || !key) continue;
                    const stored = pollMessages.get(pollKey(key));
                    if (!stored) {
                        console.error('Poll vote received for an unknown poll.');
                        continue;
                    }
                    try {
                        const votes = getAggregateVotesInPollMessage({
                            message: stored.message,
                            pollUpdates: update.pollUpdates,
                        }, socket.user?.id);
                        emitPollVotes(key, votes);
                    } catch (err) {
                        console.error('Error handling poll vote:', err);
                    }
                }
            });
        }
    } finally {
        starting = false;
    }
}

async function startClient() {
    console.log('Initializing WhatsApp client...');
    try {
        const baileys = await import('@whiskeysockets/baileys');
        makeWASocket = baileys.default;
        ({
            useMultiFileAuthState,
            DisconnectReason,
            downloadMediaMessage,
            getAggregateVotesInPollMessage,
            generateWAMessageFromContent,
            Browsers,
        } = baileys);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await startSocket();
    } catch (err) {
        console.error('Failed to initialize client:', err);
        console.log('Exiting to trigger restart and lock cleanup...');
        process.exit(1);
    }
}

if (incomingMode === 'disabled') {
    console.log('Incoming message handling is DISABLED. The bridge will not forward any received messages to Home Assistant.');
}

startClient();
