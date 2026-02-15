// Generate PNG icons from SVG using node canvas
import { writeFileSync } from 'fs';

// Create a simple gradient background with paw emoji as SVG
function createIconSvg(size) {
  const r = Math.round(size * 0.18);
  const fontSize = Math.round(size * 0.5);
  const textY = Math.round(size * 0.62);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e40af"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <circle cx="${size*0.35}" cy="${size*0.28}" r="${size*0.07}" fill="#3b82f6" opacity="0.8"/>
  <circle cx="${size*0.65}" cy="${size*0.28}" r="${size*0.07}" fill="#3b82f6" opacity="0.8"/>
  <circle cx="${size*0.22}" cy="${size*0.42}" r="${size*0.06}" fill="#3b82f6" opacity="0.6"/>
  <circle cx="${size*0.78}" cy="${size*0.42}" r="${size*0.06}" fill="#3b82f6" opacity="0.6"/>
  <ellipse cx="${size*0.5}" cy="${size*0.55}" rx="${size*0.15}" ry="${size*0.12}" fill="#3b82f6" opacity="0.9"/>
  <text x="${size*0.5}" y="${size*0.85}" text-anchor="middle" font-size="${size*0.12}" font-family="Arial, sans-serif" fill="#94a3b8" font-weight="bold">OC</text>
</svg>`;
}

// Write as SVG files (Next.js will serve them)
writeFileSync('public/icon-192.svg', createIconSvg(192));
writeFileSync('public/icon-512.svg', createIconSvg(512));
writeFileSync('public/apple-touch-icon.svg', createIconSvg(180));

console.log('SVG icons generated!');
