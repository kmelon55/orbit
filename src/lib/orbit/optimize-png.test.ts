import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { optimizePng } from "./optimize-png.server";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, data: Buffer) {
	const result = Buffer.alloc(data.length + 12);
	result.writeUInt32BE(data.length);
	result.write(type, 4, "ascii");
	data.copy(result, 8);
	result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
	return result;
}
function split(png: Buffer) {
	const chunks: { type: string; data: Buffer; raw: Buffer }[] = [];
	for (let offset = 8; offset < png.length; ) {
		const end = offset + 12 + png.readUInt32BE(offset);
		assert.equal(
			png.readUInt32BE(end - 4),
			crc32(png.subarray(offset + 4, end - 4)),
		);
		chunks.push({
			type: png.toString("ascii", offset + 4, offset + 8),
			data: png.subarray(offset + 8, end - 4),
			raw: png.subarray(offset, end),
		});
		offset = end;
	}
	return chunks;
}
function fixture(animated = false) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(128);
	header.writeUInt32BE(128, 4);
	header[8] = 16;
	header[9] = 6;
	// Full 16-bit RGBA scanlines, including transparent pixels and nontrivial samples.
	const pixels = Buffer.alloc(128 * (128 * 8 + 1));
	for (let row = 0; row < 128; row++)
		for (let x = 0; x < 128 * 8; x++)
			pixels[row * (128 * 8 + 1) + 1 + x] = x % 251;
	const compressed = deflateSync(pixels, { level: 0 });
	const middle = Math.floor(compressed.length / 2);
	const gamma = Buffer.alloc(4);
	gamma.writeUInt32BE(45455);
	const png = Buffer.concat([
		signature,
		chunk("IHDR", header),
		chunk("gAMA", gamma),
		chunk("tEXt", Buffer.from("Title\0keep metadata")),
		...(animated ? [chunk("acTL", Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]))] : []),
		chunk("IDAT", compressed.subarray(0, middle)),
		chunk("IDAT", compressed.subarray(middle)),
		chunk("IEND", Buffer.alloc(0)),
	]);
	return { png, pixels };
}

test("PNG becomes smaller while exact 16-bit RGBA scanlines and metadata survive", async () => {
	const { png, pixels } = fixture();
	const result = await optimizePng(png);
	assert.ok(result.length < png.length / 2);
	const chunks = split(result);
	assert.deepEqual(
		inflateSync(
			Buffer.concat(
				chunks.filter((part) => part.type === "IDAT").map((part) => part.data),
			),
		),
		pixels,
	);
	assert.deepEqual(
		chunks.filter((part) => part.type !== "IDAT"),
		split(png).filter((part) => part.type !== "IDAT"),
	);
	assert.deepEqual(await optimizePng(result), result);
});

test("animation, malformed data and non-PNG formats are retained byte for byte", async () => {
	const { png } = fixture(true);
	const broken = fixture().png;
	broken[broken.length - 1] ^= 1;
	for (const input of [
		png,
		broken,
		Buffer.from([255, 216, 255, 224, 0, 1]),
		Buffer.from("GIF89a"),
	])
		assert.deepEqual(await optimizePng(input), input);
});
