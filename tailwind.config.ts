import type { Config } from "tailwindcss";

// The design is themed with CSS custom properties (see app/globals.css) and inline
// styles ported 1:1 from the Claude Design prototype to stay pixel-accurate. Tailwind
// is available for incidental utility use; theme tokens are exposed here for convenience.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        text: "var(--text)",
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        accent: "var(--accent)",
      },
    },
  },
  plugins: [],
};

export default config;
