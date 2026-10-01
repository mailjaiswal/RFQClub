import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "RFQClub — from a voice note to a normalised quote",
  description:
    "RFQClub is the request-for-quote exchange for Indian manufacturing SMEs. Post a requirement on WhatsApp, voice or PDF — we structure it, route it to ≤5 verified suppliers, and compare their quotes on total landed cost.",
};

export default function LandingPage() {
  return <Landing />;
}
