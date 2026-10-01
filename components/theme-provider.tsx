"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    // Dark by default; the toggle is an explicit light/dark switch, so system
    // preference is deliberately not consulted.
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
