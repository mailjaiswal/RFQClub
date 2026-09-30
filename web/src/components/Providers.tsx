"use client";
import { ThemeProvider } from "next-themes";
import { CommandProvider } from "@/components/CommandPalette";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <CommandProvider>{children}</CommandProvider>
    </ThemeProvider>
  );
}
