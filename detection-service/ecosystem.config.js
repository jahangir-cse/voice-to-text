module.exports = {
    apps: [
        {
            name: 'detection-api',
            script: 'src/server.js',
            instances: 'max',
            exec_mode: 'cluster',
            max_memory_restart: '512M',
            env: { NODE_ENV: 'production' },
            kill_timeout: 5000,
        },
        {
            name: 'detection-worker',
            script: 'src/workers/index.js',
            instances: 1,
            exec_mode: 'fork',
            max_memory_restart: '1G',
            env: { NODE_ENV: 'production' },
            kill_timeout: 30000,
            restart_delay: 5000,
        },
    ],
};
