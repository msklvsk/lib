import * as xmlUtils from '../../xml/utils';
import { string2lxmlRoot } from '../../utils.node';
import { tokenizeTei, morphInterpret, interpretedTeiDoc2sketchVertical, normalizeCorpusTextString } from '../utils';
import { createMorphAnalyzerSync } from '../morph_analyzer/factories.node';

// import { AllHtmlEntities } from 'html-entities';
import * as fs from 'fs';
import * as path from 'path';

const mkdirp = require('mkdirp');
const charsetDetector = require('node-icu-charset-detector');
const globSync = require('glob').sync;


// const entities = new AllHtmlEntities();
const args = require('minimist')(process.argv.slice(2), {
  boolean: ['tee'],
});
const morphAnalyzer = createMorphAnalyzerSync();

main();

//------------------------------------------------------------------------------
function kotsybaUltif2DirtyTei(filename: string, destDir: string,
  author?: string, title?: string, corpusFile?: number) {

  let buffer = fs.readFileSync(filename);
  let charset = charsetDetector.detectCharset(buffer);
  let basename = path.basename(filename).replace(/\.txt$/, '.xml');

  let destPath = `${destDir}/${basename}`;
  try {
    let body = buffer.toString(charset);
    body = body.replace(/[\r\x00-\0x1F]/g, '');
    let bibliographyTry = body.match(/<bibliography>(.+)<\/bibliography>/);
    if (!title) {
      if (bibliographyTry && bibliographyTry.length > 1) {
        title = xmlUtils.removeTags(bibliographyTry[1]).trim().replace(/\s+/g, ' ');
      } else {
        title = basename.replace(/\.xml$/, '').split(/[\s_]+/).map(x => capitalizeFirst(x)).join(' ');
      }
    }
    body = xmlUtils.removeElements(body, ['bibliography', 'comment', 'annotation']);
    body = xmlUtils.removeTags(body);
    body = normalizeCorpusTextString(body);
    body = xmlUtils.escape(body);
    body = `<p>${body}</p>`;
    body = teiString({ title, body, author });
    // fs.writeFileSync('problem.xml', fileString, 'utf8')
    let root = string2lxmlRoot(body);
    tokenizeTei(root, morphAnalyzer);
    // console.profile('morphInterpret');
    morphInterpret(root, morphAnalyzer);
    // console.profileEnd('morphInterpret');
    body = root.serialize();

    fs.writeFileSync(destPath, body, 'utf8');

    if (corpusFile !== undefined) {
      for (let line of interpretedTeiDoc2sketchVertical(root)) {
        fs.appendFileSync(corpusFile as any, line + '\n', 'utf8');
      }
    }
  }
  catch (e) {
    console.log(`ERROR: ${e.message} Ignoring file ${basename}`);
  }
}

//------------------------------------------------------------------------------
function buildFilenames(glob: string) {
  let ret = new Map<string, string>();
  for (let filePath of globSync(glob) as string[]) {
    let basename = path.basename(filePath);
    if (basename.startsWith('_') && basename.endsWith('.txt')) {
      continue;
    }
    if (!ret.has(basename) || filePath.includes('_ulif_allbooks')) {
      ret.set(basename, filePath);
    }
  }

  return ret;
}

//------------------------------------------------------------------------------
function teiString(params) {
  return `<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:mi="http://mova.institute/ns/corpora/0.1"
  xml:lang="uk">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>${params.title || ''}</title>
        <author>${params.author || ''}</author>
      </titleStmt>
      <publicationStmt>
        <p></p>
      </publicationStmt>
      <sourceDesc>
        <p></p>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      ${params.body || ''}
    </body>
  </text>
</TEI>
`;
}

//------------------------------------------------------------------------------
function capitalizeFirst(value: string) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

//------------------------------------------------------------------------------
function main() {
  let listLines = fs.readFileSync(path.join(args.in, '_list.txt'), 'utf8').split('\n');
  let nameMap = new Map<string, string[]>();
  listLines.forEach(line => {
    let [filename, ...meta] = line.split('\t');
    nameMap.set(filename.toLowerCase(), meta);
  });


  let filenames = buildFilenames(args.in);
  mkdirp.sync(args.out);
  let corpusFile = args.tee ? fs.openSync(args.out + 'corpus.vertical.txt', 'a') : undefined;
  console.log(`processing ${filenames.size} files...`);
  let i = 0;
  for (let filePath of filenames.values()) {
    ++i;
    let basename = path.basename(filePath);
    let [author, title] = nameMap.get(basename.toLowerCase());
    let destPath = `${args.out}/${basename}`;
    if (fs.existsSync(destPath)) {
      console.log(`skipping "${basename}" (exists)`);
    }
    else {
      console.log(`processing "${basename}" (${i} of ${filenames.size})`);
      kotsybaUltif2DirtyTei(filePath, args.out, author, title, corpusFile);
    }
  }
}
