import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['**/dist/**', '.claude/**', '.ocrperf/**', '.perfprobe/**']),
  {
    // `.mjs` is in the glob because it was not, and that left every file under
    // `scripts/` — the two benchmarks CI gates each PR on included — with
    // literally zero rules applied. `eslint .` walked them and `--print-config`
    // returned an empty `rules` block. An unused import sat in
    // `scaleBenchmark.mjs` undetected because of it.
    files: ['**/*.{js,jsx,mjs}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // `%TypedArray%.from(x, fn)` walks the iterator protocol and dispatches
      // the mapper per element — ~92 ns/px against a plain loop's ~4 ns/px.
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name='from'][arguments.length>=2]"
          + "[callee.object.name=/^(Uint8|Uint8Clamped|Int8|Uint16|Int16|Uint32|Int32|Float32|Float64)Array$/]",
        message: 'TypedArray.from with a mapper is ~20x slower than a plain loop over a preallocated array.',
      }],
    },
  },
  // The Node harnesses. They run under `node`, not in a browser, so they get
  // Node's globals — `process`, `Buffer`, `global`. Declared as its own block
  // rather than by loosening `no-undef` above, which is the rule that would
  // have caught a genuine typo in the detection cores these scripts share.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
])
