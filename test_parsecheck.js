/**
 * ParseCheck Diagnostic Test
 *
 * Not a real provider — runs real providers' actual cheerio selectors
 * against real fetched pages and reports what gets extracted.
 * Usage: node test_parsecheck.js
 */

const { getStreams } = require('./src/providers/parsecheck.js');

async function test() {
    const results = await getStreams();
    results.forEach(r => console.log(r.title));
}

test();
