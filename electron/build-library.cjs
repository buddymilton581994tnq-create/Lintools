'use strict';
const fs = require('fs');
const path = require('path');

const lexiconDir = path.join(__dirname, 'lexicon');
const outFile = path.join(__dirname, 'corpus-library.json');

let library = [];
fs.readdirSync(lexiconDir).forEach(file => {
  if (file.endsWith('.json')) {
    const filePath = path.join(lexiconDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        library = library.concat(data);
      }
    } catch (e) {
      console.error(`Error processing ${file}:`, e);
    }
  }
});

fs.writeFileSync(outFile, JSON.stringify(library, null, 2), 'utf8');
console.log(`Successfully merged ${library.length} terms into ${outFile}`);

// 同步构建 UniversalTagTranslator 使用的扁平化检索索引 master_index.json
const masterIndex = {};
for (const item of library) {
  if (!item || !item.en) continue;
  const en = String(item.en).trim();
  const zhCandidates = [item.label, ...(Array.isArray(item.terms) ? item.terms : [])];
  for (const zh of zhCandidates) {
    if (!zh) continue;
    const key = String(zh).trim().toLowerCase();
    if (key.length >= 2 && !masterIndex[key]) {
      masterIndex[key] = en;
    }
  }
}
const indexFile = path.join(__dirname, 'master_index.json');
fs.writeFileSync(indexFile, JSON.stringify(masterIndex, null, 2), 'utf8');
console.log(`Successfully built master_index.json with ${Object.keys(masterIndex).length} searchable keys.`);
