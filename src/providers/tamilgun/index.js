// TamilGun Scraper for Nuvio Local Scrapers
// React Native compatible version

const cheerio = require('cheerio-without-node-native');

// TMDB API Configuration
const TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// TamilGun Configuration
const MAIN_URL = "https://tamilgun.now";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": `${MAIN_URL}/`,
};

/**
 * Fetch with timeout + one retry on network errors / 5xx gateway failures.
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    try {
      let response;
      if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          response = await fetch(url, { ...options, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
      } else {
        // Some Hermes/RN builds (seen on Android TV) don't expose
        // AbortController — race the fetch against a plain timer instead.
        response = await Promise.race([
          fetch(url, options),
          new Promise((_, reject) => setTimeout(() => {
            const err = new Error(`Request timeout after ${timeout}ms`);
            err.name = 'AbortError';
            reject(err);
          }, timeout))
        ]);
      }
      if (response.status >= 500 && response.status <= 504 && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (error) {
      const err = error.name === 'AbortError' ? new Error(`Request timeout after ${timeout}ms`) : error;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Normalizes title for comparison
 */
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

/**
 * Finds the best matching search result for the TMDB title/year.
 * TamilGun's post titles are usually just "<Movie Name> HD" with no year,
 * so matching leans on fuzzy title similarity rather than a hard year check.
 */
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
    console.log(`[TamilGun] Best title match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
    return bestMatch;
  }

  return null;
}

/**
 * Fetches metadata from TMDB
 */
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
  console.log(`[TamilGun] TMDB Info: "${info.title}" (${info.year || 'N/A'})`);
  return info;
}

/**
 * Searches TamilGun and extracts result titles + links from the WordPress
 * search results grid.
 */
async function searchTamilGun(query) {
  const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(searchUrl, { headers: HEADERS }, 10000);
  const html = await response.text();
  const $ = cheerio.load(html);

  const results = [];
  $('a.blog-img-link').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const title = $el.attr('title');
    if (href && title) {
      results.push({ title, href });
    }
  });

  return results;
}

/**
 * Extracts every direct/embed stream candidate from a movie page: finds the
 * primary player iframe (an internal player.<host> embed), then reads its
 * server-rendered __NEXT_DATA__ JSON for the actual CDN stream URLs.
 */
async function extractStreams(moviePageUrl) {
  const pageResponse = await fetchWithTimeout(moviePageUrl, { headers: HEADERS }, 10000);
  const pageHtml = await pageResponse.text();
  const $ = cheerio.load(pageHtml);

  const iframeSrc = $('#player-1 iframe').attr('src') || $('.video-container iframe').first().attr('src');
  if (!iframeSrc) {
    console.log('[TamilGun] No player iframe found on movie page');
    return [];
  }

  const embedResponse = await fetchWithTimeout(iframeSrc, { headers: { ...HEADERS, Referer: `${MAIN_URL}/` } }, 10000);
  const embedHtml = await embedResponse.text();

  const match = embedHtml.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) {
    console.log('[TamilGun] No __NEXT_DATA__ found in player embed');
    return [];
  }

  let servers;
  try {
    const data = JSON.parse(match[1]);
    servers = data?.props?.pageProps?.moviesRedis;
  } catch (error) {
    console.log('[TamilGun] Failed to parse player data:', error.message);
    return [];
  }
  if (!servers) return [];

  const embedOrigin = new URL(iframeSrc).origin;

  return Object.values(servers)
    .filter(server => server.type === 'direct' && server.urlStream)
    .map(server => ({
      name: server.name || 'TamilGun',
      url: server.urlStream,
      headers: {
        'Referer': `${embedOrigin}/`,
        'User-Agent': HEADERS['User-Agent']
      }
    }));
}

/**
 * Main function for Nuvio integration
 * @param {string} tmdbId TMDB ID or movie title
 * @param {string} mediaType "movie" or "tv"
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  console.log(`[TamilGun] Processing ${mediaType} ${tmdbId}`);

  try {
    let mediaInfo;
    const isNumericId = /^\d+$/.test(tmdbId);
    if (isNumericId) {
      try {
        mediaInfo = await getTMDBDetails(tmdbId, mediaType);
      } catch (error) {
        console.log(`[TamilGun] TMDB fetch failed for ${tmdbId}, using as search query`);
        mediaInfo = { title: tmdbId, year: null };
      }
    } else {
      mediaInfo = { title: tmdbId, year: null };
    }

    console.log(`[TamilGun] Searching for: ${mediaInfo.title}`);
    const searchResults = await searchTamilGun(mediaInfo.title);
    const bestMatch = findBestTitleMatch(mediaInfo, searchResults);

    if (!bestMatch) {
      console.log('[TamilGun] No matching title found');
      return [];
    }

    console.log(`[TamilGun] Found match: ${bestMatch.title} (${bestMatch.href})`);
    const streams = await extractStreams(bestMatch.href);

    const cleanTitle = bestMatch.title.replace(/\s*HD$/i, '').trim();

    return streams.map(stream => ({
      name: 'TamilGun',
      title: cleanTitle,
      url: stream.url,
      quality: stream.url.includes('.m3u8') ? 'HLS' : 'Unknown',
      headers: stream.headers,
      provider: 'TamilGun'
    }));

  } catch (error) {
    console.error('[TamilGun] getStreams failed:', error.message);
    return [];
  }
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = { getStreams };
}
