// Flat config (ESLint 9) — pragmatic solo-maintainer setup.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "assets/**", "coverage/**", "scripts/**", "examples/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase deliberately narrows unknown API payloads at the edges.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
