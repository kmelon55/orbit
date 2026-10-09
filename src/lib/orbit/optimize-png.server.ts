import { promisify } from "node:util";
import { crc32, deflate, inflate } from "node:zlib";

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Recompress only the lossless IDAT stream; retain every pixel, filter and metadata chunk. */
export async function optimizePng(original: Buffer): Promise<Buffer> {
	if (!original.subarray(0, 8).equals(signature)) return original;
	try {
		const chunks: { type: string; raw: Buffer; data: Buffer }[] = [];
		let offset = 8;
		while (offset + 12 <= original.length) {
			const length = original.readUInt32BE(offset);
			const end = offset + 12 + length;
			if (end > original.length) return original;
			const type = original.toString("ascii", offset + 4, offset + 8);
			if (
				crc32(original.subarray(offset + 4, end - 4)) !==
				original.readUInt32BE(end - 4)
			)
				return original;
			// Leave animation and unknown critical extensions unchanged.
			if (
				type === "acTL" ||
				(/^[A-Z]/.test(type) &&
					!["IHDR", "PLTE", "IDAT", "IEND"].includes(type))
			)
				return original;
			chunks.push({
				type,
				raw: original.subarray(offset, end),
				data: original.subarray(offset + 8, end - 4),
			});
			offset = end;
			if (type === "IEND") break;
		}
		if (
			offset !== original.length ||
			chunks[0]?.type !== "IHDR" ||
			chunks.at(-1)?.type !== "IEND"
		)
			return original;
		const first = chunks.findIndex((chunk) => chunk.type === "IDAT");
		const last = chunks.map((chunk) => chunk.type).lastIndexOf("IDAT");
		if (
			first < 0 ||
			chunks.slice(first, last + 1).some((chunk) => chunk.type !== "IDAT")
		)
			return original;
		const compressed = Buffer.concat(
			chunks.slice(first, last + 1).map((chunk) => chunk.data),
		);
		// Bound decompression memory; oversized or malformed inputs keep their original bytes.
		const scanlines = await inflateAsync(compressed, {
			maxOutputLength: 64 * 1024 * 1024,
		});
		const smaller = await deflateAsync(scanlines, { level: 9 });
		const idat = Buffer.alloc(smaller.length + 12);
		idat.writeUInt32BE(smaller.length, 0);
		idat.write("IDAT", 4, "ascii");
		smaller.copy(idat, 8);
		idat.writeUInt32BE(crc32(idat.subarray(4, -4)), idat.length - 4);
		const output = Buffer.concat([
			signature,
			...chunks.slice(0, first).map((chunk) => chunk.raw),
			idat,
			...chunks.slice(last + 1).map((chunk) => chunk.raw),
		]);
		return output.length < original.length ? output : original;
	} catch {
		return original;
	}
}
