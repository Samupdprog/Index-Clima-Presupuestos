import type { MetadataRoute } from "next";

/** Permite añadir la aplicación a la pantalla de inicio del móvil con el icono de Index Clima. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Index Clima · Presupuestos",
    short_name: "Presupuestos",
    description: "Presupuestos profesionales para Index Clima",
    start_url: "/presupuestos",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#0b6b5f",
    lang: "es",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
