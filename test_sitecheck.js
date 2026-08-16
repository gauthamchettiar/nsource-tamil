/**
 * SiteCheck Diagnostic Test
 *
 * Not a real provider — checks whether each real provider's target site
 * is actually reachable and returning genuine content from this network.
 * Usage: node test_sitecheck.js
 */

const { getStreams } = require('./src/providers/sitecheck.js');

async function test() {
    const results = await getStreams();
    results.forEach(r => console.log(r.title));
}

test();
