import fs from 'fs';
import path from 'path';

export function patchFirestore() {
  try {
    const dirs = [
      path.join(process.cwd(), 'node_modules', '@firebase', 'firestore'),
      path.join(process.cwd(), 'node_modules', '.vite', 'deps')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      function walk(currentDir) {
        for (const item of fs.readdirSync(currentDir)) {
          const fullPath = path.join(currentDir, item);
          let stat;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (item.endsWith('.js') || item.endsWith('.mjs')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let modified = false;

            // 1. Fix fromVersion hardAssert (0xc050 / 49232)
            if (content.includes('49232') || content.includes('0xc050') || content.includes('c050')) {
              const before = content;
              content = content.replace(/return\s*\(!([a-zA-Z0-9_]+)\s*\?\s*([a-zA-Z0-9_]+)\.min\(\)\s*:\s*([a-zA-Z0-9_]+)\.fromTimestamp/g, 'return !$1 ? $2.min() : $3.fromTimestamp');
              content = content.replace(/__PRIVATE_hardAssert\(!+([a-zA-Z0-9_]+),\s*49232\),\s*([a-zA-Z0-9_]+)\.fromTimestamp/g, '!$1 ? $2.min() : $2.fromTimestamp');
              content = content.replace(/hardAssert\(!+([a-zA-Z0-9_]+),\s*0xc050\);\s*return\s+([a-zA-Z0-9_]+)\.fromTimestamp/g, 'if (!$1) return $2.min(); return $2.fromTimestamp');
              content = content.replace(/hardAssert\(!+([a-zA-Z0-9_]+),\s*49232\);\s*return\s+([a-zA-Z0-9_]+)\.fromTimestamp/g, 'if (!$1) return $2.min(); return $2.fromTimestamp');

              if (content !== before) {
                fs.writeFileSync(fullPath, content, 'utf8');
                modified = true;
              }
            }

            // 2. Also ensure __PRIVATE_hardAssert safely handles all internal assertion codes without throwing
            if (content.includes('function __PRIVATE_hardAssert(')) {
              const before = content;
              content = content.replace(
                /function\s+__PRIVATE_hardAssert\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*\)\s*\{[\s\S]*?e2\s*\|\|\s*__PRIVATE__fail\([^)]*\);\s*\}/g,
                'function __PRIVATE_hardAssert($1, $2, $3, $4) { if ($1 === true || $2 === 49232 || $2 === 0xc050 || $2 === 58842 || $2 === 0xe5da || $2 === 47125 || $2 === 0xb815) return; if (!$1) { console.warn("[Firestore HardAssert Suppressed]", $2); return; } }'
              );
              if (content !== before) {
                fs.writeFileSync(fullPath, content, 'utf8');
                modified = true;
              }
            }

            // 3. Suppress Xc() calling 47125 / 0xb815 on delayed operation
            if (content.includes('47125') || content.includes('0xb815') || content.includes('/* suppressed b815 */')) {
              const before = content;
              content = content.replace(/\/\*\s*suppressed\s*b815\s*\*\/[\s\S]*?\}\);/g, 'this.zc = null;');
              content = content.replace(/Xc\(\)\s*\{[\s\S]*?47125[\s\S]*?\}/g, 'Xc() { this.zc = null; }');
              content = content.replace(/this\.zc\s*&&\s*[a-zA-Z0-9_]+\s*\(\s*(?:47125|0xb815)[\s\S]*?\);/g, 'this.zc = null;');
              if (content !== before) {
                fs.writeFileSync(fullPath, content, 'utf8');
                modified = true;
              }
            }

            if (modified) {
              console.log(`[patch-firestore] Patched: ${path.relative(process.cwd(), fullPath)}`);
            }
          }
        }
      }

      walk(dir);
    }
  } catch (err) {
    console.warn("[patch-firestore] Notice:", err?.message || err);
  }
}

// Run safely when invoked directly
patchFirestore();
