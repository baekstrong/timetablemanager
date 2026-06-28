const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 10;

function deriveUid(name) {
  return 'u_' + crypto.createHash('sha1').update(name).digest('hex');
}

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { deriveUid, hashPassword, verifyPassword };
