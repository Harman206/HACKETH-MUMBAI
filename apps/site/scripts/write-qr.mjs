// dist/qr.svg: a QR code of the public site URL (apps/site/site.json), made at build time. No runtime library, no request.
import { readFileSync, writeFileSync } from 'node:fs';
import QR from 'qrcode';

const { url } = JSON.parse(readFileSync(new URL('../site.json', import.meta.url), 'utf8'));
const svg = await QR.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
writeFileSync(new URL('../dist/qr.svg', import.meta.url), svg);
console.log(`qr.svg → ${url}`);
