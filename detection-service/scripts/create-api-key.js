const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { runMigrations, stmts } = require('../src/db');

function parseArgs() {
    const args = { branch: null, quota: 100000, admin: false };
    for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (a === '--branch') args.branch = process.argv[++i];
        else if (a === '--quota') args.quota = parseInt(process.argv[++i], 10);
        else if (a === '--admin') args.admin = true;
    }
    return args;
}

(async () => {
    const args = parseArgs();
    if (!args.branch) {
        console.error('Usage: npm run create-api-key -- --branch <name> [--quota 100000] [--admin]');
        process.exit(1);
    }

    runMigrations();

    const plain = crypto.randomBytes(32).toString('base64url');
    const hash = await bcrypt.hash(plain, 10);
    stmts.insertApiKey.run(hash, args.branch, args.quota, args.admin ? 1 : 0);

    console.log('\n✅ API key created');
    console.log(`Branch:       ${args.branch}`);
    console.log(`Daily quota:  ${args.quota}`);
    console.log(`Admin:        ${args.admin ? 'YES' : 'no'}`);
    console.log(`\nAPI key (save securely — shown only once):\n\n  ${plain}\n`);
    process.exit(0);
})().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
});
