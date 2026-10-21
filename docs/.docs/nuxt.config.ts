export default {
  css: ['~/assets/css/main.css'],
  app: {
    baseURL: '/open-fms/',
  },
  appConfig: {
    ui: {
      prose: {
        codeIcon: { sh: 'lucide:terminal' },
      },
    },
  },
  icon: {
    clientBundle: {
      scan: true,
      icons: [
        'heroicons:rocket-launch',
        'lucide:activity',
        'lucide:book-open',
        'lucide:cloud-cog',
        'lucide:code-2',
        'lucide:compass',
        'lucide:download',
        'lucide:file-check',
        'lucide:git-branch',
        'lucide:lock',
        'lucide:plug',
        'lucide:rocket',
        'lucide:settings',
        'lucide:terminal',
        'lucide:file-code',
        'lucide:server',
        'lucide:zap',
        'lucide:leaf',
        'lucide:shield-check',
        'lucide:upload-cloud',
        'lucide:users',
        'simple-icons:github',
        'vscode-icons:file-type-typescript',
        'vscode-icons:file-type-python',
      ],
    },
  },
  content: {
    build: {
      markdown: {
        highlight: {
          langs: ['python'],
        },
      },
    },
  },
};
