// TamilCrow Scraper for Nuvio Local Scrapers
// React Native compatible version

const cheerio = require('cheerio-without-node-native');

// TMDB API Configuration
const TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// TamilCrow Configuration
const MAIN_URL = "https://www.1tamilcrow.net";

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
 * Finds the best matching search result. TamilCrow's search mixes movies,
 * daily TV episodes and web-series episodes together, so we score every
 * result and let the caller sanity-check the winner.
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
    console.log(`[TamilCrow] Best title match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
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
  console.log(`[TamilCrow] TMDB Info: "${info.title}" (${info.year || 'N/A'})`);
  return info;
}

/**
 * Searches TamilCrow's WordPress search (same theme/markup as TamilGun).
 */
async function searchTamilCrow(query) {
  const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(searchUrl, { headers: HEADERS }, 10000);
  const html = await response.text();
  const $ = cheerio.load(html);

  const results = [];
  $('a.blog-img-link').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const title = $el.attr('title');
    if (href && title && href.startsWith(MAIN_URL)) {
      results.push({ title, href });
    }
  });

  return results;
}

/**
 * Extracts playable streams from a movie page. TamilCrow embeds via
 * multiple third-party hosts (voe.sx, ok.ru, ...) depending on the post;
 * only ok.ru is supported right now (voe.sx sits behind a client-side JS
 * redirect we can't replicate from a plain fetch).
 */
async function extractStreams(moviePageUrl) {
  const pageResponse = await fetchWithTimeout(moviePageUrl, { headers: HEADERS }, 10000);
  const pageHtml = await pageResponse.text();
  const $ = cheerio.load(pageHtml);

  const iframeSrcs = $('iframe[src]')
    .map((_, el) => $(el).attr('src'))
    .get()
    .map(src => src.startsWith('//') ? `https:${src}` : src);

  const okruSrc = iframeSrcs.find(src => /(^|\.)ok\.ru\//.test(src) || src.includes('ok.ru/videoembed'));
  if (!okruSrc) {
    console.log('[TamilCrow] No supported embed host found on movie page (only voe.sx or others present)');
    return [];
  }

  const embedResponse = await fetchWithTimeout(okruSrc, { headers: { ...HEADERS, Referer: `${MAIN_URL}/` } }, 10000);
  const embedHtml = await embedResponse.text();

  const match = embedHtml.match(/data-options="([^"]+)"/);
  if (!match) {
    console.log('[TamilCrow] No data-options found in ok.ru embed');
    return [];
  }

  let videos;
  try {
    const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const options = JSON.parse(decoded);
    const metadata = JSON.parse(options.flashvars.metadata);
    videos = metadata.videos;
  } catch (error) {
    console.log('[TamilCrow] Failed to parse ok.ru metadata:', error.message);
    return [];
  }
  if (!Array.isArray(videos)) return [];

  const QUALITY_LABELS = { hd: '720p', sd: '480p', low: '360p', lowest: '240p', mobile: '144p' };

  return videos
    .filter(v => v.url)
    .map(v => ({
      quality: QUALITY_LABELS[v.name] || v.name,
      url: v.url.replace(/&amp;/g, '&'),
      headers: { Referer: 'https://ok.ru/', 'User-Agent': HEADERS['User-Agent'] }
    }));
}

/**
 * Main function for Nuvio integration
 * @param {string} tmdbId TMDB ID or movie title
 * @param {string} mediaType "movie" or "tv"
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  console.log(`[TamilCrow] Processing ${mediaType} ${tmdbId}`);

  try {
    let mediaInfo;
    const isNumericId = /^\d+$/.test(tmdbId);
    if (isNumericId) {
      try {
        mediaInfo = await getTMDBDetails(tmdbId, mediaType);
      } catch (error) {
        console.log(`[TamilCrow] TMDB fetch failed for ${tmdbId}, using as search query`);
        mediaInfo = { title: tmdbId, year: null };
      }
    } else {
      mediaInfo = { title: tmdbId, year: null };
    }

    console.log(`[TamilCrow] Searching for: ${mediaInfo.title}`);
    const searchResults = await searchTamilCrow(mediaInfo.title);
    const bestMatch = findBestTitleMatch(mediaInfo, searchResults);

    if (!bestMatch) {
      console.log('[TamilCrow] No matching title found');
      return [];
    }

    console.log(`[TamilCrow] Found match: ${bestMatch.title} (${bestMatch.href})`);
    const streams = await extractStreams(bestMatch.href);

    const cleanTitle = bestMatch.title.replace(/^Watch\s+/i, '').replace(/\s*Online\s*:?\s*(HD)?\s*\d*$/i, '').trim();

    return streams.map(stream => ({
      name: 'TamilCrow',
      title: cleanTitle,
      url: stream.url,
      quality: stream.quality,
      headers: stream.headers,
      provider: 'TamilCrow'
    }));

  } catch (error) {
    console.error('[TamilCrow] getStreams failed:', error.message);
    return [];
  }
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = { getStreams };
}
