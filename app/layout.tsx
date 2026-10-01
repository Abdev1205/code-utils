import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { ModeToggle } from "@/components/mode-toggle";
import { PaletteHint } from "@/components/palette-hint";
import { ThemeProvider } from "@/components/theme-provider";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getMode } from "@/lib/mode";
import { understandSubnav } from "@/lib/understand/subnav";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "utils",
  description: "Local toolbox — Claude session browser and friends",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The index is cached on file mtimes, so this is cheap on every navigation.
  // Both read the mode cookie: the sub-navigation counts only what is visible.
  const [mode, understand] = await Promise.all([getMode(), understandSubnav()]);
  const subnav = { understand };
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider>
          {/* SidebarMenuButton renders a Tooltip when the sidebar is collapsed
              to icons, and those parts need this provider above them. */}
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar subnav={subnav} />
              <SidebarInset className="min-w-0">
                <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
                  <SidebarTrigger className="-ml-1" />
                  <div className="ml-auto flex items-center gap-2">
                    <ModeToggle mode={mode} />
                    <PaletteHint />
                  </div>
                </header>
                <div className="min-w-0 flex-1">{children}</div>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
          <CommandPalette />
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
