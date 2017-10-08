#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'

import * as glob from 'glob'
import * as minimist from 'minimist'
import * as mkdirp from 'mkdirp'
import * as columnify from 'columnify'
import * as _ from 'lodash'

import * as g from './uk_grammar'

import { parseXmlFileSync } from '../../xml/utils.node'
import { escape } from '../../xml/utils'
import { mixml2tokenStream, tokenStream2sentences } from '../../nlp/utils'
import * as algo from '../../algo'
import { parseJsonFromFile } from '../../utils.node'
import { last } from '../../lang'
import { Dict } from '../../types'
// import { toUdString, toUd } from './tagset'
import { Token } from '../../nlp/token'
import { MorphInterp } from '../../nlp/morph_interp'
import { sentence2conllu, uEq } from './utils'
import { mu } from '../../mu'
import { validateSentenceSyntax } from './validation'
import { zerofillMax } from '../../string_utils'
import { toSortableDatetime } from '../../date'
import { createMorphAnalyzerSync } from '../morph_analyzer/factories.node'



//------------------------------------------------------------------------------
interface Args {
  _: string[]
  dryRun: boolean
  noStandartizing: boolean
  includeIncomplete: boolean
  oneSet: string

  datasetSchema: string
  datasetReroute: string  // --datasetReroute "->train test->train"
  reportHoles: boolean
  reportErrors: 'all' | 'complete' | 'none'
  validOnly: boolean
  morphonlyThreshold: string
  xpos: any


  id2bratPath: string
}

//------------------------------------------------------------------------------
class Dataset {
  file: number
  counts = {
    tokensInUnfinishedSentenses: 0,
    tokensBlocked: 0,
    tokensExported: 0,
    sentencesExported: 0,
  }
  newdoc = false
}

//------------------------------------------------------------------------------
function getArgs() {
  return minimist(process.argv.slice(2), {
    boolean: [
      'noStandartizing',
      'includeIncomplete',
      'dryRun',
      'reportHoles',
      'onlyValid',
    ],
    alias: {
      oneSet: 'one-set',
      noStandartizing: 'no-std',

      datasetSchema: 'dataset-schema',
      validOnly: 'valid-only',
      reportHoles: 'report-holes',
      reportErrors: 'report-errors',
    },
    default: {
      reportErrors: 'all',
      reportHoles: true,
      datasetSchema: '',
      morphonlyThreshold: '0',
      datasetReroute: '',
    }
  }) as Args
}

//------------------------------------------------------------------------------
function main() {
  let args = getArgs()

  let [globStr, outDir] = args._
  let xmlPaths = glob.sync(globStr)
  if (!xmlPaths.length) {
    return
  }

  let id2bratPath = args.id2bratPath
    ? parseJsonFromFile(args.id2bratPath)
    : {}

  let rerouteMap = createDatasetRerouteMap(args.datasetReroute)
  console.log(`Reroutes:`)
  console.log(rerouteMap)

  mkdirp.sync(outDir)

  const analyzer = createMorphAnalyzerSync()

  let openedFiles = {} as any
  let datasetRegistry = {} as Dict<Dataset>
  let datasetRegistryMorpho = {} as Dict<Dataset>
  let sentenseErrors = []
  let sentenseHoles = []
  for (let xmlPath of xmlPaths) {
    let basename = path.basename(xmlPath)

    console.log(`exporting ${basename}`)

    let root = parseXmlFileSync(xmlPath)
    let tokenStream = mu(mixml2tokenStream(root, args.datasetSchema))
      .transform(x => x.interp && g.denormalizeInterp(x.interp))
    let sentenceStream = tokenStream2sentences(tokenStream)
    let annotationalGap = false
    for (let { sentenceId, dataset, tokens, nodes,
      opensDocument, currenctDocument, followsGap } of sentenceStream) {

      dataset = args.oneSet || rerouteMap.get(dataset || '') || dataset || 'unassigned'
      datasetRegistry[dataset] = datasetRegistry[dataset] || new Dataset()

      let numTokens = tokens.length
      let roots = mu(tokens).findAllIndexes(x => !x.hasDeps()).toArray()
      let numComplete = numTokens - roots.length + 1
      let isComplete = roots.length === 1
      let percentComplete = numTokens === 1
        ? 1
        : 1 - ((roots.length - 1) / (numTokens - 1))
      let hasMorphErrors = tokens.some(x => x.interp.isError())
      if (hasMorphErrors) {
        annotationalGap = true
        continue
      }

      let sentenceLevelData = {
        'sent_id': sentenceId,
        'newpar': tokens[0].opensParagraph || undefined,
        'newdoc': opensDocument || undefined,
        'gap': (followsGap || annotationalGap && !opensDocument) || undefined
      } as any
      if (opensDocument) {
        sentenceLevelData.doc_title = currenctDocument.getAttribute('title') || undefined
      }
      // todo: consider making newpar on gaps

      if (percentComplete) {
        let bratPath = id2bratPath[tokens[0].id] || ''
        if (!roots.length) {
          datasetRegistry[dataset].counts.tokensBlocked += numComplete
          datasetRegistry[dataset].counts.tokensInUnfinishedSentenses += numTokens
          sentenseErrors.push({
            sentenceId,
            problems: [{ message: 'цикл' }],
            tokens,
            bratPath,
          })
          continue
        } else if (!isComplete && args.reportHoles) {
          sentenseHoles.push({
            sentenceId,
            problems: [{ message: 'речення недороблене', indexes: roots }],
            tokens,
            bratPath,
          })
        }

        let hasProblems = false
        if (args.reportErrors === 'all' || args.reportErrors === 'complete' && isComplete || args.validOnly) {
          let problems = validateSentenceSyntax(nodes, analyzer)
          hasProblems = !!problems.length
          if (hasProblems && args.reportErrors) {
            sentenseErrors.push({
              problems,
              sentenceId,
              tokens,
              bratPath,
            })
          }
        }

        if (args.dryRun) {
          continue
        } else if (args.validOnly && hasProblems) {
          datasetRegistry[dataset].counts.tokensBlocked += numComplete
          datasetRegistry[dataset].counts.tokensInUnfinishedSentenses += numTokens
        } else {
          if (isComplete || args.includeIncomplete) {
            ++datasetRegistry[dataset].counts.sentencesExported
            datasetRegistry[dataset].counts.tokensExported += numTokens
            if (!args.noStandartizing) {
              g.standartizeSentence2ud21(nodes)
            }

            let filename = set2filename(outDir, args.datasetSchema || 'mi', dataset)
            let file = openedFiles[filename] = openedFiles[filename] || fs.openSync(filename, 'w')
            let conlluedSentence = sentence2conllu(tokens, sentenceLevelData, { xpos: args.xpos })
            fs.writeSync(file, conlluedSentence + '\n\n')
            datasetRegistry[dataset].newdoc = false
            annotationalGap = false
          } else {
            datasetRegistry[dataset].counts.tokensBlocked += numComplete
            datasetRegistry[dataset].counts.tokensInUnfinishedSentenses += numTokens
          }
        }
      }

      if (args.dryRun) {
        continue
      }

      datasetRegistryMorpho[dataset] = datasetRegistryMorpho[dataset] || new Dataset()

      let morphonlyThreshold = Number.parseFloat(args.morphonlyThreshold)
      if (percentComplete >= morphonlyThreshold) {
        standartizeMorpho(tokens)
        let filename = path.join(outDir, `uk-mi-${dataset}.morphonly.conllu`)
        let file = openedFiles[filename] = openedFiles[filename] || fs.openSync(filename, 'w')
        let conlluedSentence = sentence2conllu(tokens, sentenceLevelData, { morphOnly: true })
        fs.writeSync(file, conlluedSentence + '\n\n')

        ++datasetRegistryMorpho[dataset].counts.sentencesExported
        datasetRegistryMorpho[dataset].counts.tokensExported += numTokens
      } else {
        datasetRegistryMorpho[dataset].counts.tokensInUnfinishedSentenses += numTokens
      }
    }
  }

  writeErrors(sentenseErrors, sentenseHoles, outDir)
  printStats(datasetRegistry, 'synt')
  printStats(datasetRegistryMorpho, 'morpho')
  console.log()
}

//==============================================================================
function writeErrors(sentenseErrors, sentenseHoles, outDir: string) {
  if (sentenseErrors.length) {
    sentenseErrors = transposeProblems(sentenseErrors)
    fs.writeFileSync(path.join(outDir, 'errors.html'), formatProblemsHtml(sentenseErrors))
  }

  if (sentenseHoles.length) {
    let comparator = algo.chainComparators<any>(
      // (a, b) => b.tokens.filter(x => x.hasDeps()).length - a.tokens.filter(x => x.hasDeps()).length,
      (a, b) => (a.problems[0].indexes.length - 1) / a.tokens.length
        - (b.problems[0].indexes.length - 1) / b.tokens.length,
      (a, b) => a.problems[0].indexes.length - b.problems[0].indexes.length,
      (a, b) => b.tokens.length - a.tokens.length,  // prefer longer sents
      algo.indexComparator(sentenseHoles),  // for stability
    )
    sentenseHoles.sort(comparator)
    fs.writeFileSync(path.join(outDir, 'holes.html'), formatProblemsHtml(sentenseHoles))
  }
}

//------------------------------------------------------------------------------
function transposeProblems(problems: any[]) {
  let problemsByType = []
  for (let sentence of problems) {
    for (let problem of sentence.problems || []) {
      let sentWithOneProblem = { ...sentence }
      sentWithOneProblem.problems = [problem]
      problemsByType.push(sentWithOneProblem)
    }
  }
  problemsByType = _.sortBy(problemsByType, x => x.problems[0].message)

  return problemsByType
}

//------------------------------------------------------------------------------
function printStats(datasetRegistry: Dict<Dataset>, header: string) {
  let stats = Object.entries(datasetRegistry)
    .map(([set, { counts: { tokensBlocked, tokensExported, tokensInUnfinishedSentenses, sentencesExported } }]) => ({
      set,
      'blocked': tokensBlocked,
      'holes': tokensInUnfinishedSentenses - tokensBlocked,
      'exported': tokensExported,
      'exported s': sentencesExported,
    }))
  stats.push({
    set: 'TOTAL',
    'blocked': stats.map(x => x['blocked']).reduce((a, b) => a + b, 0),
    'holes': stats.map(x => x['holes']).reduce((a, b) => a + b, 0),
    'exported': stats.map(x => x['exported']).reduce((a, b) => a + b, 0),
    'exported s': stats.map(x => x['exported s']).reduce((a, b) => a + b, 0),
  })

  console.log(`\n${header}`)
  console.log(columnify(stats, {
    config: {
      align: 'right',
      blocked: {
        align: 'right',
      },
      exported: {
        align: 'right',
      },
      holes: {
        align: 'right',
      },
      'exported s': {
        align: 'right',
      },
    },
  }))
  // console.log(`\n`)
}

//------------------------------------------------------------------------------
function formatProblemsHtml(sentenceProblems: any[]) {
  let body = ''
  for (let [i, { sentenceId, problems, tokens, bratPath }] of sentenceProblems.entries()) {
    let href = `https://lab.mova.institute/brat/#/ud/${bratPath}`
    let problemNumber = zerofillMax(i + 1, sentenceProblems.length)

    body += `<div><b>№${problemNumber}</b> реч#${sentenceId}: <a href="${href}" target="_blank">${bratPath}</a><br/>`
    for (let { indexes, message } of problems) {
      body += `<p class="message">- ${escape(message)}`
      if (indexes !== undefined) {
        let ids = indexes.map(x => tokens[x].id).join(` `)
        body += ` @ ${ids}</p>`

        for (let j = 0; j < tokens.length; ++j) {
          if (indexes.includes(j)) {
            body += `<span class="error">${escape(tokens[j].getForm())}</span> `
          } else {
            body += `${tokens[j].getForm()} `
          }
        }
      } else {
        body += `</p>`
      }
      body += `<br/><br/>`
    }
    body += `</div><hr/>\n`
  }

  let timestamp = toSortableDatetime(new Date())

  return `<html><head><style>
    html { padding: 3em; font-size: 14px; font-family: "Lucida Console", Menlo, Monaco, monospace; }
    .error { padding: 0.25em; border: 2px solid #FFAB40; color: #555; }
    .message { color: #555; margin-left:-2ch; }
  </style></head><body>
  <p style="margin-top:-2em;">створено: <b>${timestamp}</b> (час київський)</p>
  <br/>
  <br/>
  ${body}
  </body></html>`
}

//------------------------------------------------------------------------------
function set2filename(dir: string, setSchema: string, setName: string) {
  return path.join(dir, `uk-${setSchema}-${setName}.conllu`)
}

//------------------------------------------------------------------------------
// const FOREIGN = MorphInterp.fromVesumStr('x:foreign')
function standartizeMorpho(sentence: Array<Token>) {
  for (let token of sentence) {
    g.standartizeMorphoForUd21(token.interp, token.form)

    // token.interp.killNongrammaticalFeatures()
    token.interp.setIsAuxillary(false)

    if (token.interp.isForeign()) {
      token.interps = [MorphInterp.fromVesumStr('x:foreign', token.interp.lemma)]
    }

    if (token.interp.isTypo()) {
      let correction = token.getAttribute('correct')
      if (correction) {
        token.form = correction
        token.interp.setIsTypo(false)
      } else {
        console.error(`No typo correction for ${token}`)
      }
    }

    if (token.interp.isAdjectiveAsNoun() && token.interp.isOrdinalNumeral()) {
      token.interp.setIsOrdinalNumeral(false)
    }

    if (token.interp.lemma === 'бути' && ['є', 'Є'].includes(token.form) && token.interp.isVerb()) {
      token.interp.features.person = undefined
      token.interp.features.number = undefined
    }
  }
}

//------------------------------------------------------------------------------
function createDatasetRerouteMap(definition: string) {
  let pairs = definition.trim().split(/\s+/g).map(x => x.split('->')) as [string, string][]
  return new Map<string, string>(pairs)
}


////////////////////////////////////////////////////////////////////////////////
if (require.main === module) {
  main()
}
