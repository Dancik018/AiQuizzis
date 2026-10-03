import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@napi-rs/canvas', 'tesseract.js', 'tesseract.js-core', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/scan': [
      './public/ocr/lang/*.gz',
      './node_modules/tesseract.js/src/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/pdfjs-dist/legacy/build/*',
      './node_modules/pdfjs-dist/standard_fonts/*',
      './node_modules/pdfjs-dist/cmaps/*',
      './node_modules/pdfjs-dist/wasm/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
