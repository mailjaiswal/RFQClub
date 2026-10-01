import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import SplashScreen from "@/components/SplashScreen";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", weight: ["400", "500", "600"] });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", weight: ["400", "500", "600", "700", "800"] });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "RFQClub — the total-landed-cost RFQ exchange",
  description:
    "Buyers post machining, foundry and fabrication requirements. Suppliers bid on total landed cost. Bids stay blinded until you award.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${fraunces.variable} ${hanken.variable} ${jetbrains.variable} font-body`}>
        <Providers>
          {children}
          <SplashScreen />
        </Providers>
      </body>
    </html>
  );
}
