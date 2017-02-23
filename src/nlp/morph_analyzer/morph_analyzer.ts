import * as flatten from 'lodash.flatten'

import { mu } from '../../mu'
import { Dictionary } from '../dictionary/dictionary'
import { MorphInterp } from '../morph_interp'
import { Case, Pos } from '../morph_features'
import {
  FOREIGN_RE, WCHAR_UK_UPPERCASE, ANY_PUNC_OR_DASH_RE, LETTER_UK_UPPERCASE, LETTER_UK_LOWERCASE,
  APOSTROPES_REPLACE_RE, URL_RE, ARABIC_NUMERAL_RE, ROMAN_NUMERAL_RE, SYMBOL_RE,
  EMAIL_RE, LITERAL_SMILE_RE, EMOJI_RE, SMILE_RE,
} from '../static'

import { HashSet } from '../../data_structures'
import { CacheMap } from '../../data_structures/cache_map'
import * as algo from '../../algo'
import { parseIntStrict } from '../../lang'
import * as stringUtils from '../../string_utils'




const REGEX2TAG = [
  [[URL_RE], ['sym']],
  [[EMAIL_RE], ['sym']],
  [[SYMBOL_RE], ['sym']],
  [[LITERAL_SMILE_RE], ['sym']],
  [[ARABIC_NUMERAL_RE], ['numr']],
  [[ROMAN_NUMERAL_RE], ['numr:roman']],
  [[ANY_PUNC_OR_DASH_RE], ['punct']],
  [[URL_RE,
    EMOJI_RE,
    SMILE_RE], ['sym']],
  [[FOREIGN_RE], [
    'noun:foreign',
    'noun:prop:foreign',
    'adj:foreign',
    'verb:foreign',
    'x:foreign',
  ]],
  // [HASHTAG_RE, 'x'],
] as [RegExp[], string[]][]


const gluedPrefixes = [
  'авіа',
  'авто',
  'агро',
  'аеро',
  'анти',
  'архі',
  'аудіо',
  'бензо',
  'бібліо',
  'біо',
  'вело',
  'вібро',
  'віце-',
  'водо',
  'газо',
  'геліо',
  'гео',
  'гідро',
  'гіпер',
  'давньо',
  'динаміко',
  'екзо',
  'екс-',
  'електро',
  'етно',
  'зоо',
  'ізо',
  'інтер',
  'квазі',
  'контр',
  'космо',
  'культ',
  'лакто',
  'лже',
  'макро',
  'максі',
  'мед',
  'мега',
  'мета',
  'метео',
  'мікро',
  'міні',
  'моно',
  'мото',
  'мульти',
  'нео',
  'пост',
  'псевдо',
  'радіо',
  'стерео',
  'супер',
  'теле',
  'телерадіо',
  'транс',
  'турбо',
  'ультра',
  'фіз',
  'фото',
]
const initialsRe = new RegExp(`^[${LETTER_UK_UPPERCASE}]$`)
const ukLowercaseRe = new RegExp(`^[${LETTER_UK_LOWERCASE}]$`)
const localDictArr = [
  // ['всі', 'adj:p:'],
]

//------------------------------------------------------------------------------
const PREFIX_SPECS = [
  {
    prefixesRegex: new RegExp(`^(${gluedPrefixes.join('|')})+`, 'g'),
    test: (x: MorphInterp) => x.isNoun() || x.isAdjective() || x.isAdverb(),
  },
  {
    prefixes: ['пре'],
    test: (x: MorphInterp) => x.isAdjective() && x.isComparable(),
  },
  {
    prefixes: ['пів'],
    test: (x: MorphInterp) => x.isNoun(),
  },
  {
    prefixes: ['за', 'не'],
    test: (x: MorphInterp) => x.isAdverb(),
  },
  {
    prefixes: ['не', 'між', 'недо', 'поза', 'по', 'пів', 'напів'],
    test: (x: MorphInterp) => x.isAdjective(),
  },
  {
    prefixes: ['обі', 'від', 'об', 'по', 'роз', 'за', 'з', 'у', 'пере', 'ви', 'на', 'пови', 'про'],
    pretest: (x: string) => x.length > 4,
    test: (x: MorphInterp) => x.isVerb() && x.isImperfect(),
    postprocess: postrpocessPerfPrefixedVerb,
  },
  {
    prefixes: ['за', 'пере'],
    pretest: (x: string) => x.length > 4,
    test: (x: MorphInterp) => x.isVerb(),
    postprocess: postrpocessPerfPrefixedVerb,
  },
]

//------------------------------------------------------------------------------
function postrpocessPerfPrefixedVerb(x: MorphInterp) {
  x.setIsPerfect()
  if (x.isPresent()) {
    x.setIsFuture()
  }
}

////////////////////////////////////////////////////////////////////////////////
export class MorphAnalyzer {
  expandAdjectivesAsNouns = false
  keepN2adj = false
  keepParadigmOmonyms = false
  private numeralMap = new Array<{ digit: number, form: string, interp: MorphInterp, lemma: string }>()
  private dictCache = new CacheMap<string, MorphInterp[]>(10000, token =>
    this.lookupRaw(token).map(x => MorphInterp.fromVesumStr(x.flags, x.lemma, x.lemmaFlags)))

  constructor(private dictionary: Dictionary) {
    this.buildNumeralMap()
  }

  setExpandAdjectivesAsNouns(value = true) {
    this.expandAdjectivesAsNouns = value
    return this
  }

  setKeepN2adj(value = true) {
    this.keepN2adj = value
    return this
  }

  hasAnyCase(token: string) {
    return this.dictionary.hasAnyCase(token)
  }

  canBeToken(token: string) {
    if (this.isCompoundAdjective(token)) {
      return false
    }
    let interps = this.tag(token)
    if (token.endsWith('.')) {
      return !interps.every(x => x.isAbbreviation())
    }

    return interps.length > 0
  }

  /** @token is atomic */
  tag(token: string, nextToken?: string) {
    token = token.replace(/\u0301/g, '')  // kill stress
    if (!token.length) {
      return []
    }

    // regexp
    for (let [regexes, tagStrs] of REGEX2TAG) {
      if (regexes.some(x => x.test(token))) {
        return tagStrs.map(x => MorphInterp.fromVesumStr(x, token))
      }
    }

    token = token.replace(APOSTROPES_REPLACE_RE, '’')  // normalize

    // dictionary
    let lookupees = varyLetterCases(token)
    let lowercase = lookupees[0]
    if (nextToken === '.') {
      lookupees.push(...lookupees.map(x => x + '.'))
    }

    let res = new HashSet(MorphInterp.hash, flatten(lookupees.map(x => this.lookup(x))))

    // try одробив is the same as відробив
    if (!res.size && lowercase.startsWith('од') && lowercase.length > 4) {
      res.addAll(this.lookup('від' + lowercase.substr(2))
        .filter(x => x.isVerb())
        .map(x => {
          x.lemma = 'од' + x.lemma!.substr(3)
          x.setIsAuto().setIsOdd()
          return x
        }))
    }

    // try prefixes
    if (!res.size) {
      res.addAll(this.fromPrefixes(lowercase, res))
    }

    // guess невідомосиній from невідомо- and синій
    if (!res.size) {
      let oIndex = lowercase.indexOf('о')
      if (oIndex > 2) {
        let left = lowercase.substring(0, oIndex + 1)
        if (this.lookup(left).some(x => x.isBeforeadj())) {
          let right = lowercase.substr(oIndex + 1)
          res.addAll(this.lookup(right).filter(x => x.isAdjective()).map(x => {
            x.lemma = left + x.lemma
            x.setIsAuto()
            return x
          }))
        }
      }
    }

    // try ґ→г
    if (!res.size) {
      res.addAll(this.fromGH(lookupees))
    }

    // ірод from Ірод
    if (!res.size) {
      let titlecase = stringUtils.titlecase(lowercase)
      res.addAll(this.lookup(titlecase).map(x => x/*.unproper()*/.setIsAuto()))
      // try ґ→г
      if (!res.size) {
        res.addAll(this.fromGH([titlecase]))
      }
    }

    // *річчя
    if (!res.size) {
      if (lowercase.endsWith('річчя')) {
        res.addAll(this.lookup('дворіччя').map(x => x.setIsAuto().setLemma(lowercase)))
      }
    }

    // Погода була *най*кепська
    if (!res.size && /^(що|як)?най/.test(lowercase)) {
      let match = lowercase.match(/^(що|як)?най/)
      if (match) {
        let toadd = this.lookup(lowercase.substr(match[0].length))
          .filter(x => x.isAdjective())
        // todo: remove !
        toadd.forEach(x => x.setLemma(match![0] + x.lemma).setIsAuto(true).setIsAbsolute())
        res.addAll(toadd)
      }
    }

    // по-*ськи, по-*:v_dav
    if (!res.size && lowercase.startsWith('по-')) {
      let right = lowercase.substr(3)
      let rightRes = this.lookup(right)
        .filter(x => x.isAdjective() && x.isMasculine() && x.isDative())
      if (rightRes.length || lowercase.endsWith('ськи') || lowercase.endsWith('цьки')) {
        res.add(MorphInterp.fromVesumStr('adv').setLemma(lowercase).setIsAuto())
      }
    }

    // дз from ДЗ
    if (!res.size) {
      res.addAll(this.lookup(lowercase.toUpperCase()).map(x => x.setIsAuto()))
    }

    // try ховаючися from ховаючись
    if (!res.size && lowercase.endsWith('ся')) {
      let sia = lowercase.slice(0, -1) + 'ь'
      let advps = this.lookup(sia).filter(x => x.isTransgressive())
      advps.forEach(x => {
        // x.lemma = x.lemma.slice(0, -1) + 'я'
        x.setIsAuto()
      })
      res.addAll(advps)
    }

    // try якнайстаранніш from якнайстаранніше
    if (!res.size
      && (lowercase.startsWith('най') || lowercase.startsWith('якнай'))
      && lowercase.endsWith('іш')) {
      let she = lowercase + 'е'
      let interps = this.lookup(she).filter(x => x.isAdverb()).map(x => x.setIsAuto())
      // todo: lemma?
      res.addAll(interps)
    }

    // initials
    if (initialsRe.test(token) && nextToken === '.') {
      res.add(MorphInterp.fromVesumStr('noun:anim:abbr:prop', `${token}.`))
    }

    // list items, letter names
    if (token !== 'я' && initialsRe.test(token.toUpperCase())) {
      res.add(MorphInterp.fromVesumStr('noun:inanim:prop', `${token}.`))
    }

    // one-letter abbrs
    if (ukLowercaseRe.test(lowercase) && nextToken === '.' && lowercase !== 'я') {   // <–– todo
      res.add(MorphInterp.fromVesumStr('x:abbr', `${lowercase}.`))
    }

    // try 20-x, todo
    {
      let match = lowercase.match(/^(\d+)[-–—]?([^\d]+)$/)
      if (match) {
        // console.log(match)
        let [, digits, ending] = match
        let lastDigit = parseIntStrict(digits.slice(-1))

        let interps = this.numeralMap
          .filter(x => x.digit === lastDigit && x.form.endsWith(ending))
          .map(x => x.interp.clone().setLemma(`${digits}-${x.lemma.slice(-ending.length)}`))
        res.addAll(interps)

        if (this.expandAdjectivesAsNouns) {
          interps = interps.map(x => x.clone().setIsAdjectiveAsNoun().setIsAnimate(false))
          res.addAll(interps)
        }
      }
    }

    // try reverse from non-reverse
    if (!res.size && lowercase.length > 4) {
      let ending = lowercase.slice(-2)
      if (ending === 'ся' || ending === 'сь') {
        let interps = this.lookup(lowercase.slice(0, -2))
          // .filter(x => x.isParticiple())
          .map(x => x.setIsReflexive().setLemma(x.lemma + 'ся'))
        res.addAll(interps)
      }
    }

    //~~~~~~~~~~~~~~
    // expand/add
    for (let interp of res) {
      if (interp.isNoun() && interp.canBeOrdinalNumeral()) {
        // fix dict problem: create мільйон numr from мільйон noun
        interp.setIsOrdinalNumeral(false)
        let numeral = new MorphInterp()
          .setPos(Pos.cardinalNumeral)
          .setCase(interp.features.case)
          .setIsPlural()
          .setLemma(interp.lemma)
        res.add(numeral)
      } else if (interp.isNoun() && interp.isNominative() && interp.isPlural() && interp.isAnimate()) {
        // add inanimish accusative, e.g. додати в друзі
        let candidate = interp.clone().setCase(Case.accusative)
        if (!res.has(candidate) && !res.has(candidate.setGrammaticalAnimacy(false))) {
          res.add(candidate)
        }
      }
    }

    // filter and postprocess
    let ret = new Array<MorphInterp>()
    for (let interp of res) {
      if (nextToken !== '-' && interp.isBeforeadj()) {
        if (!mu(res.keys()).some(x => x.isAdverb())) {
          // ret.push(MorphInterp.fromVesumStr('adv', lowercase).setIsAuto())
        }
        continue
      }

      if (!this.keepN2adj && interp.isN2Adj() && !interp.isProper()) {
        continue
      }
      // if (token.length === 1 && interp.isAbbreviation() && !interp.isProper() && !interp.isX()) {
      //   continue
      // }

      ret.push(interp)
    }

    return ret
  }

  tagOrX(token: string, nextToken?: string) {
    let ret = this.tag(token, nextToken)
    if (!ret.length) {
      ret = [MorphInterp.fromVesumStr('x', token)]
    }
    return ret
  }

  private lookupRaw(token: string) {
    let ret = this.dictionary.lookup(token)
    if (this.expandAdjectivesAsNouns) {
      let a = ret.map(x => {
        return mu(expandInterp(this.expandAdjectivesAsNouns, x.flags, x.lemma))
          .map(flags => ({ flags, lemma: x.lemma }))
          .toArray()
      })
      ret = flatten(a) as any
    }

    return ret
  }

  private lookup(token: string) {
    let interps = this.dictCache.get(token).map(x => x.clone())
    if (!this.keepParadigmOmonyms) {
      interps.forEach(x => x.features.paradigmOmonym = undefined)
    }
    // return this.lookupRaw(token).map(x => MorphInterp.fromVesumStr(x.flags, x.lemma, x.lemmaFlags))
    return interps
  }

  private isCompoundAdjective(token: string) {
    if (token.includes('-')) {
      for (let tok of varyLetterCases(token)) {
        let [last, ...prevs] = tok.split('-').reverse()
        return this.lookup(last).some(x => x.isAdjective())
          && prevs.every(x => this.lookup(x).some(xx => xx.isBeforeadj()))
      }
    }
    return false
  }

  private *fromPrefixes(lowercase: string, fromDict: HashSet<any>) {
    for (let { prefixes, prefixesRegex, pretest, test, postprocess } of PREFIX_SPECS as any) {
      if (pretest && !pretest(lowercase)) {
        continue
      }

      let matchedPrefixes: string[] = []
      if (prefixesRegex) {
        let match = lowercase.match(prefixesRegex)
        if (match) {
          matchedPrefixes = [match[0]]
        }
      } else {
        matchedPrefixes = prefixes.filter(x => lowercase.startsWith(x))
      }

      for (let prefix of matchedPrefixes) {
        for (let interp of this.lookup(lowercase.substr(prefix.length))) {
          if (!test || test(interp)) {
            interp.lemma = prefix + interp.lemma
            if (postprocess) {
              postprocess(interp)
            }
            if (!fromDict.has(interp)) {
              interp.setIsAuto()
              yield interp
            }
          }
        }
      }
    }
  }

  private fromGH(lookupees: Iterable<string>) {
    let ret = mu<MorphInterp>()
    for (let lookupee of lookupees) {
      let fricativized = lookupee.replace(/ґ/g, 'г').replace(/Ґ/g, 'Г')
      let diffs = algo.findStringDiffIndexes(lookupee, fricativized)
      if (diffs.length) {
        ret = ret.chain(this.lookup(fricativized)
          .filter(interp => diffs.every(i => /г/gi.test(interp.lemma!.charAt(i))))
          .map(x => {
            let chars = [...x.lemma!]
            diffs.forEach(i => chars[i] = stringUtils.replaceCaseAware(chars[i], /г/gi, 'ґ'))
            x.lemma = chars.join('')
            return x.setIsAuto()
          }))
      }
    }
    return ret
  }

  private buildNumeralMap() {
    let supermap = [
      [1, 'перший'],
      [2, 'другий'],
      [3, 'третій'],
      [4, 'четвертий'],
      [5, 'п’ятий'],
      [6, 'шостий'],
      [7, 'сьомий'],
      [8, 'восьмий'],
      [9, 'дев’ятий'],
      [0, 'десятий'],
    ] as [number, string][]

    // let uniquerSet = new Set<string>()
    for (let [digit, lemma] of supermap) {
      let lexemes = this.dictionary.lookupLexemesByLemma(lemma)
      for (let lexeme of lexemes) {
        for (let {form, flags} of lexeme) {
          let interp = MorphInterp.fromVesumStr(flags)
          if (!interp.isPronoun()) {
            interp.features.degree = undefined
            // let hash = `${} ${} ${} $`
            this.numeralMap.push({ digit, form, interp, lemma })
            // interp = interp.clone().setIsAdjectiveAsNoun().setIsAnimate(false)
            // this.numeralMap.push({ digit, form, interp, lemma })
          }
        }
      }
    }
  }
}



//------------------------------------------------------------------------------
const allUkUppercaseWchar = new RegExp(`^[${WCHAR_UK_UPPERCASE}]+$`)
function varyLetterCases(value: string) {
  let lowercase = value.toLowerCase()
  let ret = [lowercase]
  if (lowercase !== value) {
    ret.push(value)
    if (value.length > 1 && allUkUppercaseWchar.test(value)) {
      ret.push(capitalizeFirst(lowercase))
    }
  }

  return ret
}

//------------------------------------------------------------------------------
const ignoreLemmas = new Set(['ввесь', 'його', 'її', 'весь', 'увесь', 'який'])
function* expandInterp(expandAdjectivesAsNouns: boolean, flags: string, lemma: string) {
  yield flags
  if (expandAdjectivesAsNouns && flags.includes('adj:') && !flags.includes('beforeadj')) {
    if (!ignoreLemmas.has(lemma)) {
      let suffixes = flags.includes(':p:')
        ? ['anim:m', 'anim:f', 'anim:n', 'anim:ns', 'inanim:m', 'inanim:f', 'inanim:n', 'inanim:ns']
        : ['anim', 'inanim']
      yield* suffixes.map(x => flags + ':&noun:' + x)
    } else if (['весь', 'увесь'].includes(lemma) && flags.includes(':p:')) {
      yield flags + ':&noun:anim:ns'
    }
  }
}

//------------------------------------------------------------------------------
function capitalizeFirst(value: string) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}


/*

1,2,5

20-ті
20-х
20-их
20-тих
20-ми

5-та
5-й
5-ий
125-ій
1920-й
1920-му


*/
