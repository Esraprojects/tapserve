import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "var(--font-ethiopic)", "system-ui", "sans-serif"],
      },
      colors: {
        brand: { 50: "#eef7f4", 100: "#d5ece4", 500: "#1f8a6b", 600: "#18735a", 700: "#135c48" },
      },
    },
  },
  plugins: [],
} satisfies Config;
