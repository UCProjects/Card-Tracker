const crypto = require('crypto');

module.exports = (data) => crypto.createHash('sha1').update(data).digest('hex');
