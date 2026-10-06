import ConsoleApp from "@/components/console/ConsoleApp";

// The console route group is fully client-gated (see ConsoleApp); force dynamic
// so the server never caches a snapshot of one rep's session for another.
export const dynamic = "force-dynamic";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleApp>{children}</ConsoleApp>;
}
