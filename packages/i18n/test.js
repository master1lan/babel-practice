const crypto = require('crypto-js');
const name = '你好';
const res = crypto.MD5(name).toString().slice(0, 15);
console.log({ res });
