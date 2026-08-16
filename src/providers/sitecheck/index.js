// Site reachability diagnostic — not a real content provider.
//
// EnvCheck already confirmed fetch/JSON/cheerio/generic networking (TMDB)
// all work on this runtime. This checks the next layer down: can this
// specific device actually reach each real provider's target site and
// get a genuine response, or does something (Cloudflare WAF, ISP/regional
// blocking, etc.) intercept it before the real content comes back?
//
// Each check hits that provider's actual first search request for
// "Jailer" (or a stable endpoint where search isn't applicable) and
// reports the HTTP status plus whether the word "jailer" shows up
// anywhere in the response — a rough but effective way to tell "got real
// search results" apart from "got a challenge/block page instead".
//
// Not registered for real use — remove the manifest.json entry once done.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function timeBoxed(promise, ms) {
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) { done = true; resolve({ ok: false, note: `TIMED OUT (>${ms}ms)` }); }
        }, ms);
        promise.then(
            (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
            (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, note: 'THREW - ' + (e && e.message ? e.message : String(e)) }); } }
        );
    });
}

async function checkSite(name, url, options) {
    const opts = options || {};
    const doFetch = () => fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, method: opts.method || 'GET' })
        .then(async (res) => {
            const text = await res.text();
            const needle = (opts.contains || 'jailer').toLowerCase();
            const found = text.toLowerCase().includes(needle);
            return { ok: true, note: `status ${res.status}, "${needle}" found: ${found}, ${text.length} bytes` };
        });

    if (typeof setTimeout !== 'function') {
        // No timer mechanism available — can't bound this, but a plain
        // try/catch still gets us a real answer instead of a crash.
        try {
            const result = await doFetch();
            return `${name} (unbounded): ${result.note}`;
        } catch (error) {
            return `${name} (unbounded): THREW - ${error && error.message ? error.message : String(error)}`;
        }
    }

    const result = await timeBoxed(doFetch(), 8000);
    return `${name}: ${result.note}`;
}

async function getStreams() {
    const checks = [
        () => checkSite('TamilGun', 'https://tamilgun.now/?s=Jailer'),
        () => checkSite('TamilCrow', 'https://www.1tamilcrow.net/?s=Jailer'),
        () => checkSite('Moviesda', 'https://moviesdum.com/?do=search&subaction=search&story=Jailer'),
        () => checkSite('AllMovieLand', 'https://allmovieland.you/?do=search&subaction=search&story=Jailer'),
        () => checkSite('Isaimini', 'https://isaiminihits.com/?do=search&subaction=search&story=Jailer'),
        () => checkSite('TamilDude', 'https://tamildude.net/?s=Jailer'),
        () => checkSite('Movies4u', 'https://movies4u.ax/?s=Jailer'),
        () => checkSite('TamilMV', 'https://www.1tamilmv.ing/', { contains: 'ipsdataitem' }),
        () => checkSite('MovieBlast', 'https://app.cloud-mb.xyz/api/search/Jailer/jdvhhjv255vghhghdhvfch2565656jhdcghfdf', { contains: 'name' }),
        () => checkSite('Castle-securitykey', 'https://api.hlowb.com/v0.1/system/getSecurityKey/1?channel=IndiaA&clientType=1&lang=en-US', { contains: 'code' }),
        () => checkSite('Einthusan-proxy', 'https://einthusan.asaddon.com/tamil/stream/movie/tt11663228.json', { contains: 'stream' }),
        () => checkSite('ZinkMovies', 'https://new3.zinkmovies.today/?s=Jailer'),
        () => checkSite('Isaidub', 'https://isaidub.love/', { contains: 'isaidub' }),
    ];

    const results = [];
    for (const check of checks) {
        try {
            results.push(await check());
        } catch (error) {
            results.push(`CHECK CRASHED: ${error && error.message ? error.message : String(error)}`);
        }
    }

    if (results.length === 0) {
        results.push('no checks produced output (this line should be structurally unreachable)');
    }

    return results.map((line, i) => ({
        name: 'SiteCheck',
        title: `${i + 1}. ${line}`,
        url: 'https://example.com/sitecheck-not-playable.mp4',
        quality: 'N/A',
        provider: 'SiteCheck'
    }));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}
