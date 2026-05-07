const { logger } = require('../utils/logger');

function setErrorHandler(app) {
    app.setErrorHandler((err, req, reply) => {
        const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
        if (status >= 500) {
            logger.error({ err, url: req.url, method: req.method }, 'unhandled error');
        }
        reply.code(status).send({
            error: err.message || 'Internal Server Error',
            ...(err.validation ? { validation: err.validation } : {}),
        });
    });

    app.setNotFoundHandler((req, reply) => {
        reply.code(404).send({ error: 'Not Found', path: req.url });
    });
}

module.exports = { setErrorHandler };
