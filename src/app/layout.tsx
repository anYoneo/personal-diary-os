import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/theme";
import { CommandPalette } from "@/components/command-palette";
import { getCurrentUser } from "@/lib/auth";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
// Serif is reserved for entry headings and quotes — it's what makes the app read
// like a journal page instead of a dashboard.
const newsreader = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Diary",
  description: "A private journal that remembers.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  // Palette commands are built from what actually exists — no dead entries.
  const commands = user
    ? [
        { id: "write", label: "Write today's entry", hint: "N", href: "/write" },
        { id: "today", label: "Go to today", hint: "", href: "/" },
        { id: "timeline", label: "Jump to timeline", hint: "", href: "/timeline" },
        { id: "search", label: "Search memories", hint: "S", href: "/search" },
        { id: "threads", label: "Life threads", hint: "", href: "/threads" },
        { id: "thoughts", label: "Unresolved thoughts", hint: "", href: "/thoughts" },
        { id: "goals", label: "Goals", hint: "", href: "/goals" },
        { id: "memories", label: "Random memory", hint: "", href: "/memories" },
        { id: "insights", label: "Insights", hint: "", href: "/insights" },
        { id: "settings", label: "Settings", hint: "", href: "/settings" },
      ]
    : [];

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <CommandPalette commands={commands} />
        {children}
      </body>
    </html>
  );
}
