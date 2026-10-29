import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tapserve",
    short_name: "Tapserve",
    description: "Hotel and restaurant management",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#18735a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
