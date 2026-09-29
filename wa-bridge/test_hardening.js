const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-harden-'));
process.env.WA_DATA_PATH = dataPath;

const bridge = require('./index.js');

async function testPhoneMapping() {
    bridge.setSocket({
        signalRepository: {
            lidMapping: {
                async getPNForLID(jid) {
                    assert.strictEqual(jid, '12345@lid');
                    return '40741234567@s.whatsapp.net';
                },
            },
        },
    });

    assert.strictEqual(await bridge.toPhoneJid('12345@lid'), '40741234567@c.us');
    assert.strictEqual(await bridge.toPhoneJid('40741234567@s.whatsapp.net'), '40741234567@c.us');
    assert.strictEqual(await bridge.toPhoneJid('40741234567:12@s.whatsapp.net'), '40741234567@c.us');
    assert.strictEqual(
        await bridge.senderPhoneJid({ remoteJid: '12345@lid', remoteJidAlt: '40749999999@s.whatsapp.net' }, false),
        '40749999999@c.us',
    );
    assert.strictEqual(bridge.toGroupJid('120363@newsletter'), '120363@newsletter');
    assert.strictEqual(bridge.toGroupJid('120363'), '120363@g.us');
    assert.strictEqual(bridge.isGroupChat('120363@newsletter'), true);
    assert.strictEqual(bridge.isGroupChat('120363@g.us'), true);
    assert.strictEqual(bridge.isGroupChat('40741@c.us'), false);
    assert.strictEqual(bridge.isLoggedOut(401), true);
    assert.strictEqual(bridge.isLoggedOut(408), false);
    assert.strictEqual(bridge.phoneFromJid('120363@newsletter'), '120363');
}

async function testPollPersistence() {
    const secret = Buffer.from('poll-secret');
    bridge.rememberPoll({
        key: { remoteJid: '120363@g.us', id: 'POLL1' },
        message: {
            pollCreationMessage: {
                name: 'Lunch?',
                messageSecret: secret,
            },
        },
    });

    const storedFile = path.join(dataPath, 'baileys_auth', 'polls.json');
    assert.ok(fs.existsSync(storedFile));
    bridge.pollMessages.clear();
    bridge.loadStoredPolls();
    const restored = bridge.pollMessages.get('120363@g.us:POLL1');
    assert.ok(restored);
    assert.ok(Buffer.from(restored.message.pollCreationMessage.messageSecret).equals(secret));
}

function testNotReadyReplies() {
    return new Promise((resolve, reject) => {
        const childData = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-harden-live-'));
        const child = spawn(process.execPath, ['index.js'], {
            cwd: __dirname,
            env: { ...process.env, WA_DATA_PATH: childData },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Timed out waiting for not-ready replies'));
        }, 15000);

        let output = '';
        let started = false;
        child.stdout.on('data', (chunk) => {
            output += String(chunk);
            if (started || !output.includes('WebSocket server started')) return;
            started = true;
            const WebSocket = require('ws');
            const ws = new WebSocket('ws://127.0.0.1:3000');
            const replies = [];
            ws.on('message', (raw) => {
                const payload = JSON.parse(raw);
                if (payload.type === 'status') return;
                replies.push(payload);
                if (replies.length < 3) return;
                clearTimeout(timer);
                ws.close();
                child.kill('SIGTERM');
                try {
                    assert.deepStrictEqual(replies.map((item) => item.type), [
                        'get_groups_response',
                        'set_group_subject_response',
                        'set_group_picture_response',
                    ]);
                    assert.strictEqual(replies[0].error, 'Bridge is not connected to WhatsApp.');
                    assert.strictEqual(replies[1].success, false);
                    assert.strictEqual(replies[2].success, false);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
            ws.on('open', () => {
                ws.send(JSON.stringify({ type: 'get_groups' }));
                ws.send(JSON.stringify({ type: 'set_group_subject', group_id: '1', subject: 'Test' }));
                ws.send(JSON.stringify({ type: 'set_group_picture', group_id: '1', media: { data: '' } }));
            });
        });

        child.on('exit', (code, signal) => {
            if (signal === 'SIGTERM' || code === 0 || code === null) return;
        });
        child.stderr.on('data', () => {});
    });
}

async function main() {
    await testPhoneMapping();
    await testPollPersistence();
    await testNotReadyReplies();
    console.log('hardening checks passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
