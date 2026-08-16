// TamilMV Scraper for Nuvio Local Scrapers
// React Native compatible version with full original functionality

const cheerio = require('cheerio-without-node-native');

// TMDB API Configuration
const TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// TamilMV Configuration
let MAIN_URL = "https://www.1tamilmv.ing";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Referer": `${MAIN_URL}/`,
};

/**
 * Fetch with timeout to prevent hanging requests
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  try {
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    }
    // Some Hermes/RN builds (seen on Android TV) don't expose
    // AbortController — race the fetch against a plain timer instead.
    return await Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timeout after ${timeout}ms`)), timeout))
    ]);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Normalizes title for comparison
 * @param {string} title 
 * @returns {string}
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates similarity score between two titles
 * @param {string} title1 First title
 * @param {string} title2 Second title
 * @returns {number} Similarity score (0-1)
 */
function calculateTitleSimilarity(title1, title2) {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  // Exact match after normalization
  if (norm1 === norm2) return 1.0;

  // Substring matches
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

  // Word-based similarity
  const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Finds the best title match from watch links
 * @param {Object} mediaInfo TMDB media info
 * @param {Array} watchLinks Watch links array
 * @returns {Object|null} Best matching result
 */
function findBestTitleMatch(mediaInfo, watchLinks) {
  if (!watchLinks || watchLinks.length === 0) return null;

  const targetTitle = mediaInfo.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetYear = mediaInfo.year ? parseInt(mediaInfo.year) : null;

  let bestMatch = null;
  let bestScore = 0;

  for (const result of watchLinks) {
    const normalizedResultTitle = result.title.toLowerCase().replace(/[^a-z0-9]/g, "");

    let score = calculateTitleSimilarity(mediaInfo.title, result.title);

    // Specific match logic from original tamilmv.js
    const titleMatch = normalizedResultTitle.includes(targetTitle) || targetTitle.includes(normalizedResultTitle);

    // Year matching logic from original tamilmv.js
    const yearMatch = !targetYear ||
      result.title.includes(targetYear.toString()) ||
      result.title.includes((targetYear + 1).toString()) ||
      result.title.includes((targetYear - 1).toString());

    if (titleMatch && yearMatch) {
      score += 0.5; // High priority for original match logic
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  if (bestMatch && bestScore > 0.4) {
    console.log(`[TamilMV] Best title match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
    return bestMatch;
  }

  return null;
}

// =================================================================================
// CORE FUNCTIONS
// =================================================================================

/**
 * Fetches metadata from TMDB
 */
async function getTMDBDetails(tmdbId, mediaType) {
  const type = mediaType === 'movie' ? 'movie' : 'tv';
  const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;

  try {
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
    console.log(`[TamilMV] TMDB Info: "${info.title}" (${info.year || 'N/A'})`);
    return info;
  } catch (error) {
    console.error("[TamilMV] Error fetching TMDB metadata:", error.message);
    throw error;
  }
}

/**
 * Extracts forum thread links (title + URL) from the homepage listing.
 * TamilMV's current mirrors no longer expose a "[WATCH]" online-embed link
 * on new releases \u2014 every thread is torrent/magnet only now \u2014 so we match
 * against the real topic titles instead.
 */
function extractHomepageThreadLinks(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a.ipsDataItem_title').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const title = $el.text().trim();
    if (href && title) {
      results.push({ title, href });
    }
  });

  return results;
}

/**
 * Extracts magnet links from a thread page, one per quality/size variant,
 * paired with the release label posted just above each magnet button.
 */
function extractMagnetLinks(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('a[href^="magnet:"]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    let label = '';
    let node = el.previousSibling;
    while (node) {
      if (node.tagName && node.tagName.toLowerCase() === 'strong') {
        label = $(node).text().trim();
        break;
      }
      node = node.previousSibling;
    }

    results.push({ label, magnet: href });
  });

  return results;
}

/**
 * Pulls a quality label (e.g. "1080p") out of a TamilMV release string.
 */
function parseQualityFromLabel(label) {
  const match = label.match(/\b(2160p|4K|1080p|720p|480p)\b/i);
  return match ? match[1].toUpperCase() : 'Unknown';
}

/**
 * Pulls a file size (e.g. "3.9GB") out of a TamilMV release string.
 */
function parseSizeFromLabel(label) {
  const matches = [...label.matchAll(/\b([\d.]+\s?(?:GB|MB))\b/gi)];
  return matches.length ? matches[matches.length - 1][1] : '';
}

/**
 * Main function for Nuvio integration
 * @param {string} tmdbId TMDB ID or movie title
 * @param {string} mediaType "movie" or "tv"
 * @param {number} season Season number (TV only)
 * @param {number} episode Episode number (TV only)
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  console.log(`[TamilMV] Processing ${mediaType} ${tmdbId}`);

  try {
    let mediaInfo;

    // Try to get TMDB details first if ID is numeric
    const isNumericId = /^\d+$/.test(tmdbId);
    if (isNumericId) {
      try {
        mediaInfo = await getTMDBDetails(tmdbId, mediaType);
      } catch (error) {
        console.log(`[TamilMV] TMDB fetch failed for ${tmdbId}, using as search query`);
        mediaInfo = { title: tmdbId, year: null };
      }
    } else {
      console.log(`[TamilMV] Using "${tmdbId}" as search query directly`);
      mediaInfo = { title: tmdbId, year: null };
    }
    console.log(`[TamilMV] Looking for ${mediaInfo.title} (${mediaInfo.year}) on homepage`);

    const homeResponse = await fetch(MAIN_URL, { headers: HEADERS });
    const homeHtml = await homeResponse.text();
    const threadLinks = extractHomepageThreadLinks(homeHtml);

    const bestMatch = findBestTitleMatch(mediaInfo, threadLinks);

    if (!bestMatch) {
      console.warn("[TamilMV] No matching title found on homepage");
      return [];
    }

    console.log(`[TamilMV] Found thread for: ${bestMatch.title}`);

    // Current mirrors only offer magnet/torrent downloads per thread (no
    // more hosted "watch online" embeds), so pull every quality variant's
    // magnet link straight from the thread page.
    const threadResponse = await fetchWithTimeout(bestMatch.href, { headers: HEADERS }, 10000);
    const threadHtml = await threadResponse.text();
    const magnetLinks = extractMagnetLinks(threadHtml);

    if (magnetLinks.length === 0) {
      console.log(`[TamilMV] No magnet links found on thread page, skipping`);
      return [];
    }

    const cleanTitle = bestMatch.title.split(" - ")[0].trim();

    return magnetLinks.map(({ label, magnet }) => ({
      name: "TamilMV",
      title: cleanTitle,
      url: magnet,
      quality: parseQualityFromLabel(label || bestMatch.title),
      size: parseSizeFromLabel(label),
      provider: 'TamilMV'
    }));

  } catch (error) {
    console.error("[TamilMV] getStreams failed:", error.message);
    return [];
  }
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  // For React Native environment
  global.getStreams = { getStreams };
}
