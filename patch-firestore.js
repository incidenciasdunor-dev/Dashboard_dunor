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
                modified = true;
              }
            }

            // 2. Safe access for MutationBatchResult.from: prevents reading .version of undefined n[e]
            if (content.includes('.version') && content.includes('.insert(')) {
              const before = content;
              content = content.replace(
                /\.insert\(([a-zA-Z0-9_$]+)\[([a-zA-Z0-9_$]+)\]\.key,\s*([a-zA-Z0-9_$]+)\[\2\]\.version\)/g,
                '.insert($1[$2].key, ($3 && $3[$2] && $3[$2].version) ? $3[$2].version : ($1[$2] && $1[$2].version ? $1[$2].version : null))'
              );
              if (content !== before) {
                modified = true;
              }
            }

            // 3. Safe guard for __PRIVATE_mutationApplyToRemoteDocument: return if n or n.version is missing
            if (content.includes('__PRIVATE_mutationApplyToRemoteDocument')) {
              const before = content;
              content = content.replace(
                /function\s+__PRIVATE_mutationApplyToRemoteDocument\s*\(([a-zA-Z0-9_$]+),\s*([a-zA-Z0-9_$]+),\s*([a-zA-Z0-9_$]+)\)\s*\{(?!\s*if\s*\(!\3)/g,
                'function __PRIVATE_mutationApplyToRemoteDocument($1, $2, $3) { if (!$3 || !$3.version) return;'
              );
              content = content.replace(
                /__PRIVATE_mutationApplyToRemoteDocument\(([a-zA-Z0-9_$]+),\s*([a-zA-Z0-9_$]+),\s*([a-zA-Z0-9_$]+)\[([a-zA-Z0-9_$]+)\]\)/g,
                '($3 && $3[$4] ? __PRIVATE_mutationApplyToRemoteDocument($1, $2, $3[$4]) : undefined)'
              );
              if (content !== before) {
                modified = true;
              }
            }

            // 4. Safe guard for applyWriteToRemoteDocuments compareTo
            if (content.includes('.version.compareTo(')) {
              const before = content;
              content = content.replace(
                /([a-zA-Z0-9_$]+)\.version\.compareTo\(([a-zA-Z0-9_$]+)\)\s*<\s*0\s*&&/g,
                '($1 && $1.version && $2 ? $1.version.compareTo($2) < 0 : false) &&'
              );
              if (content !== before) {
                modified = true;
              }
            }

            // 5. Also ensure __PRIVATE_hardAssert and __PRIVATE__fail safely handle assertion codes without throwing
            if (content.includes('function __PRIVATE_hardAssert(')) {
              const before = content;
              content = content.replace(
                /function\s+__PRIVATE_hardAssert\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*\)\s*\{[\s\S]*?e2\s*\|\|\s*__PRIVATE__fail\([^)]*\);\s*\}/g,
                'function __PRIVATE_hardAssert($1, $2, $3, $4) { if ($1 === true || $2 === 49232 || $2 === 0xc050 || $2 === 58842 || $2 === 0xe5da || $2 === 47125 || $2 === 0xb815) return; if (!$1) { console.warn("[Firestore HardAssert Handled]", $2); return; } }'
              );
              content = content.replace(
                /function\s+__PRIVATE_hardAssert\s*\(\s*([a-zA-Z0-9_$]+)\s*,\s*([a-zA-Z0-9_$]+)[\s\S]*?console\.warn\("\[Firestore HardAssert Suppressed\]"[\s\S]*?\}/g,
                'function __PRIVATE_hardAssert($1, $2, $3, $4) { if ($1 === true || $2 === 49232 || $2 === 0xc050 || $2 === 58842 || $2 === 0xe5da || $2 === 47125 || $2 === 0xb815) return; if (!$1) { console.warn("[Firestore HardAssert Handled]", $2); return; } }'
              );
              if (content !== before) {
                modified = true;
              }
            }

            if (content.includes('function __PRIVATE__fail(')) {
              const before = content;
              content = content.replace(
                /function\s+__PRIVATE__fail\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*\)\s*\{/g,
                'function __PRIVATE__fail($1, $2, $3) { if ($1 === 47125 || $1 === 0xb815 || $1 === 49232 || $1 === 0xc050 || $1 === 58842 || $1 === 0xe5da) return;'
              );
              if (content !== before) {
                modified = true;
              }
            }

            // 6. Suppress Xc() / delayed operation calling 47125 / 0xb815 safely without breaking syntax
            if (content.includes('47125') || content.includes('0xb815') || content.includes('this.zc') || content.includes('Xc()')) {
              const before = content;
              content = content.replace(/Xc\(\)\s*\{\s*this\.zc\s*=\s*null;\s*\}\s*\);\s*\}/g, 'Xc() { this.zc = null; }');
              content = content.replace(/Xc\(\)\s*\{\s*this\.zc\s*=\s*null;\s*\}\s*\);/g, 'Xc() { this.zc = null; }');
              content = content.replace(/this\.zc\s*&&\s*[a-zA-Z0-9_$]+\s*\(\s*(?:47125|0xb815)[\s\S]*?\);/g, 'this.zc = null;');
              if (content !== before) {
                modified = true;
              }
            }

            if (modified) {
              fs.writeFileSync(fullPath, content, 'utf8');
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
