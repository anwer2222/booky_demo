/** Static export: the demo has no server, so it can be hosted on any static host. */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
