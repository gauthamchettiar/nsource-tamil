// Environment diagnostic — not a real content provider.
//
// Reports what's actually available in the runtime (globals, modules,
// live network) by returning each check result as if it were a stream, so
// it's readable straight off the Plugin Tester's Results list without
// needing adb/logcat access on a device like Android TV.
//
// Load via Plugin Tester > Individual Plugin > Load Source > From URL,
// pointing at this file's raw URL. Not registered in manifest.json on
// purpose — it has nothing to play.

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

async function getStreams(tmdbId, mediaType, season, episode) {
    const results = [];

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
        const res = await fetch('https://api.themoviedb.org/3/movie/550?api_key=439c478a771f35c05022f9feabcca01c');
        results.push(`live fetch (TMDB): status ${res.status}`);
    } catch (error) {
        results.push(`live fetch (TMDB): THREW - ${error.message}`);
    }

    try {
        const cheerio = require('cheerio-without-node-native');
        const $ = cheerio.load('<div class="x">hi</div>');
        results.push(`cheerio.load + select: "${$('.x').text()}"`);
    } catch (error) {
        results.push(`cheerio.load + select: THREW - ${error.message}`);
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
