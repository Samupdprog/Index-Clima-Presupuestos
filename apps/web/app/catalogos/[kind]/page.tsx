import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogPage } from "../../../components/catalogs/catalog-page";

const kinds = ["materiales", "empleados", "desplazamientos", "proveedores", "textos"] as const;
export const metadata: Metadata = { title: "Catálogo" };
export function generateStaticParams() { return kinds.map((kind) => ({ kind })); }
export default async function Page({ params }: { params: Promise<{ kind: string }> }) { const { kind } = await params; if (!kinds.includes(kind as typeof kinds[number])) notFound(); return <CatalogPage kind={kind as typeof kinds[number]} />; }
