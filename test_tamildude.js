/**
 * TamilDude Provider Test
 *
 * Usage:
 *   node test_tamildude.js [tmdbId] [mediaType]
 *
 * Example:
 *   node test_tamildude.js 1506833 movie   (Magudam, 2026)
 */

const { getStreams } = require('./src/providers/tamildude.js');

async function test() {
    console.log("Starting TamilDude test...");
    const tmdbId = process.argv[2] || '1506833';
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
