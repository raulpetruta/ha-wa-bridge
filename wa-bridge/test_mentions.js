const assert = require('assert');
const bridge = require('./index.js');

const result = bridge.withMentions('hello world', ['0987654321@g-us', '40741234567@c.us', '40741234567']);
assert.deepStrictEqual(result.mentions, [
    '0987654321@s.whatsapp.net',
    '40741234567@s.whatsapp.net',
]);
assert.strictEqual(result.text, 'hello world @0987654321 @40741234567');

const already = bridge.withMentions('hi @40741234567', ['40741234567']);
assert.strictEqual(already.text, 'hi @40741234567');
assert.deepStrictEqual(already.mentions, ['40741234567@s.whatsapp.net']);

const longer = bridge.withMentions('hi @407412345678', ['40741234567']);
assert.strictEqual(longer.text, 'hi @407412345678 @40741234567');

const image = bridge.outgoingContent('photo', {
    data: Buffer.from('x').toString('base64'),
    mimetype: 'image/jpeg',
}, ['40741234567']);
assert.strictEqual(image.caption, 'photo @40741234567');
assert.deepStrictEqual(image.mentions, ['40741234567@s.whatsapp.net']);

const audio = bridge.outgoingContent('voice', {
    data: Buffer.from('x').toString('base64'),
    mimetype: 'audio/ogg',
}, ['40741234567']);
assert.strictEqual(audio.mentions, undefined);
assert.strictEqual(audio.audio instanceof Buffer, true);

const plain = bridge.outgoingContent('hello');
assert.deepStrictEqual(plain, { text: 'hello' });

console.log('mention checks passed');
