import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Sans,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";

// Typography: Bricolage Grotesque for display, Instrument Sans for body,
// JetBrains Mono for labels/code.
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Notti — AI notes for every meeting",
  description: "Notti records, transcribes, and summarizes every meeting — so your team never takes notes again.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${instrument.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full text-[var(--color-text-primary)]">
        {children}
      </body>
    </html>
  );
}
