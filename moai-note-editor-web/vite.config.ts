import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * 라이브러리 모드 — 단일 파일 embed.js 를 만든다.
 *
 * CSS를 별도 파일로 빼지 않는다. 에디터는 Shadow root 안에 그려지므로
 * <link> 로 붙일 수 없고, 스타일 문자열을 번들에 담아 주입해야 한다.
 * (src/styles.ts 가 ?raw 로 CSS를 문자열로 가져온다)
 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MoaiNote',
      // IIFE — 호스트가 <script> 한 줄로 붙일 수 있어야 한다(모듈 번들러 없음)
      formats: ['iife'],
      fileName: () => 'embed.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    // 외부 의존성 없이 전부 포함한다 — 호스트에 아무것도 요구하지 않는다
    rollupOptions: { external: [] },
    target: 'es2020',
    // Vite 8 은 rolldown/oxc 기반이다. 'esbuild' 를 지정하면 esbuild 를 따로 요구한다.
    minify: true,
  },
  server: {
    port: 7110,
    open: '/demo/index.html',
  },
});
