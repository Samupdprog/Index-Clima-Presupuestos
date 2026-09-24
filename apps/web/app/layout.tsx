import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { ThemeProvider } from "../components/theme-provider";
import "./globals.css";

export const metadata = {
  title: {
    default: "Index Clima · Presupuestos",
    template: "%s · Index Clima",
  },
  description: "Presupuestos profesionales para Index Clima",
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
