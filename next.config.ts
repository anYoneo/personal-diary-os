import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /**
   * Pin the tracing root to this project.
   *
   * Without it Next/Turbopack walks up from here looking for a workspace root.
   * On the VPS an earlier deploy extracted the tarball into /root (the archive
   * has no top-level folder), which left a stray package.json + src/ there, so
   * the toolchain decided the root was /root — and then resolved PostCSS
   * plugins against /root/node_modules, which does not exist. The build failed
   * with "Cannot find module '@tailwindcss/postcss'" while the package was
   * installed correctly in this very directory.
   *
   * A silent, confusing failure: build the project that is here, nothing above.
   */
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
