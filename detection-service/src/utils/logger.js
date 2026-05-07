const pino = require('pino');
const { config } = require('../config');

const logger = pino({
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
});

module.exports = { logger };
