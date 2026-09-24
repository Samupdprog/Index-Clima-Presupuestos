import type { Metadata } from "next";
import { QuotesPage } from "../../components/quotes/quotes-page";

export const metadata: Metadata = { title: "Presupuestos" };

export default function Page() {
  return <QuotesPage />;
}
