import type { Metadata } from "next";
import { Inter, Saira, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Login / change-password use these (the approved design's fonts — NOT Inter).
const saira = Saira({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-saira",
  display: "swap",
});

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Udyogi HRMS",
  description: "Life is Precious — Multi-entity HR & Payroll Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${saira.variable} ${plex.variable} h-full`}
    >
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
