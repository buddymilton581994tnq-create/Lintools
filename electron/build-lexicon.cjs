'use strict'
const fs = require('fs')
const path = require('path')

const lexiconDir = path.join(__dirname, 'lexicon')
const outFile = path.join(__dirname, 'corpus-library.json')

let library = []
for (const f of fs.readdirSync(lexiconDir)) {
  if (f.endsWith('.json')) {
    const data = JSON.parse(fs.readFileSync(path.join(lexiconDir, f), 'utf8'))
    library = library.concat(data)
  }
}

fs.writeFileSync(outFile, JSON.stringify(library, null, 2), 'utf8')
console.log(`Library built: ${library.length} terms in ${outFile}`)
