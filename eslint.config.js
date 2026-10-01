import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default [
  { ignores: ['dist/**', 'android/**', 'node_modules/**', 'coverage/**', 'dev.'.concat('*')] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.ts', '**/*.svelte', '**/*.svelte.js', '**/*.svelte.ts'],
    rules: {
      // TypeScript already reports undefined identifiers, and the JS rule has no
      // knowledge of DOM globals (document, Image, KeyboardEvent, setInterval…).
      'no-undef': 'off',
    },
  },
  {
    // Svelte components *and* rune-bearing `.svelte.ts` modules: the Svelte
    // parser must delegate the script body to the TypeScript parser, otherwise
    // type syntax in `.svelte.ts` reads as a parse error.
    files: ['**/*.svelte', '**/*.svelte.js', '**/*.svelte.ts'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
    rules: {
      // Svelte 5 runes are unrecognised by the core no-unused-vars rule.
      'no-unused-vars': 'off',
      'svelte/no-at-html-tags': 'warn',
      'svelte/require-each-key': 'warn',
      // Plain Map/Set are used deliberately for private, *non-reactive* state:
      // in-flight request de-duplication, object-URL bookkeeping, cancellation
      // tokens. Proxying those would add overhead and break identity checks.
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // `consistent-type-imports` is deliberately not enabled: this project sets
      // `verbatimModuleSyntax`, so TypeScript already errors on a value import
      // used only as a type — and the rule needs type information, which the
      // svelte-eslint-parser used for `.svelte.ts` files cannot provide.
    },
  },
  {
    files: ['tests/**/*.ts', '*.config.ts', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
