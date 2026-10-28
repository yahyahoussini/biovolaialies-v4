import type { MetadataRoute } from "next";

/** Installs the field app (document 3, ch. 05) on a phone's home screen; it opens on /terrain, offline too. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BIOVOLAILLES — Terrain",
    short_name: "BV Terrain",
    description: "Saisie terrain, avec ou sans réseau : mortalité, pesée, aliment, eau, santé, réceptions et lecture des codes.",
    start_url: "/terrain",
    scope: "/terrain",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f7f3",
    theme_color: "#12372a",
    lang: "fr",
    icons: [
      { src: "/icons/terrain-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/terrain-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/terrain-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
