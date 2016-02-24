import {NS, nameNs, traverseDepth, traverseDepthEl, traverseDocumentOrder, cantBeXml} from '../xml/utils'
import {W, W_, PC, SE, P} from './common_elements'
import {r} from '../lang';
import {INode, IElement, IDocument} from '../xml/api/interfaces'
import {MorphAnalyzer, MorphTag} from './morph_analyzer/morph_analyzer';
import {getUnambMorphTag} from './text_token';


export const WCHAR_UK = r `\-’АаБбВвГгҐґДдЕеЄєЖжЗзИиІіЇїЙйКкЛлМмНнОоПпРрСсТтУуФфХхЦцЧчШшЩщЬьЮюЯя`;
export const WCHAR_UK_RE = new RegExp(`^[${WCHAR_UK}]+$`);
export const WCHAR = r `\w${WCHAR_UK}`;
export const WCHAR_RE = new RegExp(`^[${WCHAR}]+$`);

//export const NOSPACE_ABLE_ELEMS
export const ELEMS_BREAKING_SENTENCE_NS = new Set([
  nameNs(NS.tei, 'p'),
  nameNs(NS.tei, 'body'),
  nameNs(NS.tei, 'text')
]);
const ELEMS_BREAKING_SENTENCE = new Set([
  'p', 'text'
]);

const PUNC_REGS = [
  r `„`,
  r `“`,
  r `”`,
  r `«`,
  r `»`,
  r `\(`,
  r `\)`,
  r `\[`,
  r `\]`,
  r `\.`,
  r `\.{4,}`,
  r `…`,
  r `:`,
  r `;`,
  r `,`,
  r `[!?]+`,
  r `!\.{2,}`,
  r `\?\.{2,}`,
  r `—`,
];
const ANY_PUNC = PUNC_REGS.join('|');
const ANY_PUNC_OR_DASH_RE = new RegExp(`^${ANY_PUNC}|-$`);

let PUNC_SPACING = {
  ',': [false, true],
  '.': [false, true],
  ':': [false, true],
  ';': [false, true],
  '-': [false, false],   // dash
  '–': [false, false],   // n-dash
  '—': [true, true],     // m-dash
  '(': [true, false],
  ')': [false, true],
  '[': [true, false],
  ']': [false, true],
  '„': [true, false],
  '“': [true, false],    // what about ukr/eng?
  '”': [false, true],
  '«': [true, false],
  '»': [false, true],
  '!': [false, true],
  '?': [false, true],
  '…': [false, true],
};

const WORD_TAGS = new Set([W, W_]);


////////////////////////////////////////////////////////////////////////////////
export function haveSpaceBetween(tagA: string, textA: string,
  tagB: string, textB: string) {
  if (!tagA || !tagB) {
    return null;
  }
  let spaceA = !!PUNC_SPACING[textA] && PUNC_SPACING[textA][1];
  let spaceB = !!PUNC_SPACING[textB] && PUNC_SPACING[textB][0];
  let isWordA = WORD_TAGS.has(tagA);
  let isWordB = WORD_TAGS.has(tagB);

  if (isWordA && isWordB) {
    return true;
  }

  if (isWordA && tagB === PC) {
    return spaceB;
  }
  if (isWordB && tagA === PC) {
    return spaceA;
  }

  if (tagA === tagB && tagB === PC) {
    return spaceA && spaceB;
  }

  if (tagB === PC) {
    return spaceB;
  }

  if (tagB === P) {
    return false;
  }

  if (tagA === SE) {
    return true;
  }

  return null;
}

////////////////////////////////////////////////////////////////////////////////
export function haveSpaceBetweenEl(a: IElement, b: IElement): boolean {
  let tagA = a ? a.nameNs() : null;
  let textA = a ? a.textContent : null;
  let tagB = b ? b.nameNs() : null;
  let textB = b ? b.textContent : null;
  return haveSpaceBetween(tagA, textA, tagB, textB);
}

const SPLIT_REGEX = new RegExp(`(${ANY_PUNC}|[^${WCHAR}])`);
////////////////////////////////////////////////////////////////////////////////
export function tokenizeUk(val: string, analyzer: MorphAnalyzer) {
  let ret: Array<string> = [];
  for (let tok0 of val.trim().split(SPLIT_REGEX)) {
    for (let tok1 of tok0.split(/\s+/)) {
      if (tok1) {
        if (tok1.includes('-')) {
          if (!(analyzer.dictHas(tok1))) {
            ret.push(...tok1.split(/(-)/).filter(x => !!x));
            continue;
          }
        }
        ret.push(tok1);
      }
    }
  }

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
const TOSKIP = new Set(['w', 'mi:w_', 'pc', 'abbr', 'mi:se']);
////////////////////////////////////////////////////////////////////////////////
export function tokenizeTeiDom(root: IElement, tagger: MorphAnalyzer) {
  traverseDepth(root, (node: INode) => {
    if (TOSKIP.has(node.nodeName)) {
      return 'skip';
    }
    if (node.isText()) {
      let lang = node.lang();
      if (lang === 'uk' || lang === '') {
        for (let tok of tokenizeUk(node.textContent, tagger)) {
          node.insertBefore(elementFromToken(tok, root.ownerDocument));
        }
        node.remove();
      }
    }
  });

  return root;
}

////////////////////////////////////////////////////////////////////////////////
export function elementFromToken(token: string, document: IDocument): IElement {
  let ret;
  if (ANY_PUNC_OR_DASH_RE.test(token)) {
    ret = document.createElement('pc');
    ret.textContent = token;
  }
  else if (/^\d+$/.test(token) || WCHAR_RE.test(token)) {
    ret = document.createElement('w');
    ret.textContent = token;
  }
  else {
    //console.error(`Unknown token: "${token}"`); // todo
    ret = document.createElement('w');
    ret.textContent = token;
    //throw 'kuku' + token.length;
  }

  return ret;
}

//------------------------------------------------------------------------------
function tagWord(el: IElement, morphTags: Set<MorphTag>) {
  //let w_ = el.ownerDocument.createElementNS(NS.mi, 'w_');
  let w_ = el.ownerDocument.createElement('mi:w_'); // todo
  
  if (!morphTags.size) {
    morphTags.add({ lemma: el.textContent, tag: 'X' });
    //console.log('Unknown word: "' + el.textContent + '"');
  }
  for (let morphTag of morphTags) {
    let w = el.ownerDocument.createElement('w');
    w.textContent = el.textContent;
    let {lemma, tag} = morphTag;
    w.setAttribute('lemma', lemma);
    w.setAttribute('ana', tag);
    w_.appendChild(w);
  }
  el.replace(w_);
}
////////////////////////////////////////////////////////////////////////////////
export function tagTokenizedDom(root: IElement, analyzer: MorphAnalyzer) {
  traverseDepthEl(root, (node: IElement) => {
    let el = <IElement>node;
    let nameNs = el.nameNs();
    if (nameNs === W_) {
      return 'skip';
    }
    if (nameNs === W) {
      tagWord(el, analyzer.tag(el.textContent));
    }
  });

  return root;
}

////////////////////////////////////////////////////////////////////////////////
export function enumerateWords(root: IElement) {
  let idGen = 0;
  traverseDepthEl(root, el => {
    if (el.nameNs() === W_) {
      el.setAttribute('n', (idGen++).toString());
    }
  });

  return idGen;
}

//------------------------------------------------------------------------------
function normalizeForm(str: string) {
  return cantBeLowerCase(str) ? str : str.toLowerCase()
}
////////////////////////////////////////////////////////////////////////////////
export function getStats(root: IElement) {
  let wordCount = 0;
  let dictUnknownCount = 0;
  let words = new Set<string>();
  let dictUnknowns = new Set<string>();
  traverseDepthEl(root, elem => {
    let name = elem.nameNs();
    if (name === W_) {
      ++wordCount;
      // todo: use TextToken
      //...
    }
    else if (name === W && elem.getAttribute('ana') === 'X') {
      dictUnknowns.add(normalizeForm(elem.textContent));
      ++dictUnknownCount;
    }
  });

  return {
    wordCount,
    dictUnknownCount,
    dictUnknowns: Array.from(dictUnknowns)
  }
}

////////////////////////////////////////////////////////////////////////////////
export function cantBeLowerCase(word: string) {
  if (word.length < 2) {
    return false;
  }
  let subsr = word.substr(1);
  return subsr !== subsr.toLowerCase();
}

////////////////////////////////////////////////////////////////////////////////
export function isSaneLemma(value: string) {
  return WCHAR_UK_RE.test(value) || /^\d+$/.test(value);
}

////////////////////////////////////////////////////////////////////////////////
export function isSaneMte5Tag(value: string) {
  return /^[A-Z][a-z0-9\-]*$/.test(value);
}

////////////////////////////////////////////////////////////////////////////////
export function* dictFormLemmaTag(lines: Array<string>) {
  let lemma;
  for (let line of lines) {
    let isLemma = !line.startsWith(' ');
    line = line.trim();
    if (line) {
      let [form, tag] = line.split(' ');
      if (isLemma) {
        lemma = form;
      }
      yield { form, lemma, tag };
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
export function markWordwiseDiff(mine: IElement, theirs: IElement) {
  let mineWords = <IElement[]>mine.xpath('//mi:w_', NS);
  let theirWords = <IElement[]>theirs.xpath('//mi:w_', NS);

  if (mineWords.length !== theirWords.length) {
    // console.error(wordsMine.length);
    // console.error(wordsTheirs.length);
    // console.error(mine.ownerDocument.serialize());
    // console.error(theirs.ownerDocument.serialize());
    throw new Error('Diff for docs with uneven word count not implemented');
  }

  let numDiffs = 0;
  for (let [i, mine] of mineWords.entries()) {
    if (getUnambMorphTag(mine) !== getUnambMorphTag(theirWords[i])) {
      ++numDiffs;
      mine.setAttribute('mark', 'to-review');
    }
  }

  return numDiffs;
}

////////////////////////////////////////////////////////////////////////////////
export function firstNWords(n: number, from: IElement) {
  let words = from.xpath(`//mi:w_[position() < ${n}]`, NS);
  return (<IElement[]>words).map(x => x.childElement(0).textContent);
}

////////////////////////////////////////////////////////////////////////////////
export function oldZhyto2cur(root: IElement) {  // todo: remane xmlns
  let miwords = root.xpath('//mi:w_', NS);
  for (let miw of miwords) {
    (<IElement>miw).renameAttributeIfExists('ana', 'disamb');
    (<IElement>miw).renameAttributeIfExists('word-id', 'n');
  }
  return root;
}