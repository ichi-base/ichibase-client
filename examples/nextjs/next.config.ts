import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The SDK ships pre-built ESM/CJS in dist/, so no transpilePackages is needed
  // — Next resolves `@ichibase/client` and `@ichibase/client/ssr` via its
  // package exports map (workspace-linked to the local build).
};

export default nextConfig;
