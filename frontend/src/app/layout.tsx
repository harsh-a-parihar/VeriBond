import type { Metadata } from "next";
import { JetBrains_Mono, Inter } from 'next/font/google';
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: "VeriBond - AI Agent Accountability",
  description: "Making AI agents economically accountable through on-chain staking",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body
        className="bg-zinc-950 text-zinc-100 antialiased selection:bg-zinc-800 selection:text-white"
      >
        <Web3Provider>
          {children}
        </Web3Provider>
      </body>

    </html>
  );
}







