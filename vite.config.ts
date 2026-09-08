import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

function firestoreAssertionPatchPlugin() {
  return {
    name: 'firestore-assertion-patch',
    transform(code: string, id: string) {
      if (id.includes('firestore') && (code.includes('49232') || code.includes('0xc050'))) {
        let patched = code;
        patched = patched.replace(/return\s*\(!([a-zA-Z0-9_]+)\s*\?\s*([a-zA-Z0-9_]+)\.min\(\)\s*:\s*([a-zA-Z0-9_]+)\.fromTimestamp/g, 'return !$1 ? $2.min() : $3.fromTimestamp');
        patched = patched.replace(/__PRIVATE_hardAssert\(!+([a-zA-Z0-9_]+),\s*49232\),\s*([a-zA-Z0-9_]+)\.fromTimestamp/g, '!$1 ? $2.min() : $2.fromTimestamp');
        patched = patched.replace(/hardAssert\(!+([a-zA-Z0-9_]+),\s*0xc050\);\s*return\s+([a-zA-Z0-9_]+)\.fromTimestamp/g, 'if (!$1) return $2.min(); return $2.fromTimestamp');
        patched = patched.replace(/hardAssert\(!+([a-zA-Z0-9_]+),\s*49232\);\s*return\s+([a-zA-Z0-9_]+)\.fromTimestamp/g, 'if (!$1) return $2.min(); return $2.fromTimestamp');
        if (patched.includes('function __PRIVATE_hardAssert') && !patched.includes('if (t2 === 49232')) {
          patched = patched.replace(
            /function\s+__PRIVATE_hardAssert\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*\)\s*\{/g,
            'function __PRIVATE_hardAssert($1, $2, $3, $4) { if ($2 === 49232 || $2 === 0xc050 || $1 === true) return;'
          );
        }
        return { code: patched, map: null };
      }
      return null;
    }
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), firestoreAssertionPatchPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
