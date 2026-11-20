import type { MetadataRoute } from "next";

/** Web App Manifest: makes the app installable on phones and computers. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Petra Field Operations",
    short_name: "Petra Field Ops",
    description: "Field operations for Petra Industrial Flooring crews and office.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f5",
    theme_color: "#173f73",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
