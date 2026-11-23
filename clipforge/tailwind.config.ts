import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0b",
        surface: "#111113",
        card: "#17171a",
        border: "#26262b",
        muted: "#8b8b94",
        accent: { DEFAULT: "#7c5cff", soft: "#a592ff" },
      },
      borderRadius: { xl: "14px", "2xl": "20px" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
