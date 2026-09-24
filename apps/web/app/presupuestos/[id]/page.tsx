import type { Metadata } from "next";
import { QuoteEditor } from "../../../components/quotes/quote-editor";

export const metadata: Metadata = { title: "Editor de presupuesto" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteEditor quoteId={id} />;
}
