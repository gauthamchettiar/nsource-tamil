/**
 * Ping Diagnostic Test
 *
 * Not a real provider — confirms getStreams() can be called and returns
 * a result at all. Usage: node test_ping.js
 */

const { getStreams } = require('./src/providers/ping.js');

async function test() {
    const results = await getStreams();
    results.forEach(r => console.log(r.title));
}

test();
