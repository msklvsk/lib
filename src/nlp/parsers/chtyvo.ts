import { join } from 'path'
import { readFileSync, existsSync } from 'fs'

import { sync as globSync } from 'glob'
import { decode } from 'iconv-lite'
import { AbstractElement } from 'xmlapi'

import { renameTag } from '../../xml/utils'
import { parseHtmlFileSync, parseHtml } from '../../xml/utils.node'
import { normalizeCorpusTextString, string2tokenStream } from '../utils'
import { MorphAnalyzer } from '../morph_analyzer/morph_analyzer'
import { Token } from '../token'
import { DocumentStructure } from '../../corpus_workflow/registry'
import { mu } from '../../mu'

const detectCharacterEncoding = require('detect-character-encoding');



////////////////////////////////////////////////////////////////////////////////
export function* streamChtyvo(workspace: string, analyzer: MorphAnalyzer) {
  let metas = globSync(join(workspace, '**/*.meta.html'))
  // let set = new Set<string>()
  for (let metaPath of metas) {
    try {
      let basePath = metaPath.slice(0, -'.meta.html'.length)
      let format = ['txt', 'htm', 'fb2'].find(x => existsSync(`${basePath}.${x}`))
      if (!format) {
        // console.log(`format not supported ${basePath}`)
        continue
      }
      let dataPath = `${basePath}.${format}`

      console.log(`processing ${dataPath}`)

      let metaRoot = parseHtmlFileSync(metaPath)
      let meta = extractMeta(metaRoot)
      if (meta.isForeign) {
        console.log(`foreign`)
        continue
      }
      if (!meta.title) {
        console.log(`no title`)
        continue
      }

      let content = readFileSyncAutodetect(dataPath)
      if (!content) {
        console.log(`bad encoding`)
        continue
      }

      if (format === 'fb2') {
        content = renameTag('poem', 'p', content)
        content = renameTag('stanza', 'lg type="stanza"', content)
        content = renameTag('v', 'l', content)
        let root = parseHtml(content)
        mu(root.evaluateElements('//a[@type="notes"]')).toArray().forEach(x => x.remove())
        let paragraphs = mu(root.evaluateElements('//body[not(@name) or @name!="notes"]//p'))
          // todo: inline verses
          .map(x => normalizeCorpusTextString(x.text().trim()))
          .filter(x => x && !/^\s*(©|\([cс]\))/.test(x))  // todo: DRY
          .toArray()
        // console.log(paragraphs)
        yield* yieldParagraphs(paragraphs, meta, analyzer)
      }
      // else if (true) { continue }
      else if (format === 'htm') {
        let root = parseHtml(content)
        let paragraphsIt = root.evaluateElements(
          // '//p[not(@*) and not(descendant::a) and preceding::h2[descendant::*/text() != "Зміст"]]')
          '//p[not(@*) and not(descendant::*) or @class="MsoNormal"]')
          .map(x => normalizeText(x.text()).replace(/\n+/g, ' '))
          .filter(x => x && !/^\s*(©|\([cс]\))/.test(x))
        let paragraphs = [...paragraphsIt]
        yield* yieldParagraphs(paragraphs, meta, analyzer)
      } else if (format === 'txt') {
        content = extractTextFromTxt(content)
        content = normalizeText(content)
        content = content.replace(/\n+/g, '\n').trim()

        let paragraphs = content.split(/\s*\n\s*/)
        yield* yieldParagraphs(paragraphs, meta, analyzer)
      } else {
        console.log(`skipping (format not supported yet)`)
      }
    } catch (e) {
      console.error(`errr ${metaPath}`)
      console.error(e.stack)
    }
  }
}

type chtyvoSection =
  'Химерна' |
  'Художня' |
  'Історична' |
  'Народна' |
  'Дитяча' |
  'Наукова' |
  'Навчальна' |
  'Детективи' |
  'Пригоди' |
  'Релігія' |
  'Публіцистика' |
  'Гумор' |
  'Любовна' |
  'Часописи'

const typeMap = {
  'Химерна': '',
  'Художня': '',
  'Історична': '',
  'Народна': '',
  'Дитяча': '',
  'Наукова': '',
  'Навчальна': '',
  'Детективи': '',
  'Пригоди': '',
  'Релігія': '',
  'Публіцистика': '',
  'Гумор': '',
  'Любовна': '',
  'Часописи': '',
}

//------------------------------------------------------------------------------
function extractMeta(root: AbstractElement) {
  let year = getTableValue(root, 'Написано')
  year = year.split(/\s/)[0]

  let title = getTextByClassName(root, 'h1', 'book_name')

  let translator = root.evaluateString('string(//div[@class="translator_pseudo_book"]/a/text())')
  let originalAutor = root.evaluateString('string(//div[@class="author_name_book"]/a/text())')


  let documentType = getTextByClassName(root, 'div', 'book_type') as chtyvoSection

  let section = root.evaluateString(
    `string(//table[@class="books"]//strong[text()="Розділ:"]/parent::*/following-sibling::td/a/text())`)

  let url = root.evaluateString('string(//meta[@property="og:url"]/@content)')

  let isForeign = /\([а-яєґїі]{2,8}\.\)$/.test(title)

  return {
    reference_title: title,
    title,
    date: year,
    author: translator || originalAutor,
    original_autor: translator && originalAutor || undefined,
    // type:
    domain: section === 'Історична' ? 'історія' : undefined,
    disamb: 'жодного' as 'жодного',  // todo
    documentType,
    section,
    url,
    isForeign,
  }
}

//------------------------------------------------------------------------------
function getTableValue(root: AbstractElement, key: string) {
  return root.evaluateString(
    `string(//table[@class="books"]//strong[text()="${key}:"]/parent::*/following-sibling::td/text())`)
}

//------------------------------------------------------------------------------
function getTextByClassName(root: AbstractElement, elName: string, className: string) {
  return root.evaluateString(`string(//${elName}[@class="${className}"]/text())`)
}

//------------------------------------------------------------------------------
function hasSmashedEncoding(str: string) {
  return !str.includes('і') || str.includes('Ђ')
}

//------------------------------------------------------------------------------
function readFileSyncAutodetect(path: string) {
  let bytes = readFileSync(path)
  let encoding = detectCharacterEncoding(bytes).encoding
  let content = decode(bytes, encoding)
  if (!hasSmashedEncoding(content)) {
    return content
  }
}

//------------------------------------------------------------------------------
function extractTextFromTxt(str: string) {
  return str.replace(/^[\s\S]{0,300}-{9,}/, '')
    .replace(/[\s\-]*КІНЕЦЬ[\s\S]{0,400}$/, '')
    .replace(/-{4,}[\s\S]{0,400}$/, '')
    .replace(/-{5,}[\s\S]+(Бібліографія|Примітки:)([\s\S]{0,10000}|(\[\d+\])+\s+[^\n]+(\n|$))$/, '')
}

//------------------------------------------------------------------------------
function killReferences(str: string) {
  return str.replace(/\s\[\d+\]/g, '')
}

//------------------------------------------------------------------------------
function normalizeText(str: string) {
  let ret = normalizeCorpusTextString(str)
  ret = killReferences(ret)
  return ret.trim()
}

//------------------------------------------------------------------------------
function* yieldParagraphs(paragraphs: string[], meta: DocumentStructure, analyzer: MorphAnalyzer) {
  meta.disamb = 'жодного'
  if (paragraphs.length) {
    yield Token.structure('document', false, meta)
    for (let p of paragraphs) {
      yield Token.structure('paragraph', false)
      yield* string2tokenStream(p, analyzer)
      yield Token.structure('paragraph', true)
    }
    yield Token.structure('document', true)
  }
}

//------------------------------------------------------------------------------
function prepareDocumentMeta(meta) {

}


/*

Альбом
Альманах
Байка
Газета
Довідник
Документ
Драма
Енциклопедія
Есей
Журнал
Казка
Каталог
Комедія
Комікс
Легенда/Міт
Нарис
Не визначено
Новела
Оповідання
П'єса
Підручник
Повість
Поезія
Поема
Посібник
Праця
Притча
Рецензія
Роман
Словник
Спогади
Стаття


Байка
Довідник
Документ
Драма
Енциклопедія
Есей
Казка
Комедія
Нарис
Не визначено
Новела
Оповідання
П'єса
Підручник
Повість
Поезія
Поема
Посібник
Праця
Роман
Словник
Спогади
Стаття



закон
художня проза
  казка

поезія
публіцистика

*/




/*

find . -name "*.zip" | while read filename; do unzip -o -d "`dirname "$filename"`" "$filename"; done;

*/
