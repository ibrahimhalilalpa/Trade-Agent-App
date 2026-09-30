import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./research.css";
import "./visual-enhancements.css";
import GlobalNavigation from "@/components/GlobalNavigation";
import AppProviders from "@/components/AppProviders";
import NextTopLoader from "nextjs-toploader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trade Agent / BİST Araştırma Terminali",
  description: "Borsa İstanbul hisselerini izleme, araştırma listeleri, şirket verileri ve uygulamalı eğitim platformu.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><AppProviders><NextTopLoader color="#34d399" height={2} showSpinner={false} shadow="0 0 10px #34d399" /><GlobalNavigation />{children}</AppProviders></body>
    </html>
  );
}
