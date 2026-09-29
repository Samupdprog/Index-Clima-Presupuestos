import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { ThemeProvider } from "../components/theme-provider";
import "./globals.css";
import "./closure.css";

export const metadata = {
  title: {
    default: "Index Clima · Presupuestos",
    template: "%s · Index Clima",
  },
  description: "Presupuestos profesionales para Index Clima",
  applicationName: "Index Clima · Presupuestos",
  appleWebApp: { capable: true, title: "Presupuestos", statusBarStyle: "default" as const },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#111718" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
