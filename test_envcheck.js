/**
 * EnvCheck Diagnostic Test
 *
 * Not a real provider — prints what the runtime actually supports.
 * Usage: node test_envcheck.js
 */

const { getStreams } = require('./src/providers/envcheck.js');

async function test() {
    const results = await getStreams('0', 'movie');
    results.forEach(r => console.log(r.title));
}

test();
