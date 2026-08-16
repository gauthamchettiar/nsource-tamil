// Environment diagnostic — not a real content provider.
//
// Reports what's actually available in the runtime (globals, modules,
// live network) by returning each check result as if it were a stream, so
// it's readable straight off the app's normal stream list without needing
// adb/logcat access on a device like Android TV.
//
// Every check is individually isolated (sync try/catch, or a hard-timeout
// race for the one network call) and the whole function has a top-level
// try/catch, so this should be structurally impossible to return zero
// results — if it ever does, the failure is in how this build loads
// providers, not in this file's logic. Compare against the "ping"
// provider (which does nothing but return a static result) to tell those
// two cases apart.
//
// Not registered for real use — remove the manifest.json entry once done.

function checkGlobal(name, getter) {
    try {
        const value = getter();
        return `${name}: ${value === undefined ? 'undefined' : String(value)}`;
    } catch (error) {
        return `${name}: THREW - ${error.message}`;
    }
}

function checkRequire(moduleName, probe) {
    try {
        const mod = require(moduleName);
        const probed = probe(mod);
        return `require('${moduleName}'): OK (${probed})`;
    } catch (error) {
        return `require('${moduleName}'): THREW - ${error.message}`;
    }
}

// Never lets a hung network stack (or a missing/broken fetch) block the
// rest of the report — always settles within ~4s no matter what.
function timeBoxed(promise, ms) {
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) { done = true; resolve('TIMED OUT (did not settle within ' + ms + 'ms)'); }
        }, ms);
        promise.then(
            (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
            (e) => { if (!done) { done = true; clearTimeout(timer); resolve('THREW - ' + (e && e.message ? e.message : String(e))); } }
        );
    });
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const results = [];

    try {
        results.push(checkGlobal('typeof fetch', () => typeof fetch));
        results.push(checkGlobal('typeof AbortController', () => typeof AbortController));
        results.push(checkGlobal('typeof URL', () => typeof URL));
        results.push(checkGlobal('typeof URLSearchParams', () => typeof URLSearchParams));
        results.push(checkGlobal('typeof atob', () => typeof atob));
        results.push(checkGlobal('typeof btoa', () => typeof btoa));
        results.push(checkGlobal('typeof TextDecoder', () => typeof TextDecoder));
        results.push(checkGlobal('typeof TextEncoder', () => typeof TextEncoder));
        results.push(checkGlobal('typeof Buffer', () => typeof Buffer));

        results.push(checkRequire('cheerio-without-node-native', (c) => `load=${typeof c.load}`));
        results.push(checkRequire('crypto-js', (c) => `AES=${typeof c.AES}`));
        results.push(checkRequire('axios', (c) => `get=${typeof c.get}`));

        try {
            const cheerio = require('cheerio-without-node-native');
            const $ = cheerio.load('<div class="x">hi</div>');
            results.push(`cheerio.load + select: "${$('.x').text()}"`);
        } catch (error) {
            results.push(`cheerio.load + select: THREW - ${error.message}`);
        }

        if (typeof fetch === 'function') {
            const fetchResult = await timeBoxed(
                fetch('https://api.themoviedb.org/3/movie/550?api_key=439c478a771f35c05022f9feabcca01c')
                    .then((res) => `status ${res.status}`),
                4000
            );
            results.push(`live fetch (TMDB): ${fetchResult}`);
        } else {
            results.push('live fetch (TMDB): skipped - fetch is not a function');
        }
    } catch (error) {
        results.push(`FATAL - getStreams itself threw: ${error && error.message ? error.message : String(error)}`);
    }

    if (results.length === 0) {
        results.push('no checks produced output (this line should be structurally unreachable)');
    }

    return results.map((line, i) => ({
        name: 'EnvCheck',
        title: `${i + 1}. ${line}`,
        url: 'https://example.com/envcheck-not-playable.mp4',
        quality: 'N/A',
        provider: 'EnvCheck'
    }));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}
