"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Tooltip } from "radix-ui";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  FileText,
  Menu,
  Moon,
  Package,
  Settings,
  Sun,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RippleButton } from "./animate-ui/ripple-button";

const nav = [
  { href: "/presupuestos", label: "Presupuestos", icon: ClipboardList },
  { href: "/clientes", label: "Clientes", icon: Users },
  { section: "Catálogos" },
  { href: "/catalogos/materiales", label: "Materiales", icon: Package },
  { href: "/catalogos/empleados", label: "Empleados", icon: BriefcaseBusiness },
  { href: "/catalogos/desplazamientos", label: "Desplazamientos", icon: Truck },
  { href: "/catalogos/proveedores", label: "Proveedores", icon: Building2 },
  { href: "/catalogos/textos", label: "Textos", icon: FileText },
  { section: "Sistema" },
  { href: "/configuracion", label: "Configuración", icon: Settings },
] as const;

function currentContext(pathname: string) {
  if (pathname.startsWith("/presupuestos/")) return { group: "Presupuestos", page: "Editor" };
  const item = nav.find((entry) => "href" in entry && pathname.startsWith(entry.href));
  return { group: "Index Clima", page: item && "label" in item ? item.label : "Presupuestos" };
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const reduceMotion = useReducedMotion();
  const context = useMemo(() => currentContext(pathname), [pathname]);

  useEffect(() => setMounted(true), []);
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    const saved = window.localStorage.getItem("index-clima-sidebar");
    if (saved === "collapsed") setCollapsed(true);
  }, []);

  function toggleSidebar() {
    setCollapsed((value) => {
      window.localStorage.setItem("index-clima-sidebar", value ? "expanded" : "collapsed");
      return !value;
    });
  }

  return (
    <Tooltip.Provider delayDuration={250}>
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <div className="app-shell" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
        <aside className="sidebar" aria-label="Navegación principal">
          <div className="brand">
            <div className="brand-mark"><Boxes size={20} /></div>
            <div className="brand-copy"><strong>Index Clima</strong><span>Presupuestos</span></div>
            <button className="button button-ghost button-icon sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? "Expandir navegación" : "Contraer navegación"}>
              {collapsed ? <ArrowRightToLine /> : <ArrowLeftToLine />}
            </button>
          </div>
          <nav className="sidebar-nav">
            {nav.map((item, index) => {
              if ("section" in item) return <div className="nav-label" key={`${item.section}-${index}`}>{item.section}</div>;
              const active = item.href === "/presupuestos" ? pathname.startsWith("/presupuestos") : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Tooltip.Root key={item.href}>
                  <Tooltip.Trigger asChild>
                    <Link className="nav-item" data-active={active} href={item.href} aria-current={active ? "page" : undefined}>
                      <Icon /><span className="nav-text">{item.label}</span>
                    </Link>
                  </Tooltip.Trigger>
                  {collapsed ? <Tooltip.Portal><Tooltip.Content className="tooltip-content" side="right" sideOffset={8}>{item.label}</Tooltip.Content></Tooltip.Portal> : null}
                </Tooltip.Root>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <Link className="nav-item" href="/configuracion">
              <Settings /><span className="nav-text">Preferencias</span>
            </Link>
          </div>
        </aside>
        <AnimatePresence>
          {mobileOpen ? (
            <motion.button
              className="mobile-overlay"
              aria-label="Cerrar navegación"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : .18 }}
              onClick={() => setMobileOpen(false)}
            />
          ) : null}
        </AnimatePresence>
        <div className="main-column">
          <header className="topbar">
            <RippleButton variant="ghost" size="icon" className="mobile-nav-button" onClick={() => setMobileOpen((value) => !value)} aria-label="Abrir navegación">
              {mobileOpen ? <X /> : <Menu />}
            </RippleButton>
            <div className="topbar-context"><p>{context.group}</p><strong>{context.page}</strong></div>
            <div className="topbar-actions">
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <RippleButton
                    variant="ghost"
                    size="icon"
                    aria-label={mounted ? (resolvedTheme === "dark" ? "Usar tema claro" : "Usar tema oscuro") : "Cambiar tema"}
                    onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  >
                    {mounted && resolvedTheme === "dark" ? <Sun /> : <Moon />}
                  </RippleButton>
                </Tooltip.Trigger>
                <Tooltip.Portal><Tooltip.Content className="tooltip-content" sideOffset={7}>Cambiar tema</Tooltip.Content></Tooltip.Portal>
              </Tooltip.Root>
            </div>
          </header>
          <main id="main-content">{children}</main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
