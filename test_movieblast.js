/**
 * MovieBlast Provider Test
 *
 * Usage:
 *   node test_movieblast.js [tmdbId] [mediaType] [season] [episode]
 *
 * Example:
 *   node test_movieblast.js 19995 movie   (Avatar)
 */

const { getStreams } = require('./src/providers/movieblast.js');

async function test() {
    console.log("Starting MovieBlast test...");
    const tmdbId = process.argv[2] || '19995';
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
                console.log(`Title: ${stream.title || stream.name}`);
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
