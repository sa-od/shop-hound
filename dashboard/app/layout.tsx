import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { getStatus } from "@/lib/server/status";
import { TopBar } from "./components/TopBar";
import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const barlowCondensed = Barlow_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin"], weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "Growth Briefs — Competitive Intelligence",
  description: "Weekly competitor price and catalog changes for Shopify merchants, with what to do about them.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const status = await getStatus();
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <TopBar status={status} />
        {children}
      </body>
    </html>
  );
}
