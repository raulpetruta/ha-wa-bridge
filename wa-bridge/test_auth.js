const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// The unit tests below require the module with an empty token.
delete process.env.API_TOKEN;

const WebSocket = require('ws');
const bridge = require('./index.js');

const PORT = 3000;
const TOKEN = 'test-secret-token';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function testRequestToken() {
    assert.strictEqual(bridge.requestToken({ headers: {}, url: '/' }), '');
    assert.strictEqual(bridge.requestToken({ headers: {}, url: `/?token=${TOKEN}` }), TOKEN);
    assert.strictEqual(bridge.requestToken({ headers: {}, url: `/?foo=1&token=${TOKEN}` }), TOKEN);
    assert.strictEqual(bridge.requestToken({ headers: {}, url: '/?token=' }), '');
    assert.strictEqual(bridge.requestToken({ headers: {}, url: '/?foo=1' }), '');
    assert.strictEqual(bridge.requestToken({ headers: {} }), '');
    assert.strictEqual(bridge.requestToken({}), '');
    assert.strictEqual(bridge.requestToken(undefined), '');

    assert.strictEqual(bridge.requestToken({ headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN);
    assert.strictEqual(bridge.requestToken({ headers: { authorization: `bearer ${TOKEN}` } }), TOKEN);
    assert.strictEqual(bridge.requestToken({ headers: { Authorization: `Bearer ${TOKEN}` } }), TOKEN);
    assert.strictEqual(bridge.requestToken({ headers: { authorization: 'Bearer token with spaces' } }), 'token with spaces');
    assert.strictEqual(bridge.requestToken({ headers: { authorization: 'Basic abc' } }), '');
    assert.strictEqual(bridge.requestToken({ headers: { authorization: 'Bearer ' } }), '');
    assert.strictEqual(bridge.requestToken({ headers: { authorization: 'Bearer' } }), '');

    // The header is preferred when both authentication methods are present.
    assert.strictEqual(
        bridge.requestToken({ headers: { authorization: `Bearer ${TOKEN}` }, url: '/?token=other' }),
        TOKEN,
    );

    const oddToken = 'p@ss word&x=1';
    assert.strictEqual(
        bridge.requestToken({ headers: {}, url: `/?token=${encodeURIComponent(oddToken)}` }),
        oddToken,
    );
}

function testIsAuthorizedRequest() {
    const noAuth = { headers: {}, url: '/' };

    assert.strictEqual(bridge.isAuthorizedRequest(noAuth, TOKEN), false);
    assert.strictEqual(bridge.isAuthorizedRequest({}), false);
    assert.strictEqual(bridge.isAuthorizedRequest(undefined, TOKEN), false);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: { authorization: `Bearer ${TOKEN}` }, url: '/' }, TOKEN), true);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: { authorization: 'Bearer wrong' }, url: '/' }, TOKEN), false);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: { authorization: `Bearer ${TOKEN}` }, url: '/' }, 'other-token'), false);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: {}, url: `/?token=${TOKEN}` }, TOKEN), true);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: {}, url: '/?token=wrong' }, TOKEN), false);

    // Wrong tokens of a different length must not throw; they are hashed first.
    assert.strictEqual(
        bridge.isAuthorizedRequest({ headers: { authorization: 'Bearer short' }, url: '/' }, 'a-much-longer-secret'),
        false,
    );
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: { authorization: 'Bearer x' }, url: '/' }, ''), false);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: { authorization: 'Bearer x' }, url: '/' }, '   '), false);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: { authorization: 'Bearer ' }, url: '/' }, TOKEN), false);
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: {}, url: '/?token=' }, TOKEN), false);

    // The default expected token is the module-level apiToken, which is empty here.
    assert.strictEqual(bridge.isAuthorizedRequest({ headers: { authorization: `Bearer ${TOKEN}` } }), false);
}

function waitForExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve({ code: child.exitCode, signal: child.signalCode, timedOut: false });
    }
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ code: null, signal: null, timedOut: true }), timeoutMs);
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, timedOut: false });
        });
    });
}

async function stopChild(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const exited = await waitForExit(child, 3000);
    if (!exited.timedOut) return;
    child.kill('SIGKILL');
    await waitForExit(child, 3000);
}

function spawnBridge(dataPath, token) {
    const env = { ...process.env, WA_DATA_PATH: dataPath };
    delete env.API_TOKEN;
    if (token !== undefined) env.API_TOKEN = token;
    const child = spawn(process.execPath, ['index.js'], {
        cwd: __dirname,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
        output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
        output += String(chunk);
    });
    return {
        child,
        getOutput() {
            return output;
        },
    };
}

async function waitForOutput(instance, text, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (instance.getOutput().includes(text)) return;
        if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
            throw new Error(`Bridge exited before "${text}". Output:\n${instance.getOutput()}`);
        }
        await delay(25);
    }
    throw new Error(`Timed out waiting for "${text}". Output:\n${instance.getOutput()}`);
}

function isPortInUse(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: '127.0.0.1' });
        let settled = false;
        const finish = (inUse) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(inUse);
        };
        const timer = setTimeout(() => finish(false), 1000);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

async function assertPortFree(port) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (!(await isPortInUse(port))) return;
        await delay(50);
    }
    throw new Error(`Port ${port} is still accepting connections`);
}

function expectUnauthorized(url, options, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, options);
        const timer = setTimeout(() => {
            ws.terminate();
            reject(new Error(`Timed out waiting for HTTP 401 from ${url}`));
        }, timeoutMs);
        ws.once('unexpected-response', (request, response) => {
            clearTimeout(timer);
            request.destroy();
            resolve({ statusCode: response.statusCode, statusMessage: response.statusMessage });
        });
        ws.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function connectAndReadStatus(url, options, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, options);
        const timer = setTimeout(() => {
            ws.terminate();
            reject(new Error(`Timed out waiting for a status frame from ${url}`));
        }, timeoutMs);
        ws.once('message', (raw) => {
            clearTimeout(timer);
            try {
                resolve({ ws, payload: JSON.parse(String(raw)) });
            } catch (err) {
                ws.terminate();
                reject(err);
            }
        });
        ws.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function testMissingTokenRefusesToStart() {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-notoken-'));
    const instance = spawnBridge(dataPath, undefined);
    try {
        const exited = await waitForExit(instance.child, 10000);
        assert.strictEqual(exited.timedOut, false, 'bridge must exit on its own when no API token is configured');
        assert.strictEqual(exited.code, 1);
        const output = instance.getOutput();
        assert.ok(output.includes('api_token'), `fatal message must mention api_token. Output:\n${output}`);
        assert.ok(output.includes('API_TOKEN'), `fatal message must mention API_TOKEN. Output:\n${output}`);
        assert.ok(/refus/i.test(output), `fatal message must refuse to start unauthenticated. Output:\n${output}`);
        assert.ok(!output.includes('WebSocket server started'), 'bridge must not start the server without a token');
        assert.strictEqual(await isPortInUse(PORT), false, 'bridge must not listen on the WebSocket port without a token');
    } finally {
        await stopChild(instance.child);
        fs.rmSync(dataPath, { recursive: true, force: true });
    }
}

async function testLiveAuthentication() {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-live-'));
    const instance = spawnBridge(dataPath, TOKEN);
    try {
        await waitForOutput(instance, 'WebSocket server started', 15000);
        assert.strictEqual(await isPortInUse(PORT), true, 'bridge should listen on the WebSocket port');

        const noToken = await expectUnauthorized(`ws://127.0.0.1:${PORT}/`);
        assert.strictEqual(noToken.statusCode, 401);
        assert.strictEqual(noToken.statusMessage, 'Unauthorized');

        const wrongBearer = await expectUnauthorized(`ws://127.0.0.1:${PORT}/`, {
            headers: { Authorization: 'Bearer definitely-wrong' },
        });
        assert.strictEqual(wrongBearer.statusCode, 401);

        const wrongQuery = await expectUnauthorized(`ws://127.0.0.1:${PORT}/?token=definitely-wrong`);
        assert.strictEqual(wrongQuery.statusCode, 401);

        const bearer = await connectAndReadStatus(`ws://127.0.0.1:${PORT}/`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        try {
            assert.strictEqual(bearer.payload.type, 'status');
            assert.strictEqual(bearer.payload.status, 'initializing');
        } finally {
            bearer.ws.terminate();
        }

        const query = await connectAndReadStatus(`ws://127.0.0.1:${PORT}/?token=${TOKEN}`);
        try {
            assert.strictEqual(query.payload.type, 'status');
            assert.strictEqual(query.payload.status, 'initializing');
        } finally {
            query.ws.terminate();
        }

        const output = instance.getOutput();
        assert.ok(output.includes('New authenticated client connected'), `missing authenticated connection log. Output:\n${output}`);
        assert.ok(output.includes('Rejected WebSocket client'), `missing rejection warning. Output:\n${output}`);
        assert.ok(output.includes('authenticate with the API token'), `missing startup token notice. Output:\n${output}`);
        assert.ok(!output.includes(TOKEN), 'the API token must never be written to the logs');
    } finally {
        await stopChild(instance.child);
        fs.rmSync(dataPath, { recursive: true, force: true });
    }
    await assertPortFree(PORT);
}

async function main() {
    const watchdog = setTimeout(() => {
        console.error('auth checks timed out');
        process.exit(1);
    }, 90000);
    watchdog.unref();

    try {
        testRequestToken();
        testIsAuthorizedRequest();
        await testMissingTokenRefusesToStart();
        await testLiveAuthentication();
        console.log('auth checks passed');
    } finally {
        clearTimeout(watchdog);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
