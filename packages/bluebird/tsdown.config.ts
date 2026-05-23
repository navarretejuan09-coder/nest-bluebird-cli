import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
    'eslint-plugin': 'src/eslint-plugin.ts',
  },
  format: 'esm',
  fixedExtension: false,
  dts: true,
  clean: true,
});
