import type { Config } from "tailwindcss";

// Design tokens ported verbatim from design-concepts.html
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        ink: "var(--ink)",
        subtle: "var(--subtle)",
        muted: "var(--muted)",
        hairline: "var(--hairline)",
        primary: "#3F4397",
        oxide: "#2E7D46",
        saffron: "#EF7A2B",
        whatsapp: "#25D366",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        body: ["var(--font-hanken)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      fontSize: {
        base13: "13px",
      },
    },
  },
  plugins: [],
};

export default config;
