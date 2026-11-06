const assert = require('assert');
const path = require('path');

// The incoming-message filters are configured at module load time, so each
// scenario reloads index.js after setting the environment for that mode.
function loadBridge(env) {
    for (const key of ['INCOMING_MESSAGES_MODE', 'ALLOWED_NUMBERS', 'ALLOWED_GROUPS', 'DETECT_OWN_MESSAGES']) {
        delete process.env[key];
    }
    Object.assign(process.env, env);
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js');
}

const GROUP = { isGroup: true, chatName: 'Family Group', senderJid: '40741234567@c.us' };
const GROUP_OTHER_SENDER = { isGroup: true, chatName: 'Family Group', senderJid: '49999999999@c.us' };
const OTHER_GROUP = { isGroup: true, chatName: 'Work Team', senderJid: '40741234567@c.us' };
const DIRECT_ALLOWED = { isGroup: false, chatName: '', senderJid: '40741234567@c.us' };
const DIRECT_OTHER = { isGroup: false, chatName: '', senderJid: '49999999999@c.us' };

function testDefaultMode() {
    const bridge = loadBridge({});
    assert.strictEqual(bridge.passesIncomingFilters(GROUP), true);
    assert.strictEqual(bridge.passesIncomingFilters(DIRECT_OTHER), true);
}

function testGroupsOnly() {
    const bridge = loadBridge({
        INCOMING_MESSAGES_MODE: 'groups_only',
        ALLOWED_NUMBERS: '40741234567',
    });
    // A number filter must not silently drop every group message in groups_only.
    assert.strictEqual(bridge.passesIncomingFilters(GROUP), true);
    assert.strictEqual(bridge.passesIncomingFilters(GROUP_OTHER_SENDER), true);
    assert.strictEqual(bridge.passesIncomingFilters(DIRECT_ALLOWED), false);

    // Group-name filtering still applies in groups_only.
    const named = loadBridge({
        INCOMING_MESSAGES_MODE: 'groups_only',
        ALLOWED_GROUPS: 'family group',
    });
    assert.strictEqual(named.passesIncomingFilters(GROUP), true);
    assert.strictEqual(named.passesIncomingFilters(OTHER_GROUP), false);
    assert.strictEqual(named.passesIncomingFilters(DIRECT_ALLOWED), false);
}

function testAllModeWithNumberFilter() {
    const bridge = loadBridge({ INCOMING_MESSAGES_MODE: 'all', ALLOWED_NUMBERS: '40741234567' });
    assert.strictEqual(bridge.passesIncomingFilters(DIRECT_ALLOWED), true);
    assert.strictEqual(bridge.passesIncomingFilters(DIRECT_OTHER), false);
    // In 'all' mode the number list also filters by sender of group messages.
    assert.strictEqual(bridge.passesIncomingFilters(GROUP), false);
}

function testNumbersOnlyMode() {
    // allowed_groups must not reject direct messages in numbers_only mode.
    const bridge = loadBridge({
        INCOMING_MESSAGES_MODE: 'numbers_only',
        ALLOWED_NUMBERS: '40741234567',
        ALLOWED_GROUPS: 'Family Group',
    });
    assert.strictEqual(bridge.passesIncomingFilters(DIRECT_ALLOWED), true);
    assert.strictEqual(bridge.passesIncomingFilters(DIRECT_OTHER), false);
    assert.strictEqual(bridge.passesIncomingFilters(GROUP), false);
}

function testAllModeWithGroupFilter() {
    const bridge = loadBridge({ INCOMING_MESSAGES_MODE: 'all', ALLOWED_GROUPS: 'Family Group' });
    assert.strictEqual(bridge.passesIncomingFilters(GROUP), true);
    assert.strictEqual(bridge.passesIncomingFilters(OTHER_GROUP), false);
    // Group-name filtering is case-insensitive.
    const lower = loadBridge({ INCOMING_MESSAGES_MODE: 'all', ALLOWED_GROUPS: 'family group' });
    assert.strictEqual(lower.passesIncomingFilters(GROUP), true);
}

function main() {
    assert.ok(path.basename(require.main.filename) === 'test_filters.js');
    testDefaultMode();
    testGroupsOnly();
    testAllModeWithNumberFilter();
    testNumbersOnlyMode();
    testAllModeWithGroupFilter();
    console.log('filter checks passed');
}

try {
    main();
} catch (err) {
    console.error(err);
    process.exit(1);
}
