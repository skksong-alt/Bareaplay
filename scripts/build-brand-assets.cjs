// Derive small web assets from the APPROVED final artwork, without retouching it.
// Run with the bundled Node runtime (sharp available via NODE_PATH).
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const sharp = require('sharp');
const assets = path.resolve(__dirname, '../assets');
const source = path.join(assets, 'barea-crest-concept.png');
const approvedHash = 'f171738a48dcba77d2a4607b1729ef503ded1f1e2bb726c9a5d96fdb64f7703c';
async function main() {
    const buffer = readFileSync(source);
    if (createHash('sha256').update(buffer).digest('hex') !== approvedHash)
        throw new Error('Source is not the approved final logo. Do not use an earlier damaged draft.');
    for (const size of [64, 96, 192, 512]) {
        const output = path.join(assets, `barea-crest-${size}.png`);
        await sharp(buffer).resize(size, size).png({ compressionLevel: 9 }).toFile(output);
        const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let i = 0; i < data.length; i += info.channels) {
            if (data[i + 3] !== 255 || Math.max(data[i], data[i + 1], data[i + 2]) < 35)
                throw new Error(`Unexpected transparency/black area in ${size}px asset.`);
        }
        console.log(`${size}px: verified opaque artwork, no black pixels.`);
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
