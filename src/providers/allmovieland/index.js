// AllMovieLand Scraper for Nuvio Local Scrapers
// React Native compatible version
//
// Full rewrite of the ported (obfuscated) original: its search request was
// blocked by the site's Cloudflare WAF, and its embed-page parser was
// selecting the wrong element and never actually finding the player data.
// AllMovieLand runs the exact same player backend as Moviesda
// (rasta428jem.com, same p3/HDVBPlayer JSON, same playlist-token
// resolution) — this mirrors that provider's extraction logic.

const cheerio = require('cheerio-without-node-native');

// TMDB API Configuration
const TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// AllMovieLand Configuration
const MAIN_URL = "https://allmovieland.you";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": `${MAIN_URL}/`,
};

/**
 * Fetch with timeout + one retry on network errors / 5xx gateway failures.
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000, retries = 1) {
    for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.status >= 500 && response.status <= 504 && attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            const err = error.name === 'AbortError' ? new Error(`Request timeout after ${timeout}ms`) : error;
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }
            throw err;
        }
    }
}

function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
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

    let bestMatch = null;
    let bestScore = 0;

    for (const result of results) {
        const score = calculateTitleSimilarity(mediaInfo.title, result.title);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = result;
        }
    }

    if (bestMatch && bestScore > 0.5) {
        console.log(`[AllMovieLand] Best match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
        return bestMatch;
    }

    return null;
}

async function getTMDBDetails(tmdbId, mediaType) {
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;

    const response = await fetchWithTimeout(url, {}, 8000);
    if (!response.ok) {
        throw new Error(`TMDB error: ${response.status}`);
    }
    const data = await response.json();
    if (!data.title && !data.name) {
        throw new Error('TMDB returned no title');
    }

    const info = {
        title: data.title || data.name,
        year: (data.release_date || data.first_air_date || "").split("-")[0]
    };
    console.log(`[AllMovieLand] TMDB Info: "${info.title}" (${info.year || 'N/A'})`);
    return info;
}

/**
 * Searches AllMovieLand. Its Cloudflare WAF 403s the "obvious" search shape
 * (story= as the first query param, or hitting /index.php at all) — hitting
 * the bare root path with do/subaction ordered before story sails through.
 */
async function searchAllMovieLand(query) {
    const searchUrl = `${MAIN_URL}/?do=search&subaction=search&story=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(searchUrl, { headers: HEADERS }, 10000);
    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];
    $('a.new-short__title--link').each((i, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const title = $el.find('h3').text().trim() || $el.text().trim();
        if (href && title) {
            results.push({ title, href });
        }
    });

    return results;
}

/**
 * Resolves one of this player's "~"-prefixed playlist file tokens into its
 * final CDN stream URL — the response body for a resolved token IS the URL.
 */
async function resolvePlaylistToken(origin, token, csrfKey, referer) {
    const url = `${origin}/playlist/${token.replace(/^~/, '')}.txt`;
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { ...HEADERS, 'X-CSRF-TOKEN': csrfKey, 'Referer': referer }
    }, 10000);
    const text = (await response.text()).trim();
    return text.startsWith('http') ? text : null;
}

/**
 * Extracts every language track's direct stream URL from a movie page.
 */
async function extractStreams(moviePageUrl) {
    const pageResponse = await fetchWithTimeout(moviePageUrl, { headers: HEADERS }, 10000);
    const pageHtml = await pageResponse.text();

    const domainMatch = pageHtml.match(/const AwsIndStreamDomain\s*=\s*'([^']+)'/);
    const srcMatch = pageHtml.match(/src:\s*'([^']+)'/);
    if (!domainMatch || !srcMatch) {
        console.log('[AllMovieLand] No player domain/src found on movie page');
        return [];
    }

    const playsUrl = `${domainMatch[1].replace(/\/$/, '')}/play/${srcMatch[1]}`;
    const playsResponse = await fetchWithTimeout(playsUrl, { headers: { ...HEADERS, Referer: moviePageUrl } }, 10000);
    const playsHtml = await playsResponse.text();

    const p3Match = playsHtml.match(/let\s+p3\s*=\s*(\{.*?\});/s);
    if (!p3Match) {
        console.log('[AllMovieLand] No player data (p3) found');
        return [];
    }

    let p3;
    try {
        p3 = JSON.parse(p3Match[1]);
    } catch (error) {
        console.log('[AllMovieLand] Failed to parse player data:', error.message);
        return [];
    }
    if (!p3.file || !p3.key) return [];

    const origin = new URL(p3.file).origin;

    const tracksResponse = await fetchWithTimeout(p3.file, {
        method: 'POST',
        headers: { ...HEADERS, 'X-CSRF-TOKEN': p3.key, 'Referer': playsUrl }
    }, 10000);
    let tracks;
    try {
        tracks = JSON.parse((await tracksResponse.text()).replace(/,\]/g, ']'));
    } catch (error) {
        console.log('[AllMovieLand] Failed to parse track list:', error.message);
        return [];
    }
    if (!Array.isArray(tracks)) return [];

    const streams = [];
    for (const track of tracks) {
        if (!track.file) continue;
        try {
            const streamUrl = await resolvePlaylistToken(origin, track.file, p3.key, playsUrl);
            if (streamUrl) {
                streams.push({ language: track.title || '', url: streamUrl });
            }
        } catch (error) {
            console.log(`[AllMovieLand] Failed to resolve track "${track.title}":`, error.message);
        }
    }

    return streams;
}

/**
 * Main function for Nuvio integration
 * @param {string} tmdbId TMDB ID or movie title
 * @param {string} mediaType "movie" or "tv"
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    console.log(`[AllMovieLand] Processing ${mediaType} ${tmdbId}`);

    try {
        let mediaInfo;
        const isNumericId = /^\d+$/.test(tmdbId);
        if (isNumericId) {
            try {
                mediaInfo = await getTMDBDetails(tmdbId, mediaType);
            } catch (error) {
                console.log(`[AllMovieLand] TMDB fetch failed for ${tmdbId}, using as search query`);
                mediaInfo = { title: tmdbId, year: null };
            }
        } else {
            mediaInfo = { title: tmdbId, year: null };
        }

        console.log(`[AllMovieLand] Searching for: "${mediaInfo.title}"`);
        const searchResults = await searchAllMovieLand(mediaInfo.title);
        const bestMatch = findBestTitleMatch(mediaInfo, searchResults);

        if (!bestMatch) {
            console.warn('[AllMovieLand] No matching title found');
            return [];
        }

        console.log(`[AllMovieLand] Found match: ${bestMatch.title} (${bestMatch.href})`);
        const streams = await extractStreams(bestMatch.href);

        if (streams.length === 0) {
            console.warn('[AllMovieLand] No streams found on movie page');
            return [];
        }

        return streams.map(stream => ({
            name: 'AllMovieLand',
            title: `${mediaInfo.title}${stream.language ? ` (${stream.language})` : ''}`,
            url: stream.url,
            quality: 'HLS',
            headers: {
                'Referer': `${MAIN_URL}/`,
                'User-Agent': HEADERS['User-Agent']
            },
            provider: 'AllMovieLand'
        }));

    } catch (error) {
        console.error('[AllMovieLand] getStreams failed:', error.message);
        return [];
    }
}

module.exports = { getStreams };
