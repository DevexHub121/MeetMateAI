import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root — there are stray lockfiles in parent dirs and Next
  // would otherwise infer the wrong root for output-file tracing.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // The "Save recording" server action accepts audio uploads. The default cap
    // is 1MB, which rejects anything but a few seconds of audio with a 500.
    // Raise it to comfortably fit long meeting recordings.
    serverActions: {
      bodySizeLimit: "100mb",
    },
    // Next.js also applies a separate client/middleware request cap before
    // the server action is reached. Keep it aligned with serverActions so
    // large local recording uploads are not truncated at the default 10 MB.
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
