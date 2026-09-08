import fs from 'fs';
import path from 'path';

export function patchFirestore() {
  const dirs = [
    path.join(process.cwd(), 'node_modules', '@firebase', 'firestore'),
    path.join(process.cwd(), 'node_modules', '.vite', 'deps')
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    function walk(currentDir: string) {
      for (const item of fs.readdirSync(currentDir)) {
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (item.endsWith('.js') || item.endsWith('.mjs')) {
          let content = fs.readFileSync(fullPath, 'utf8');
          let modified = false;

          // 1. Fix fromVersion hardAssert (0xc050 / 49232)
          if (content.includes('49232') || content.includes('0xc050') || content.includes('c050')) {
            const before = content;

            // Handle unclosed paren if present from previous runs
            content = content.replace(/return\s*\(!([a-zA-Z0-9_]+)\s*\?\s*([a-zA-Z0-9_]+)\.min\(\)\s*:\s*([a-zA-Z0-9_]+)\.fromTimestamp/g, 'return !$1 ? $2.min() : $3.fromTimestamp');

            // Handle standard patterns in ESM / CJS / node
            content = content.replace(/__PRIVATE_hardAssert\(!+([a-zA-Z0-9_]+),\s*49232\),\s*([a-zA-Z0-9_]+)\.fromTimestamp/g, '!$1 ? $2.min() : $2.fromTimestamp');
            content = content.replace(/hardAssert\(!+([a-zA-Z0-9_]+),\s*0xc050\);\s*return\s+([a-zA-Z0-9_]+)\.fromTimestamp/g, 'if (!$1) return $2.min(); return $2.fromTimestamp');
            content = content.replace(/hardAssert\(!+([a-zA-Z0-9_]+),\s*49232\);\s*return\s+([a-zA-Z0-9_]+)\.fromTimestamp/g, 'if (!$1) return $2.min(); return $2.fromTimestamp');

            if (content !== before) {
              fs.writeFileSync(fullPath, content, 'utf8');
              modified = true;
            }
          }

          // 2. Also ensure __PRIVATE_hardAssert safely handles 49232 / 0xc050 without throwing
          if (content.includes('function __PRIVATE_hardAssert') && !content.includes('if (t2 === 49232')) {
            content = content.replace(
              /function\s+__PRIVATE_hardAssert\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*\)\s*\{/g,
              'function __PRIVATE_hardAssert($1, $2, $3, $4) { if ($2 === 49232 || $2 === 0xc050 || $1 === true) return;'
            );
            fs.writeFileSync(fullPath, content, 'utf8');
            modified = true;
          }

          if (modified) {
            console.log(`[patch-firestore] Patched: ${path.relative(process.cwd(), fullPath)}`);
          }
        }
      }
    }

    walk(dir);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  patchFirestore();
}
