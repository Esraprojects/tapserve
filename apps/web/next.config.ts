import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@tapserve/core", "@tapserve/db", "@tapserve/ethiopian-calendar", "@tapserve/i18n"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
