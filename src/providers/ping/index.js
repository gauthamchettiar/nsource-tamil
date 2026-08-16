// Absolute minimum diagnostic — no requires, no fetch, no async work at
// all. If this doesn't show "PING OK" as a stream, the problem isn't in
// any provider's logic, it's in how this build loads/runs providers at
// all. Not a real content provider.

async function getStreams() {
    return [{
        name: 'Ping',
        title: 'PING OK - provider loading works on this build',
        url: 'https://example.com/ping-not-playable.mp4',
        quality: 'N/A',
        provider: 'Ping'
    }];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}
