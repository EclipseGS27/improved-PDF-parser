/**
 * The pixels of one picture on a PDF page, with its transparency, from pdf.js. No Foundry code here.
 * pdf.js hands pictures over as RGBA, RGB or 1-bit data, or (in browsers) as an ImageBitmap.
 */

/**
 * @param {object} page a pdf.js page whose operator list has been read (getOperatorList)
 * @param {string} name the picture's name in the page
 * @returns {Promise<{width:number, height:number, rgba?:Uint8ClampedArray, bitmap?:ImageBitmap}|null>}
 */
/**
 * The name of the nth picture painted on a page, on this document instance (read the operator list first)
 * @param {object} ops the page's operator list
 * @param {object} OPS pdf.js operator codes
 */
export function nthPicture(ops, OPS, index) {
	let n = 0;
	for (let i = 0; i < ops.fnArray.length; i++) {
		const fn = ops.fnArray[i];
		if ((fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) && typeof ops.argsArray[i][0] === 'string') {
			if (n === index) return ops.argsArray[i][0];
			n++;
		}
	}
	return null;
}

export async function picturePixels(page, name) {
	// the page's operator list must have been read on this document instance (a page that was cleaned up has
	// let its pictures go); give up after a while rather than hang on one that never arrives
	const obj = await new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), 15000);
		const done = (o) => {
			clearTimeout(timer);
			resolve(o ?? null);
		};
		const store = page.objs.has(name) ? page.objs : page.commonObjs.has(name) ? page.commonObjs : page.objs;
		try {
			store.get(name, done);
		} catch {
			done(null);
		}
	});
	if (!obj || !obj.width || !obj.height) return null;
	const { width, height } = obj;
	if (obj.bitmap) return { width, height, bitmap: obj.bitmap };
	const src = obj.data;
	if (!src) return null;
	const n = width * height;
	const rgba = new Uint8ClampedArray(n * 4);
	if (obj.kind === 3 || src.length === n * 4) rgba.set(src.subarray ? src.subarray(0, n * 4) : src.slice(0, n * 4));
	else if (obj.kind === 2 || src.length === n * 3) {
		for (let i = 0, j = 0; i < n; i++, j += 3) {
			rgba[i * 4] = src[j];
			rgba[i * 4 + 1] = src[j + 1];
			rgba[i * 4 + 2] = src[j + 2];
			rgba[i * 4 + 3] = 255;
		}
	} else {
		// 1 bit per pixel, rows padded to whole bytes
		const row = Math.ceil(width / 8);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const on = (src[y * row + (x >> 3)] >> (7 - (x & 7))) & 1;
				const k = (y * width + x) * 4;
				rgba[k] = rgba[k + 1] = rgba[k + 2] = on ? 255 : 0;
				rgba[k + 3] = 255;
			}
	}
	return { width, height, rgba };
}

/** How much of a picture is see-through (0 to 1): art cut out on a transparent background scores high */
export function transparency(px) {
	if (!px?.rgba) return 0;
	let clear = 0;
	const a = px.rgba;
	const step = Math.max(4, Math.floor(a.length / 4 / 20000)) * 4;
	let n = 0;
	for (let i = 3; i < a.length; i += step) {
		n++;
		if (a[i] < 16) clear++;
	}
	return n ? clear / n : 0;
}
