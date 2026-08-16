/**
 * Ad-hoc diagnostic: logs every HTTP request/response the provider makes
 * (via axios interceptors, since axios is `external` in build.js and thus
 * shared with this process's require cache) while calling getStreams.
 *
 * Usage: node diag.js <providerId> <tmdbId> [mediaType] [season] [episode]
 */
const axios = require('axios');

if (typeof global.fetch === 'function') {
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
        const u = typeof url === 'string' ? url : url?.url;
        console.log(`[FETCH] ${opts?.method || 'GET'} ${u}`);
        try {
            const res = await origFetch(url, opts);
            console.log(`[FETCH RES] ${res.status} ${u}`);
            return res;
        } catch (e) {
            console.log(`[FETCH ERROR] ${e.message} ${u}`);
            throw e;
        }
    };
}

setTimeout(() => {
    console.log('\n[HARD TIMEOUT] getStreams did not resolve within 25s — provider is likely stuck retrying or hitting a dead endpoint.');
    process.exit(1);
}, 25000).unref?.() || null;

axios.interceptors.request.use((config) => {
    console.log(`[REQ] ${config.method?.toUpperCase() || 'GET'} ${config.url}`);
    return config;
}, (err) => { console.log('[REQ ERROR]', err.message); return Promise.reject(err); });

axios.interceptors.response.use((res) => {
    console.log(`[RES] ${res.status} ${res.config.url} (${(res.data ? JSON.stringify(res.data).length : 0)} bytes)`);
    return res;
}, (err) => {
    if (err.response) {
        console.log(`[RES ERROR] ${err.response.status} ${err.config?.url}`);
    } else {
        console.log(`[RES ERROR] ${err.message} ${err.config?.url || ''}`);
    }
    return Promise.reject(err);
});

const id = process.argv[2];
const tmdbId = process.argv[3] || '19995';
const mediaType = process.argv[4] || 'movie';
const season = process.argv[5] ? parseInt(process.argv[5]) : undefined;
const episode = process.argv[6] ? parseInt(process.argv[6]) : undefined;

if (!id) {
    console.log('Usage: node diag.js <providerId> <tmdbId> [mediaType] [season] [episode]');
    process.exit(1);
}

const { getStreams } = require(`./src/providers/${id}.js`);

(async () => {
    console.log(`\n=== ${id} :: tmdbId=${tmdbId} type=${mediaType} s=${season} e=${episode} ===\n`);
    try {
        const streams = await getStreams(tmdbId, mediaType, season, episode);
        console.log(`\nRESULT: ${streams ? streams.length : 0} stream(s)`);
        if (streams && streams.length) console.log(streams.slice(0, 2));
    } catch (e) {
        console.log('\nTHREW:', e && e.stack ? e.stack : e);
    }
})();
