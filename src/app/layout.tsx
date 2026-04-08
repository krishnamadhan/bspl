import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Rajdhani, Inter } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BSPL — Banter Squad Premier League",
  description: "Fantasy cricket tournament with real IPL stats, stamina, and strategy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geist.variable} ${rajdhani.variable} ${inter.variable} bg-[#0B0E14] text-[#F0F4FF] min-h-screen antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
