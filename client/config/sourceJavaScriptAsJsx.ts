import { transformWithOxc } from 'vite';

export function sourceJavaScriptAsJsx() {
  return {
    name: 'codewithmee-source-js-as-jsx',
    enforce: 'pre' as const,
    async transform(source: string, id: string) {
      const normalizedId = id.replaceAll('\\', '/').split('?')[0];
      if (!normalizedId.includes('/src/') || !normalizedId.endsWith('.js')) {
        return null;
      }

      return transformWithOxc(source, id, {
        jsx: {
          importSource: 'react',
          runtime: 'automatic',
        },
        lang: 'jsx',
        sourcemap: true,
      });
    },
  };
}
