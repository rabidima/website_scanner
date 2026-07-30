import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StackScan — What's this site built with?",
  description:
    "Paste any URL and see its visible technology stack: CMS, frameworks, analytics, hosting, and more.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
