import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPng(width, height, getPixel) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth: 8
  ihdr.writeUInt8(6, 9); // color type: 6 (RGBA)
  ihdr.writeUInt8(0, 10); // compression method
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace method

  function chunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4);
    data.copy(buf, 8);

    // CRC32
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + len; i++) {
      let byte = buf[i];
      for (let j = 0; j < 8; j++) {
        if ((crc ^ byte) & 1) {
          crc = (crc >>> 1) ^ 0xedb88320;
        } else {
          crc = crc >>> 1;
        }
        byte = byte >>> 1;
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  const ihdrChunk = chunk('IHDR', ihdr);

  // Raw image data with filter byte 0 at each scanline
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = chunk('IDAT', compressedData);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate Hema Gold icon: rounded gold badge with white letter 'H' and Indian Rupee / coin motif
function drawHemaBadge(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = w * 0.44;
  const cornerR = w * 0.22;

  // Background rounded rectangle
  const nx = Math.abs(x - cx);
  const ny = Math.abs(y - cy);
  const innerW = cx - cornerR;
  const innerH = cy - cornerR;

  let inBadge = false;
  if (nx <= innerW && ny <= cy * 0.92) inBadge = true;
  else if (ny <= innerH && nx <= cx * 0.92) inBadge = true;
  else {
    const dx = nx - innerW;
    const dy = ny - innerH;
    if (dx > 0 && dy > 0 && dx * dx + dy * dy <= cornerR * cornerR) {
      inBadge = true;
    }
  }

  if (!inBadge) {
    return [0, 0, 0, 0]; // Transparent background
  }

  // Gold gradient from #f59e0b to #b45309
  const grad = y / h;
  const rBg = Math.round(245 * (1 - grad * 0.3));
  const gBg = Math.round(158 * (1 - grad * 0.35));
  const bBg = Math.round(11 * (1 - grad * 0.2));

  // Draw Letter 'H' in the center
  // Left pillar, right pillar, center bar
  const pillW = w * 0.12;
  const hW = w * 0.44;
  const hH = h * 0.48;
  const leftX = cx - hW / 2;
  const rightX = cx + hW / 2 - pillW;
  const topY = cy - hH / 2;
  const botY = cy + hH / 2;
  const barY1 = cy - pillW * 0.7;
  const barY2 = cy + pillW * 0.7;

  const isLeftPillar = x >= leftX && x <= leftX + pillW && y >= topY && y <= botY;
  const isRightPillar = x >= rightX && x <= rightX + pillW && y >= topY && y <= botY;
  const isCrossBar = x >= leftX && x <= rightX + pillW && y >= barY1 && y <= barY2;

  if (isLeftPillar || isRightPillar || isCrossBar) {
    return [255, 255, 255, 255]; // Pure White Letter H
  }

  // Subtle border / inner highlight
  const distFromCenter = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
  if (distFromCenter > radius * 0.95 && distFromCenter < radius) {
    return [254, 243, 199, 230]; // Soft gold rim
  }

  return [rBg, gBg, bBg, 255];
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Generate 192x192
const png192 = createPng(192, 192, drawHemaBadge);
fs.writeFileSync(path.join(publicDir, 'hema-icon-192.png'), png192);
console.log('Generated hema-icon-192.png');

// Generate 512x512
const png512 = createPng(512, 512, drawHemaBadge);
fs.writeFileSync(path.join(publicDir, 'hema-icon-512.png'), png512);
console.log('Generated hema-icon-512.png');

// Also write SVG for crystal-clear vector favicon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="50%" stop-color="#d97706" />
      <stop offset="100%" stop-color="#92400e" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="110" fill="url(#goldGrad)" filter="url(#shadow)"/>
  <rect x="48" y="48" width="416" height="416" rx="96" fill="none" stroke="#fef3c7" stroke-width="4" stroke-opacity="0.4"/>
  <g fill="#ffffff">
    <rect x="144" y="140" width="56" height="232" rx="12"/>
    <rect x="312" y="140" width="56" height="232" rx="12"/>
    <rect x="144" y="230" width="224" height="52" rx="8"/>
  </g>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svgContent);
fs.writeFileSync(path.join(publicDir, 'hema-icon.svg'), svgContent);
console.log('Generated SVG icons');
