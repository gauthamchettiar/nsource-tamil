// cheerio extraction diagnostic — not a real content provider.
//
// SiteCheck already confirmed networking + reachability: every real site
// returns 200 with the search term genuinely present in the raw bytes.
// So the remaining suspect is the parsing step — whether
// cheerio-without-node-native's selector engine actually finds the right
// elements in real, large, messy HTML (as opposed to the one-line
// synthetic snippet EnvCheck tested). This runs the *exact* selectors
// several real providers use against real fetched pages and reports what
// cheerio actually extracts.
//
// Not registered for real use — remove the manifest.json entry once done.

const cheerio = require('cheerio-without-node-native');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function safeFetch(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    return res.text();
}

async function checkMoviesda() {
    const html = await safeFetch('https://moviesdum.com/?do=search&subaction=search&story=Jailer');
    const $ = cheerio.load(html);
    const items = [];
    $('div.f > a[href]').each((i, el) => {
        items.push({ href: $(el).attr('href'), text: $(el).text().trim() });
    });
    return { site: 'Moviesda', selector: "div.f > a[href]", bytes: html.length, matched: items.length, sample: items.slice(0, 2) };
}

async function checkTamilGun() {
    const html = await safeFetch('https://tamilgun.now/?s=Jailer');
    const $ = cheerio.load(html);
    const items = [];
    $('a.blog-img-link').each((i, el) => {
        items.push({ href: $(el).attr('href'), title: $(el).attr('title') });
    });
    return { site: 'TamilGun', selector: 'a.blog-img-link', bytes: html.length, matched: items.length, sample: items.slice(0, 2) };
}

async function checkTamilMV() {
    const html = await safeFetch('https://www.1tamilmv.ing/');
    const $ = cheerio.load(html);
    const items = [];
    $('a.ipsDataItem_title').each((i, el) => {
        items.push({ href: $(el).attr('href'), text: $(el).text().trim().slice(0, 40) });
    });
    return { site: 'TamilMV', selector: 'a.ipsDataItem_title', bytes: html.length, matched: items.length, sample: items.slice(0, 2) };
}

async function checkAllMovieLand() {
    const html = await safeFetch('https://allmovieland.you/?do=search&subaction=search&story=Elemental');
    const $ = cheerio.load(html);
    const items = [];
    $('a.new-short__title--link').each((i, el) => {
        items.push({ href: $(el).attr('href'), text: $(el).find('h3').text().trim() });
    });
    return { site: 'AllMovieLand', selector: 'a.new-short__title--link', bytes: html.length, matched: items.length, sample: items.slice(0, 2) };
}

function formatResult(r) {
    const sampleText = r.sample.length
        ? r.sample.map(s => JSON.stringify(s)).join(' | ')
        : '(none)';
    return `${r.site} [${r.selector}]: ${r.bytes} bytes, ${r.matched} matched -> ${sampleText}`;
}

async function getStreams() {
    const checks = [checkMoviesda, checkTamilGun, checkTamilMV, checkAllMovieLand];
    const results = [];

    for (const check of checks) {
        try {
            results.push(formatResult(await check()));
        } catch (error) {
            results.push(`${check.name}: THREW - ${error && error.message ? error.message : String(error)}`);
        }
    }

    if (results.length === 0) {
        results.push('no checks produced output (this line should be structurally unreachable)');
    }

    return results.map((line, i) => ({
        name: `ParseCheck ${i + 1}`,
        title: `${i + 1}. ${line}`,
        url: `https://example.com/parsecheck-not-playable-${i + 1}.mp4`,
        quality: 'N/A',
        provider: 'ParseCheck'
    }));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}
