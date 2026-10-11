import next from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
const config = [
  ...next, ...typescript, prettier,
  { ignores: [".next/**", "node_modules/**", "out/**", "build/**", "next-env.d.ts", "archive/**", "coverage/**", "playwright-report/**", "test-results/**"] },
  { files: ["**/*.ts", "**/*.tsx"], rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    // Preserve the existing hooks checks; compiler diagnostics are a separate migration.
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    "@typescript-eslint/no-require-imports": "off",
    "react-hooks/set-state-in-effect": "off", "react-hooks/refs": "off",
    "react-hooks/purity": "off", "react-hooks/immutability": "off",
    "react-hooks/preserve-manual-memoization": "off",
  } },
];

export default config;
