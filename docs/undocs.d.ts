declare module 'undocs/cli/cli.mjs' {
  export function createCLI(options: { name: string; setup: { extends: string[] } }): {
    runMain: () => void;
  };
}
