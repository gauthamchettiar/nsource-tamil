// TamilDude Scraper for Nuvio Local Scrapers
// React Native compatible version

const cheerio = require('cheerio-without-node-native');

// TMDB API Configuration
const TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// TamilDude Configuration
const MAIN_URL = "https://tamildude.net";

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
    console.log(`[TamilDude] Best match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
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
  console.log(`[TamilDude] TMDB Info: "${info.title}" (${info.year || 'N/A'})`);
  return info;
}

/**
 * Searches TamilDude's WordPress search (same beeteam368 theme family as
 * this repo's TamilGun/TamilCrow providers).
 */
async function searchTamilDude(query) {
  const searchUrl = `${MAIN_URL}/?s=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(searchUrl, { headers: HEADERS }, 10000);
  const html = await response.text();
  const $ = cheerio.load(html);

  const results = [];
  $('a[href*="/video/"]').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const title = $el.attr('title') || $el.find('img').attr('alt') || $el.text().trim();
    if (href && title) {
      results.push({ title, href });
    }
  });

  return results;
}

/**
 * Extracts the direct stream from a movie page. TamilDude embeds via
 * vidmoly.org, whose embed page ships a plain (unobfuscated) JWPlayer
 * `sources: [{file: '...m3u8'}]` block.
 */
async function extractStreams(moviePageUrl) {
  const pageResponse = await fetchWithTimeout(moviePageUrl, { headers: HEADERS }, 10000);
  const pageHtml = await pageResponse.text();
  const $ = cheerio.load(pageHtml);

  const iframeSrcs = $('iframe[src]')
    .map((_, el) => $(el).attr('src'))
    .get()
    .map(src => src.startsWith('//') ? `https:${src}` : src);

  const vidmolySrc = iframeSrcs.find(src => src.includes('vidmoly.'));
  if (!vidmolySrc) {
    console.log('[TamilDude] No supported embed host found on movie page');
    return [];
  }

  const embedResponse = await fetchWithTimeout(vidmolySrc, { headers: { ...HEADERS, Referer: `${MAIN_URL}/` } }, 10000);
  const embedHtml = await embedResponse.text();

  const match = embedHtml.match(/file:\s*'([^']+\.m3u8[^']*)'/);
  if (!match) {
    console.log('[TamilDude] No stream URL found in vidmoly embed');
    return [];
  }

  return [{
    url: match[1],
    headers: { Referer: 'https://vidmoly.org/', 'User-Agent': HEADERS['User-Agent'] }
  }];
}

/**
 * Main function for Nuvio integration
 * @param {string} tmdbId TMDB ID or movie title
 * @param {string} mediaType "movie" or "tv"
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  console.log(`[TamilDude] Processing ${mediaType} ${tmdbId}`);

  try {
    let mediaInfo;
    const isNumericId = /^\d+$/.test(tmdbId);
    if (isNumericId) {
      try {
        mediaInfo = await getTMDBDetails(tmdbId, mediaType);
      } catch (error) {
        console.log(`[TamilDude] TMDB fetch failed for ${tmdbId}, using as search query`);
        mediaInfo = { title: tmdbId, year: null };
      }
    } else {
      mediaInfo = { title: tmdbId, year: null };
    }

    console.log(`[TamilDude] Searching for: "${mediaInfo.title}"`);
    const searchResults = await searchTamilDude(mediaInfo.title);
    const bestMatch = findBestTitleMatch(mediaInfo, searchResults);

    if (!bestMatch) {
      console.warn('[TamilDude] No matching title found');
      return [];
    }

    console.log(`[TamilDude] Found match: ${bestMatch.title} (${bestMatch.href})`);
    const streams = await extractStreams(bestMatch.href);

    if (streams.length === 0) {
      console.warn('[TamilDude] No streams found on movie page');
      return [];
    }

    return streams.map(stream => ({
      name: 'TamilDude',
      title: mediaInfo.title,
      url: stream.url,
      quality: 'HLS',
      headers: stream.headers,
      provider: 'TamilDude'
    }));

  } catch (error) {
    console.error('[TamilDude] getStreams failed:', error.message);
    return [];
  }
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = { getStreams };
}
