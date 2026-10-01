import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Automatyczny Grafik",
  description: "Automatyczny grafik zmian zgodny z polskim prawem pracy",
};

const NAV_ITEMS = [
  { href: "/schedules", label: "Grafiki" },
  { href: "/employees", label: "Pracownicy" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-lg font-bold text-blue-600">
              Automatyczny Grafik
            </Link>
            <div className="flex gap-4">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </body>
    </html>
  );
}
