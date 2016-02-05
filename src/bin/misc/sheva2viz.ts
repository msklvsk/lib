import {nonemptyLinesSync} from '../../utils.node';
import {createWriteStream} from 'fs';

const args = require('minimist')(process.argv.slice(2));

let output = createWriteStream(args.o);

let lexemes = new Map<string, Array<[string, string]>>();
let lemmaTags = new Map<string, string>();
for (let line of nonemptyLinesSync(args.i)) {
  if (!line.includes(' ')) {
    let [form, lemma, tag] = line.split(',');
    if (!lexemes.has(lemma)) {
      lexemes.set(lemma, []);
    }
    if (form === lemma && !lemmaTags.has(lemma)) {
      lemmaTags.set(lemma, tag);
    }
    lexemes.get(lemma).push([form, tag]);
  }
}

for (let [lemma, lexeme] of lexemes) {
  output.write(lemma + ' ' + lemmaTags.get(lemma) + '\n');
  for (let [form, tag] of lexeme) {
    if (form !== lemma || tag !== lemmaTags.get(lemma)) {
      output.write('  ' + form + ' ' + tag + '\n');
    }
  }
}