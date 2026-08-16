/**
 * Isaimini (isaiminihits.com) Provider Test
 *
 * Usage:
 *   node test_isaiminihits.js [tmdbId] [mediaType]
 *
 * Example:
 *   node test_isaiminihits.js 937020 movie   (Jailer)
 */

const { getStreams } = require('./src/providers/isaiminihits.js');

async function test() {
    console.log("Starting Isaimini test...");
    const tmdbId = process.argv[2] || '937020';
    const mediaType = process.argv[3] || 'movie';

    console.log(`TMDB ID: ${tmdbId} (Type: ${mediaType})`);

    try {
        const streams = await getStreams(tmdbId, mediaType);
        console.log("\n--- Results ---");
        if (streams && streams.length > 0) {
            streams.forEach((stream, index) => {
                console.log(`\nStream ${index + 1}:`);
                console.log(`Title: ${stream.title}`);
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
