import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'backupctl',
  description:
    'Backup orchestration for databases, files, or both — database-agnostic, hexagonal architecture, CLI-first.',

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]],

  ignoreDeadLinks: [/localhost/],

  markdown: {
    languageAlias: { env: 'ini' },
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/01-introduction' },
      { text: 'CLI Reference', link: '/06-cli-reference' },
      { text: 'Configuration', link: '/05-configuration' },
      {
        text: 'Links',
        items: [
          { text: 'GitHub', link: 'https://github.com/vineethkrishnan/backupctl' },
          { text: 'Changelog', link: 'https://github.com/vineethkrishnan/backupctl/releases' },
          { text: 'Report an Issue', link: 'https://github.com/vineethkrishnan/backupctl/issues/new' },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/01-introduction' },
          { text: 'Architecture', link: '/02-architecture' },
          { text: 'Requirements', link: '/03-requirements' },
          { text: 'Installation', link: '/04-installation' },
        ],
      },
      {
        text: 'Usage',
        items: [
          { text: 'Configuration', link: '/05-configuration' },
          { text: 'CLI Reference', link: '/06-cli-reference' },
          { text: 'Bash Scripts', link: '/07-bash-scripts' },
          { text: 'Cheatsheet', link: '/10-cheatsheet' },
        ],
      },
      {
        text: 'How It Works',
        items: [
          { text: 'Backup Flow', link: '/08-backup-flow' },
          { text: 'Restore Guide', link: '/09-restore-guide' },
        ],
      },
      {
        text: 'Advanced',
        items: [
          { text: 'Adding Adapters', link: '/11-adding-adapters' },
          { text: 'Troubleshooting', link: '/12-troubleshooting' },
          { text: 'Development', link: '/13-development' },
          { text: 'Migrations', link: '/14-migrations' },
          { text: 'FAQ', link: '/15-faq' },
          { text: 'Monitoring', link: '/16-monitoring' },
          { text: 'Network', link: '/17-network' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Report an Issue', link: 'https://github.com/vineethkrishnan/backupctl/issues/new' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/vineethkrishnan/backupctl' }],

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/vineethkrishnan/backupctl/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Vineeth N K',
    },

    outline: { level: [2, 3] },
  },
});
