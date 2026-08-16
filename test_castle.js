/**
 * Castle Provider Test
 *
 * Usage:
 *   node test_castle.js [tmdbId] [mediaType] [season] [episode]
 *
 * Example:
 *   node test_castle.js 937020 movie   (Jailer)
 *   node test_castle.js 1396 tv 1 1    (Breaking Bad S1E1)
 */

const { getStreams } = require('./src/providers/castle.js');

async function test() {
    console.log("Starting Castle test...");
    const tmdbId = process.argv[2] || '937020';
    const mediaType = process.argv[3] || 'movie';
    const season = process.argv[4] ? parseInt(process.argv[4]) : undefined;
    const episode = process.argv[5] ? parseInt(process.argv[5]) : undefined;

    console.log(`TMDB ID: ${tmdbId} (Type: ${mediaType})`);

    try {
        const streams = await getStreams(tmdbId, mediaType, season, episode);
        console.log("\n--- Results ---");
        if (streams && streams.length > 0) {
            streams.forEach((stream, index) => {
                console.log(`\nStream ${index + 1}:`);
                console.log(`Name: ${stream.name}`);
                console.log(`Quality: ${stream.quality} | Size: ${stream.size}`);
                console.log(`URL: ${(stream.url || '').substring(0, 100)}...`);
            });
            console.log(`\n✅ Success: Found ${streams.length} streams.`);
        } else {
            console.log("\n❌ Failure: No streams found. Check the tmdbId or provider logic.");
        }
    } catch (error) {
        console.error("\n💥 Test failed with error:");
        console.error(error);
    }
}

test();
