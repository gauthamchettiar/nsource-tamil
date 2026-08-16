/**
 * TraceCheck Diagnostic Test
 *
 * Not a real provider — runs Moviesda's entire real pipeline against a
 * fixed title ("Jailer") with a checkpoint logged after every step.
 * Usage: node test_tracecheck.js
 */

const { getStreams } = require('./src/providers/tracecheck.js');

async function test() {
    const results = await getStreams();
    results.forEach(r => console.log(r.title));
}

test();
