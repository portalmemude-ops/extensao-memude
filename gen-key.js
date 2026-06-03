// Gera um par de chaves RSA, o valor "key" do manifest e o ID fixo da extensao.
const crypto = require('crypto');
const fs = require('fs');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const manifestKey = publicKey.toString('base64');

// Extension ID = sha256(DER public key), primeiros 16 bytes, hex -> a..p
const hash = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
const extId = hash.replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)]);

fs.writeFileSync('key.pem', privateKey);

console.log('MANIFEST_KEY=' + manifestKey);
console.log('EXTENSION_ID=' + extId);
console.log('REDIRECT_URI=https://' + extId + '.chromiumapp.org/');
