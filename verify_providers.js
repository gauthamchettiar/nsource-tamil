/**
 * Offline provider integrity check — makes NO network requests.
 *
 * Catches the structural failures that break providers in the Nuvio app but
 * slip past the per-provider test_*.js harnesses:
 *
 *   1. manifest entries that point at missing files
 *   2. bundles on disk that nothing in the manifest references
 *   3. bundles that fail to load or don't export getStreams
 *   4. Hermes incompatibilities (async/await, Buffer, Node builtins)
 *   5. committed bundles that don't match a fresh build
 *   6. providers outside the repo's Indian-regional scope
 *   7. test harnesses requiring sources instead of built bundles
 *
 * Usage: node verify_providers.js  (exit 0 = clean, 1 = problems found)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const PROVIDER_DIR = path.join(ROOT, 'src', 'providers');

// Scope: this repo carries Indian regional content only.
const INDIAN_LANGS = new Set(['ta', 'hi', 'ml', 'te', 'kn', 'bn', 'mr', 'pa', 'gu', 'or', 'as', 'ur']);

// Absent in Hermes / React Native. Buffer is the one that has actually bitten us.
const NODE_ONLY = /\bBuffer\b|require\(["'](crypto|fs|path|http|https|zlib|stream|node-forge)["']\)/;
const ASYNC_AWAIT = /\basync\b|\bawait\b/;
// Present in some RN versions, absent in others — worth a warning, not a failure.
const RISKY_GLOBALS = /\b(atob|btoa|DOMParser|TextDecoder|TextEncoder|localStorage|structuredClone)\b/g;

let failures = 0;
let warnings = 0;

function fail(msg) { console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`); failures++; }
function warn(msg) { console.log(`  \x1b[33mWARN\x1b[0m  ${msg}`); warnings++; }
function ok(msg) { console.log(`  \x1b[32mok\x1b[0m    ${msg}`); }
function section(title) { console.log(`\n${title}`); }

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const scrapers = manifest.scrapers;

// ---------------------------------------------------------------- 1. manifest
section('Manifest integrity');
for (const s of scrapers) {
    const bundle = path.join(ROOT, s.filename);
    const source = path.join(PROVIDER_DIR, s.id, 'index.js');
    if (!fs.existsSync(bundle)) fail(`${s.id}: bundle missing (${s.filename})`);
    else if (!fs.existsSync(source)) fail(`${s.id}: source missing (src/providers/${s.id}/index.js)`);
    else ok(`${s.id}`);

    if (path.basename(s.filename, '.js') !== s.id) {
        warn(`${s.id}: filename basename does not match id (${s.filename})`);
    }
}

// ------------------------------------------------------------- 2. orphan files
section('Orphan bundles');
const referenced = new Set(scrapers.map(s => path.basename(s.filename)));
const orphans = fs.readdirSync(PROVIDER_DIR).filter(f => f.endsWith('.js') && !referenced.has(f));
orphans.length ? orphans.forEach(o => fail(`${o} is not referenced by manifest.json`))
               : ok('none');

// -------------------------------------------------------------- 3. export shape
section('Export contract');
for (const s of scrapers) {
    try {
        const mod = require(path.join(ROOT, s.filename));
        if (typeof mod.getStreams !== 'function') fail(`${s.id}: does not export getStreams()`);
        else ok(`${s.id}: getStreams()`);
    } catch (e) {
        fail(`${s.id}: failed to load — ${e.message.split('\n')[0]}`);
    }
}

// --------------------------------------------------------- 4. Hermes soundness
section('Hermes compatibility');
for (const s of scrapers) {
    const bundlePath = path.join(ROOT, s.filename);
    if (!fs.existsSync(bundlePath)) continue;
    const code = fs.readFileSync(bundlePath, 'utf8');
    const problems = [];

    if (ASYNC_AWAIT.test(code)) problems.push('residual async/await (build did not transpile)');
    const nodeOnly = code.match(NODE_ONLY);
    if (nodeOnly) problems.push(`Node-only API: ${nodeOnly[0]}`);

    problems.forEach(p => fail(`${s.id}: ${p}`));

    const risky = [...new Set(code.match(RISKY_GLOBALS) || [])];
    if (risky.length) warn(`${s.id}: version-dependent in RN — ${risky.join(', ')}`);
    if (!problems.length && !risky.length) ok(`${s.id}`);
}

// ------------------------------------------------------- 5. build reproducibility
section('Build reproducibility');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvio-verify-'));
try {
    execFileSync('node', ['build.js', '--minify', `--outdir=${tmp}`], { cwd: ROOT, stdio: 'pipe' });
    for (const s of scrapers) {
        const fresh = path.join(tmp, path.basename(s.filename));
        const committed = path.join(ROOT, s.filename);
        if (!fs.existsSync(fresh)) { fail(`${s.id}: fresh build produced no output`); continue; }
        if (!fs.existsSync(committed)) continue;
        // Drop the 4-line generated-timestamp banner before comparing.
        const strip = f => fs.readFileSync(f, 'utf8').split('\n').slice(4).join('\n');
        strip(fresh) === strip(committed)
            ? ok(`${s.id}`)
            : fail(`${s.id}: committed bundle differs from a fresh build — run \`npm run build\``);
    }
} catch (e) {
    fail(`build failed: ${(e.stderr || e.message).toString().split('\n')[0]}`);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------------------- 6. content scope
section('Content scope (Indian regional)');
for (const s of scrapers) {
    const langs = s.contentLanguage || [];
    langs.some(l => INDIAN_LANGS.has(l))
        ? ok(`${s.id}: [${langs.join(', ')}]`)
        : fail(`${s.id}: no Indian language in [${langs.join(', ')}]`);
}

// ------------------------------------------------------------ 7. harness targets
section('Test harnesses target built bundles');
for (const s of scrapers) {
    const harness = path.join(ROOT, `test_${s.id}.js`);
    if (!fs.existsSync(harness)) { warn(`${s.id}: no test_${s.id}.js`); continue; }
    const code = fs.readFileSync(harness, 'utf8');
    if (new RegExp(`src/providers/${s.id}/index\\.js`).test(code)) {
        fail(`test_${s.id}.js requires the source, not the built bundle — ` +
             `Node-only APIs will pass here and fail in the app`);
    } else ok(`test_${s.id}.js`);
}

// ------------------------------------------------------------------- summary
const total = scrapers.length;
console.log(`\n${'─'.repeat(60)}`);
console.log(`${total} provider(s): ${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures ? 1 : 0);
