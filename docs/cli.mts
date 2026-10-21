import { fileURLToPath } from 'node:url';
import { createCLI } from 'undocs/cli/cli.mjs';

const cli = createCLI({
  name: 'open-fms-docs',
  setup: {
    extends: [fileURLToPath(new URL('./.docs', import.meta.url))],
  },
});

cli.runMain();
