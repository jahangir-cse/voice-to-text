const { runMigrations } = require('../src/db');
const { config } = require('../src/config');

runMigrations();
console.log(`DB initialized at ${config.dbPath}`);
process.exit(0);
