/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.googleusercontent.com' }, { protocol: 'https', hostname: 'places.googleapis.com' }] },
};
