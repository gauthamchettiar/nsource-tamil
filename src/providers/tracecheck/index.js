// Full-pipeline trace diagnostic — not a real content provider.
//
// ParseCheck proved cheerio finds real search candidates on-device. This
// runs Moviesda's *entire* real pipeline (search -> match -> movie page ->
// players array -> plays page -> p3 JSON -> track list -> resolved
// stream URL) against a fixed, known-good title ("Jailer"), reporting a
// checkpoint after every single step, so we can see exactly which one
// breaks on-device instead of only knowing the final result is empty.
//
// This is a straight copy of moviesda/index.js's logic with checkpoints
// inserted — not a different implementation, so a difference in behavior
// here vs. in Node is meaningful.
//
// Not registered for real use — remove the manifest.json entry once done.

const cheerio = require('cheerio-without-node-native');

const TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const MAIN_URL = 'https://moviesdum.com';
const TEST_TMDB_ID = '937020'; // Jailer (2023)

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': `${MAIN_URL}/`,
};

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timeoutId);
        }
    }
    return await Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${timeout}ms`)), timeout))
    ]);
}

function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function calculateTitleSimilarity(title1, title2) {
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);
    if (norm1 === norm2) return 1.0;
    if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;
    const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 2));
    if (words1.size === 0 || words2.size === 0) return 0;
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
}

function findBestTitleMatch(mediaInfo, results) {
    if (!results || results.length === 0) return null;
    const targetYear = mediaInfo.year ? parseInt(mediaInfo.year) : null;
    let bestMatch = null;
    let bestScore = 0;
    for (const result of results) {
        let score = calculateTitleSimilarity(mediaInfo.title, result.title);
        if (targetYear && result.title.includes(String(targetYear))) score += 0.3;
        if (/\btamil\b/i.test(result.title)) score += 0.05;
        if (score > bestScore) { bestScore = score; bestMatch = result; }
    }
    return (bestMatch && bestScore > 0.5) ? { match: bestMatch, score: bestScore } : null;
}

async function getStreams() {
    const log = [];
    const step = (line) => log.push(line);

    try {
        // Step 1: TMDB lookup
        let mediaInfo;
        try {
            const res = await fetchWithTimeout(`${TMDB_BASE_URL}/movie/${TEST_TMDB_ID}?api_key=${TMDB_API_KEY}`, {}, 8000);
            const data = await res.json();
            mediaInfo = { title: data.title, year: (data.release_date || '').split('-')[0] };
            step(`1. TMDB lookup: OK - "${mediaInfo.title}" (${mediaInfo.year})`);
        } catch (error) {
            step(`1. TMDB lookup: THREW - ${error.message}`);
            return finish(log);
        }

        // Step 2: search
        let searchResults;
        try {
            const searchUrl = `${MAIN_URL}/?do=search&subaction=search&story=${encodeURIComponent(mediaInfo.title)}`;
            const res = await fetchWithTimeout(searchUrl, { headers: HEADERS }, 10000);
            const html = await res.text();
            const $ = cheerio.load(html);
            searchResults = [];
            $('div.f > a[href]').each((i, el) => {
                const $el = $(el);
                const href = $el.attr('href');
                const title = $el.text().trim();
                if (href && title) searchResults.push({ title, href });
            });
            step(`2. Search: status ${res.status}, ${html.length} bytes, ${searchResults.length} candidates extracted`);
        } catch (error) {
            step(`2. Search: THREW - ${error.message}`);
            return finish(log);
        }

        // Step 3: match
        const matchResult = findBestTitleMatch(mediaInfo, searchResults);
        if (!matchResult) {
            step(`3. Match: NONE FOUND among ${searchResults.length} candidates - ${searchResults.slice(0, 3).map(r => `"${r.title}"`).join(', ')}`);
            return finish(log);
        }
        step(`3. Match: "${matchResult.match.title}" (score ${matchResult.score.toFixed(2)}) -> ${matchResult.match.href}`);
        const bestMatch = matchResult.match;

        // Step 4: movie page
        let pageHtml;
        try {
            const res = await fetchWithTimeout(bestMatch.href, { headers: HEADERS }, 10000);
            pageHtml = await res.text();
            step(`4. Movie page: status ${res.status}, ${pageHtml.length} bytes`);
        } catch (error) {
            step(`4. Movie page: THREW - ${error.message}`);
            return finish(log);
        }

        // Step 5: players array
        const playersMatch = pageHtml.match(/var\s+players\s*=\s*\[([\s\S]*?)\];/);
        if (!playersMatch) {
            step('5. players array: NOT FOUND in movie page HTML');
            return finish(log);
        }
        const firstPlayer = playersMatch[1].match(/"([^"]+)"/);
        if (!firstPlayer || !firstPlayer[1].startsWith('/')) {
            step(`5. players array: found, but first entry is not internal -> "${firstPlayer ? firstPlayer[1] : 'none'}"`);
            return finish(log);
        }
        step(`5. players array: found, internal player path = "${firstPlayer[1]}"`);

        // Step 6: plays page
        const playsUrl = `${MAIN_URL}${firstPlayer[1]}`;
        let playsHtml;
        try {
            const res = await fetchWithTimeout(playsUrl, { headers: { ...HEADERS, Referer: bestMatch.href } }, 10000);
            playsHtml = await res.text();
            step(`6. Plays page (${playsUrl}): status ${res.status}, ${playsHtml.length} bytes`);
        } catch (error) {
            step(`6. Plays page: THREW - ${error.message}`);
            return finish(log);
        }

        // Step 7: p3 JSON
        const p3Match = playsHtml.match(/let\s+p3\s*=\s*(\{.*?\});/s);
        if (!p3Match) {
            step('7. p3 JSON: NOT FOUND in plays page HTML');
            return finish(log);
        }
        let p3;
        try {
            p3 = JSON.parse(p3Match[1]);
            step(`7. p3 JSON: parsed OK - file present: ${!!p3.file}, key present: ${!!p3.key}`);
        } catch (error) {
            step(`7. p3 JSON: found but failed to parse - ${error.message}`);
            return finish(log);
        }
        if (!p3.file || !p3.key) {
            step('7b. p3 JSON: missing file or key, stopping');
            return finish(log);
        }

        // Step 8: track list
        const origin = new URL(p3.file).origin;
        let tracks;
        try {
            const res = await fetchWithTimeout(p3.file, { method: 'POST', headers: { ...HEADERS, 'X-CSRF-TOKEN': p3.key, Referer: playsUrl } }, 10000);
            const text = await res.text();
            tracks = JSON.parse(text.replace(/,\]/g, ']'));
            step(`8. Track list: status ${res.status}, ${Array.isArray(tracks) ? tracks.length : 0} tracks (${(tracks || []).map(t => t.title).join(', ')})`);
        } catch (error) {
            step(`8. Track list: THREW - ${error.message}`);
            return finish(log);
        }

        // Step 9: resolve each track
        let resolvedCount = 0;
        for (const track of (tracks || [])) {
            if (!track.file) continue;
            try {
                const url = `${origin}/playlist/${track.file.replace(/^~/, '')}.txt`;
                const res = await fetchWithTimeout(url, { method: 'POST', headers: { ...HEADERS, 'X-CSRF-TOKEN': p3.key, Referer: playsUrl } }, 10000);
                const body = (await res.text()).trim();
                const ok = body.startsWith('http');
                if (ok) resolvedCount++;
                step(`9. Resolve "${track.title}": status ${res.status}, starts with http: ${ok}, body preview: ${body.slice(0, 60)}`);
            } catch (error) {
                step(`9. Resolve "${track.title}": THREW - ${error.message}`);
            }
        }
        step(`10. FINAL: ${resolvedCount} of ${(tracks || []).length} tracks resolved to real URLs`);

    } catch (error) {
        step(`FATAL - trace itself threw: ${error && error.message ? error.message : String(error)}`);
    }

    return finish(log);
}

function finish(log) {
    if (log.length === 0) log.push('no steps produced output (should be unreachable)');
    return log.map((line, i) => ({
        name: `TraceCheck ${i + 1}`,
        title: line,
        url: `https://example.com/tracecheck-not-playable-${i + 1}.mp4`,
        quality: 'N/A',
        provider: 'TraceCheck'
    }));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}
