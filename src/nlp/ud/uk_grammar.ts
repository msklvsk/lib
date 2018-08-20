import { GraphNode, walkDepthNoSelf, walkDepth } from '../../graph'
import { Token, buildDep, buildEDep } from '../token'
import { MorphInterp } from '../morph_interp'
import * as f from '../morph_features'
import { uEq, uEqSome, stripSubrel } from './utils'
import { mu } from '../../mu'
import { last, wiith } from '../../lang'
import { UdPos, toUd } from './tagset'
import { ValencyDict } from '../valency_dictionary/valency_dictionary'
import { SimpleGrouping } from '../../grouping'
import { compareAscending, clusterize } from '../../algo';

export type TokenNode = GraphNode<Token>
export type Node2indexMap = Map<TokenNode, number>



////////////////////////////////////////////////////////////////////////////////
export function isPromoted(node: TokenNode) {
  return node.parents.some(p => p.node.isElided())
}

////////////////////////////////////////////////////////////////////////////////
export function isNonprojective(node: TokenNode) {
  let indexes = mu(walkDepth(node))
    .map(x => x.node.index)
    .toArray()
    .sort(compareAscending)

  for (let i = 1; i < indexes.length; ++i) {
    if (indexes[i] - indexes[i - 1] !== 1) {
      return true
    }
  }

  return false
}

////////////////////////////////////////////////////////////////////////////////
// http://universaldependencies.org/u/overview/enhanced-syntax.html
export function generateEnhancedDeps(
  nodes: Array<TokenNode>,
  corefClusterization: SimpleGrouping<Token>,
) {

  // 1: build enhanced **tree**: basic, but with null nodes
  for (let node of nodes) {
    // 1.1: copy basic edges that don't touch promoted tokens
    if (!isPromoted(node)) {
      node.node.edeps.push(...node.node.deps)
    }

    // 1.2: add deps touching elided tokens
    // UD: “Null nodes for elided predicates”
    {
      let elisionDeps = node.node.deps
        .filter(x => node.node.isElided() || nodes[x.headIndex].node.isElided())
      node.node.edeps.push(...elisionDeps)
    }
  }

  for (let node of nodes) {
    // sent_id = 3bgj do not distribute to promoted!!
    // todo: dislocated!
    // todo: у такому становищі [є] один крок для того — в enhanced інший корінь!
    //       https://lab.mova.institute/brat/#/ud/vislotska__kohannia/30
    // todo: fix duplicate edeps
    // todo: filter elided? e.g. 20:nsubj|20.1:nsubj
    // todo: test nested conj
    // todo: check conj paths are followed
    // todo: 5-10 м/с не конж
    // todo: do everything on enhanced tree after propagation of conjuncts??
    // todo: secondary predication


    // 2: propagation of conjuncts
    if (uEq(node.node.rel, 'conj') && node.node.rel !== 'conj:parataxis') {
      // 2.1: conjuncts are governors (easy): _She was watching a movie or reading._
      // todo: share marks and stuff?
      // todo: only for verbs?
      let conj0 = node.parent
      let shared = conj0.children.filter(x => x !== node
        && x.node.helperDeps.some(helperDep =>
          helperDep.headId === conj0.node.id && (helperDep.relation === 'distrib'
            || helperDep.relation === 'collect' // ~, todo
          )
        ))
      for (let t of shared) {
        t.node.edeps.push(buildEDep(node.node, t.node.rel))
      }

      // 2.2: conjuncts are dependents (harder): _a long and wide river_
      let conjHead = node.ancestors0().find(x => !uEq(x.node.rel, 'conj'))
      if (conjHead.parent) {
        let newRel = findRelationAnalog(node, conjHead)
        if (newRel) {
          // todo: do not strip?
          node.node.edeps.push(buildDep(conjHead.parent.node, newRel))
        }
      }
    }

    // 3: `xcomp` subject
    // UD: “Additional subject relations for control and raising constructions”
    // todo: Mary and John wanted to buy a hat.
    if (uEq(node.node.rel, 'xcomp')) {
      let subj = findXcompSubject(node)
      if (subj) {
        let rel = uEqSome(subj.node.rel, ['obj', 'iobj']) ? 'nsubj' : subj.node.rel
        subj.node.edeps.push(buildEDep(node.node, rel))
      }
    }

    // 4: coreference in relative clause constructions
    // todo: adv?
    // todo: дівчина, що її
    // todo: check deep backward
    let relRoot = findRelativeClauseRoot(node)
    if (relRoot) {
      if (node.node.interp.isRelative()) {
        handleRelcl(relRoot, node)
      } else {
        let antecedent = findShchojijiAntecedent(node)
        if (antecedent && corefClusterization.areSameGroup(antecedent.node, node.node)) {
          handleRelcl(relRoot, node)
        }
      }
    }

    // (5): secondary predication advcl
    if (isSecondaryPredication(node.node.rel)) {
      if (node.node.rel === 'advcl:sp') {
        let subj = node.parent.children.find(x => uEqSome(x.node.rel, SUBJECTS))
        // || node.parent.children.find(x => uEqSome(x.node.rel, COMPLEMENTS))
        if (subj) {
          subj.node.edeps.push(buildDep(node.node, subj.node.rel))
        }
      }
    }
  }
}

//------------------------------------------------------------------------------
function handleRelcl(relRoot: TokenNode, node: TokenNode) {
  let antecedent = relRoot.parent

  // add `ref`
  node.node.edeps.push(buildDep(antecedent.node, 'ref'))

  if (relRoot === node) {
    // https://github.com/UniversalDependencies/docs/issues/531
    // He became chairman, which he still is.
    // We should […] add a nsubj relation from the antecedent
    //   to the nsubj of the relative pronoun.
    let subject = node.children.find(x => uEqSome(x.node.rel, ['nsubj'/* , 'csubj' */]))
    if (subject) {
      // todo: csubj?
      subject.node.edeps.push(buildDep(antecedent.node, 'nsubj'))
    } else {
      throw new Error(`Notice this!`)
    }
  } else {
    // backward
    if (node.node.rel !== 'advmod'/*  && relRoot.children.some(x => x === node) */) {
      // let headOfTheRelative = node.parent
      let rel = node.node.rel
      if (antecedent.node.interp.isNounish() && uEq(node.node.rel, 'det')) {
        // Сергія, чию смерть
        rel = 'nmod'
      }
      antecedent.node.edeps.push(buildDep(node.parent.node, rel))
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
export function isSecondaryPredication(rel: string) {
  return rel === 'advcl:sp' || rel === 'xcomp:sp'
}

//------------------------------------------------------------------------------
function findRelationAnalog(newDependent: TokenNode, existingDependent: TokenNode) {
  let { pos: newDepPos } = toUd(newDependent.node.interp)
  let { pos: existingDepPos } = toUd(existingDependent.node.interp)
  let existingRel = existingDependent.node.rel
  newDepPos = dumbDownUdPos(newDepPos)
  existingDepPos = dumbDownUdPos(existingDepPos)


  if (newDependent.node.interp.isX()) {
    // what else can we do?..
    return existingRel
  }

  if (uEqSome(existingRel, [
    'cop',
    'aux',
    'mark',
    'case',
    'dep',
    'cc',
    'vocative',
    'xcomp',  // ~
    'appos',  // ~
  ])) {
    return existingRel
  }

  if (uEq(existingRel, 'obl') && newDependent.node.interp.isAdverb()) {
    // todo: виколоти і т.д.
    return 'advmod'
  }
  if (uEq(existingRel, 'advmod') && newDependent.node.interp.isNounish()) {
    // todo: то там, то сям, то те, то се; скрізь і всім допомагати
    return 'obl'
  }
  if (uEq(existingRel, 'amod') && newDepPos === 'DET') {
    return 'det'
  }
  if (uEqSome(existingRel, ['amod', 'det']) && newDependent.node.interp.isNounish()) {
    return 'nmod'
  }
  if (uEq(existingRel, 'det') && newDepPos === 'ADJ') {
    return 'amod'
  }

  if (uEqSome(existingRel, CLAUSAL_MODIFIERS) && definitelyIsPredicate(newDependent)) {
    return existingRel
  }

  if (uEq(existingRel, 'advcl')
    && existingDependent.node.interp.isConverb()
    && newDependent.node.interp.isAdjective()
  ) {
    return 'advcl:sp'
  }

  for (let [clausal, plain] of CLAUSAL_TO_PLAIN) {
    if (uEq(existingRel, clausal)
      && !definitelyIsPredicate(newDependent)
      && !newDependent.node.interp.isVerbial()
    ) {
      // return plain
    }
    if (uEq(existingRel, plain) && definitelyIsPredicate(newDependent)) {
      // return clausal
    }
  }

  if (newDepPos === existingDepPos) {
    return existingRel  // risky
  }

  return existingRel  // last resort

  // todo: state it doesn't work without gap filling
  // todo: хто і як слухатиме його
}

const CLAUSAL_TO_PLAIN = new Map([
  ['csubj', 'nsubj'],
  ['ccomp', 'obj'],
  ['advcl', 'adv'],
])

//------------------------------------------------------------------------------
function definitelyIsPredicate(node: TokenNode) {
  return hasChild(node, 'nsubj')
    || hasChild(node, 'csubj')
    || hasChild(node, 'cop')
}

//------------------------------------------------------------------------------
function dumbDownUdPos(upos: UdPos) {
  if (upos === 'PROPN' || upos === 'PRON') {
    return 'NOUN'
  }
  return upos
}

////////////////////////////////////////////////////////////////////////////////
export function findXcompSubject(node: TokenNode) {
  let topParent = node.ancestors0().find(x =>
    !uEqSome(x.node.rel, ['xcomp', 'conj'])/*  || x.node.rel === 'conj:parataxis' */)

  return mu(['obj', 'iobj', 'nsubj', 'csubj'])
    .map(r => topParent.children.find(x => uEq(x.node.rel, r)))
    .filter(x => x)
    .first()
}

////////////////////////////////////////////////////////////////////////////////
export function isRootOrHole(node: TokenNode) {
  return !node.node.deps.some(x => !uEq(x.relation, 'orphan'))
  // || !node.parents.every(x => hasChild(x, 'orphan')
  //   && !x.parents.some(xx => xx.node.isElided()))
}

////////////////////////////////////////////////////////////////////////////////
export function findClauseRoot(node: TokenNode) {
  return mu(node.walkThisAndUp0())
    .find(x => uEqSome(x.node.rel, CLAUSE_RELS))
}

////////////////////////////////////////////////////////////////////////////////
export function findRelativeClauseRoot(relative: TokenNode) {
  // if (!relative.node.interp.isRelative()) {
  //   return
  // }
  let clauseRoot = findClauseRoot(relative)
  if (!clauseRoot) {
    return
  }
  if (uEq(clauseRoot.node.rel, 'acl')) {
    return clauseRoot
  }

  if (clauseRoot.node.interp.isInfinitive()) {
    clauseRoot = mu(clauseRoot.walkUp0())
      .find(x => uEqSome(x.node.rel, CLAUSE_RELS))
  }

  if (clauseRoot && uEq(clauseRoot.node.rel, 'acl')) {
    return clauseRoot
  }
}

////////////////////////////////////////////////////////////////////////////////
export function findShchojijiAntecedent(node: TokenNode) {
  if (!node.node.interp.isPersonal() || !node.node.interp.isNounish()) {
    return
  }
  let clauseRoot = findRelativeClauseRoot(node)
  if (!clauseRoot) {
    return
  }
  if (clauseRoot.parent
    && clauseRoot.children.some(x => x.node.interp.lemma === 'що' && uEq(x.node.rel, 'mark'))
    && clauseRoot.parent.node.interp.equalsByFeatures(node.node.interp, [f.MorphNumber, f.Gender])
  ) {
    return clauseRoot.parent
  }
}

////////////////////////////////////////////////////////////////////////////////
export function isDativeValencyAdjective(t: Token) {
  return t.interp.isAdjective() && (
    DAT_VALENCY_ADJECTIVES.has(t.interp.lemma)
    || DAT_VALENCY_ADJECTIVES.has('не' + t.interp.lemma)
  )
}

////////////////////////////////////////////////////////////////////////////////
export function isValencyHavingAdjective(t: Token) {
  return t.interp.isAdjective()
    && (
      DAT_VALENCY_ADJECTIVES.has(t.interp.lemma)
      || GEN_VALENCY_ADJECTIVES.has(t.interp.lemma)
    )
}

////////////////////////////////////////////////////////////////////////////////
export function isInfValencyAdjective(t: Token) {
  return t.interp.isAdjective()
    && INF_VALENCY_ADJECTIVES.includes(t.interp.lemma)
}

////////////////////////////////////////////////////////////////////////////////
export const PREDICATES = {
  isAuxWithNoCopAux(t: TokenNode) {
    return t.node.interp.isAuxillary()
      && t.parent
      && !['cop', 'aux'].some(x => uEq(t.node.rel, x))
  }
}

////////////////////////////////////////////////////////////////////////////////
export function isNumericModifier(rel: string) {
  return uEq(rel, 'nummod') || rel === 'det:nummod' || rel === 'det:numgov'
}

////////////////////////////////////////////////////////////////////////////////
export function isGoverning(relation: string) {
  return relation === 'nummod:gov' || relation === 'det:numgov'
}

////////////////////////////////////////////////////////////////////////////////
export function isNumeralModified(t: TokenNode) {
  return t.children.some(x => isNumericModifier(x.node.rel))
    || isQuantitativeAdverbModified(t)
}

////////////////////////////////////////////////////////////////////////////////
export function isQuantitativeAdverbModified(t: TokenNode) {
  return t.children.some(x => isQuantitativeAdverbModifier(x))
}

////////////////////////////////////////////////////////////////////////////////
export function isQuantitativeAdverbModifier(t: TokenNode) {
  return t.node.rel === 'advmod:amtgov'// && t.parent.node.interp.isGenitive()
}

////////////////////////////////////////////////////////////////////////////////
export function isQuantitativeAdverbModifierCandidate(t: TokenNode) {
  return !t.isRoot()
    && t.parent.node.interp.isGenitive()
    && uEq(t.node.rel, 'advmod')
    && QAUNTITATIVE_ADVERBS.includes(t.node.interp.lemma)
}

////////////////////////////////////////////////////////////////////////////////
export function thisOrGovernedCase(t: TokenNode) {
  let governer = t.children.find(x => isGoverning(x.node.rel))
  if (governer) {
    return governer.node.interp.features.case
  }
  return t.node.interp.features.case
}

////////////////////////////////////////////////////////////////////////////////
export function isNmodConj(t: TokenNode) {
  return uEq(t.node.rel, 'nummod')
    && t.node.interp.isInstrumental()
    && t.children.some(x => x.node.interp.isPreposition()
      && ['з', 'із', 'зі'].includes(x.node.interp.lemma)
    )
}

////////////////////////////////////////////////////////////////////////////////
export function hasNmodConj(t: TokenNode) {
  return t.children.some(x => isNmodConj(x))
}

////////////////////////////////////////////////////////////////////////////////
export function isNegativeExistentialPseudosubject(t: TokenNode) {
  return uEq(t.node.rel, 'nsubj')
    && t.node.interp.isGenitive()
    && t.parent.children.some(x => x.node.interp.isNegative())
    && t.parent.node.interp.isNeuter()
    && [...COPULA_LEMMAS, 'існувати', 'мати'].includes(t.parent.node.interp.lemma)
}

////////////////////////////////////////////////////////////////////////////////
export function isQuantificationalNsubj(t: TokenNode) {
  return uEq(t.node.rel, 'nsubj')
    && t.node.interp.isGenitive()
    && (t.parent.node.interp.isAdverb()
      && QAUNTITATIVE_ADVERBS.includes(t.parent.node.interp.lemma)
      || t.parent.node.interp.isCardinalNumeral()
      && t.parent.node.interp.isNominative()
    )
}

////////////////////////////////////////////////////////////////////////////////
export function isPunctInParenthes(t: TokenNode) {
  return t.node.interp.isPunctuation()
    && t.children.length === 2
    && t.children[0].node.form === '('
    && t.children[0].node.interp.isPunctuation()
    && t.children[1].node.form === ')'
    && t.children[1].node.interp.isPunctuation()
}

////////////////////////////////////////////////////////////////////////////////
export function isDenUDen(t: TokenNode) {
  // console.log(t.node.indexInSentence)
  return (t.node.interp.isNounish() || t.node.interp.isAdjective() && t.node.interp.isPronominal())
    // && t.node.interp.isNominative()
    // && t.children.length === 1  // experimental
    && wiith(t.children.filter(x => !x.node.interp.isPunctuation()), c =>
      c.every(x => x.node.index > t.node.index)
      && c.length === 1
      && c.some(x => uEq(x.node.rel, 'nmod')
        // && x.node.indexInSentence > t.node.indexInSentence
        // && x.children.some(xx => uEq(xx.node.rel, 'case'))
        && (x.node.interp.isNounish() || x.node.interp.isAdjective() && x.node.interp.isPronominal())
        && x.node.interp.lemma === t.node.interp.lemma
        && x.node.interp.getFeature(f.Case) !== t.node.interp.getFeature(f.Case)
      )
    )
}

////////////////////////////////////////////////////////////////////////////////
export function nounAdjectiveAgreed(noun: TokenNode, adjective: TokenNode) {
  return thisOrGovernedCase(noun) === adjective.node.interp.getFeature(f.Case)
    && (adjective.node.interp.isPlural() && noun.node.interp.isPlural()
      || noun.node.interp.getFeature(f.Gender) === adjective.node.interp.getFeature(f.Gender)
      || adjective.node.interp.isPlural() && noun.node.interp.isSingular() && hasChild(noun, 'conj')
      || adjective.node.interp.isSingular() && GENDERLESS_PRONOUNS.includes(noun.node.interp.lemma)
    )
}

////////////////////////////////////////////////////////////////////////////////
export function nounNounAgreed(interp1: MorphInterp, interp2: MorphInterp) {
  return interp1.equalsByFeatures(interp2, [f.MorphNumber, f.Gender, f.Case])
}

////////////////////////////////////////////////////////////////////////////////
export function hasCopula(t: TokenNode) {
  return t.children.some(x => uEqSome(x.node.rel, ['cop']))
}

////////////////////////////////////////////////////////////////////////////////
export function hasChild(t: TokenNode, rel: string) {
  return t.children.some(x => uEqSome(x.node.rel, [rel]))
}

////////////////////////////////////////////////////////////////////////////////
export function hasSiblink(t: TokenNode, rel: string) {
  return t.parent && t.parent.children.some(x => x !== t && uEqSome(x.node.rel, [rel]))
}

////////////////////////////////////////////////////////////////////////////////
export function isDeceimalFraction(t: TokenNode) {
  return t.node.interp.isCardinalNumeral()
    && /^\d+$/.test(t.node.form)
    && t.children.some(x => /^\d+$/.test(x.node.form)
      && x.children.length === 1
      && [',', '.'].includes(x.children[0].node.form)
      && x.node.index < t.node.index
    )
}

////////////////////////////////////////////////////////////////////////////////
export function isNegated(t: TokenNode) {
  return t.node.interp.isNegative()
    || t.children.some(x => x.node.interp.isNegative()
      || x.node.interp.isAuxillary() && x.children.some(xx => xx.node.interp.isNegative()
      )
    )
}

////////////////////////////////////////////////////////////////////////////////
export function isModalAdv(t: TokenNode) {
  return t.node.interp.isAdverb()
    && SOME_MODAL_ADVS.includes(t.node.interp.lemma)
    && (uEqSome(t.node.rel, SUBORDINATE_CLAUSES)
      || uEqSome(t.node.rel, ['parataxis', 'conj'])
      || t.isRoot()
    )
    && hasChild(t, 'csubj')
}

////////////////////////////////////////////////////////////////////////////////
export function isNumAdvAmbig(lemma: string) {
  if (NUM_ADV_AMBIG.includes(lemma)) {
    return true
  }
  // temp, hypen treatment
  return NUM_ADV_AMBIG.some(x => lemma.startsWith(x) || lemma.endsWith(x))
}

////////////////////////////////////////////////////////////////////////////////
export function isConjWithoutCcOrPunct(t: TokenNode) {
  let ret = uEq(t.node.rel, 'conj')
    && !t.children.some(x => uEqSome(x.node.rel, ['cc'])
      || uEq(x.node.rel, 'punct')
      && /[,;/\\]/.test(x.node.interp.lemma)
      && x.node.index < t.node.index
    )
    && !t.node.hasTag('conj_no_cc')

  if (!ret) {
    return ret
  }

  // last one has
  // let siblingConjes = t.parent.children.filter(x => x !== t && uEq(x.node.rel, 'conj'))
  // if (siblingConjes.length) {
  //   ret = ret && !last(siblingConjes).children
  //     .some(x => uEq(x.node.rel, 'cc'))
  // }

  return ret
}

////////////////////////////////////////////////////////////////////////////////
export function isCompounSvcCandidate(t: TokenNode) {
  return !t.isRoot()
    && t.node.interp.isVerb()
    && ['давати', 'дати'].includes(t.parent.node.interp.lemma)
    && t.parent.node.interp.getFeature(f.Person) === f.Person.second
    && t.parent.node.interp.isImperative()
    && !t.node.interp.isPast()
}

////////////////////////////////////////////////////////////////////////////////
export function isInfinitive(t: TokenNode) {
  return t.node.interp.isInfinitive()
    && !t.children.some(x => uEqSome(x.node.rel, ['aux', 'cop']) && !x.node.interp.isInfinitive())
}

////////////////////////////////////////////////////////////////////////////////
export function hasInfinitiveCop(t: TokenNode) {
  return t.children.some(x => uEqSome(x.node.rel, ['aux', 'cop']) && x.node.interp.isInfinitive())
}

////////////////////////////////////////////////////////////////////////////////
export function isInfinitiveCop(t: TokenNode) {
  return !t.node.interp.isVerb() && hasInfinitiveCop(t)
}

////////////////////////////////////////////////////////////////////////////////
export function isInfinitiveVerbAnalytically(t: TokenNode) {
  return isInfinitive(t) || isInfinitiveCop(t)
}

////////////////////////////////////////////////////////////////////////////////
export function hasOwnRelative(t: TokenNode) {
  return mu(walkDepthNoSelf(t, x => uEqSome(x.node.rel, SUBORDINATE_CLAUSES)
    || x.node.rel === 'parataxis:rel')
  ).some(x => x.node.interp.isRelative())
}

////////////////////////////////////////////////////////////////////////////////
export function isAdverbialAcl(t: TokenNode) {
  return t.parent
    && t.parent.node.interp.isNounish()
    && !t.parent.children.some(x => uEqSome(x.node.rel, ['cop', 'nsubj']))
    && !uEqSome(t.parent.node.rel, ['obl'])
    && (t.node.interp.isAdverb() && !t.hasChildren()  // двері праворуч
      || t.node.interp.isConverb() && !t.hasChildren()  // бокс лежачи
    )
}

////////////////////////////////////////////////////////////////////////////////
export function isFeasibleAclRoot(t: TokenNode) {
  return isInfinitive(t)
    || isInfinitiveCop(t)
    || t.children.some(x => uEqSome(x.node.rel, ['mark']))
    || t.children.some(x => (x.node.rel === 'xcomp' || uEqSome(x.node.rel, ['csubj']))
      && x.node.interp.isInfinitive())
    || hasOwnRelative(t)
    // || t.children.some(x => x.node.interp.isRelative())
    // || t.node.interp.isParticiple()  // temp
    // || isAdverbialAcl(t)
    || t.children.some(x => uEq(x.node.rel, 'nsubj'))
}

////////////////////////////////////////////////////////////////////////////////
export function canBeDecimalFraction(t: TokenNode) {
  return t.node.interp.isCardinalNumeral()
    && /^\d+$/.test(t.node.interp.lemma)
    && t.children.some(x => x.node.interp.isCardinalNumeral()
      && uEq(x.node.rel, 'compound')
      && x.node.index === t.node.index + 2
      && /^\d+$/.test(x.node.interp.lemma)
      && x.children.length === 1
      && x.children[0].node.index === t.node.index + 1
      && [',', '.'].includes(x.children[0].node.interp.lemma)
      && !x.children[0].hasChildren()
    )
}

////////////////////////////////////////////////////////////////////////////////
export function isAdvmodParticle(t: TokenNode) {
  return t.node.interp.isParticle()
    && ADVMOD_NONADVERBIAL_LEMMAS.includes(t.node.interp.lemma)
}

////////////////////////////////////////////////////////////////////////////////
export function canBeAsSomethingForXcomp2(t: TokenNode) {
  return t.node.interp.isNounish()
    && [f.Case.nominative, f.Case.accusative].includes(t.node.interp.getFeature(f.Case))
    && t.children.some(x => x.node.interp.lemma === 'як'
      && x.node.index < t.node.index
    )
}

////////////////////////////////////////////////////////////////////////////////
export function setTenseIfConverb(interp: MorphInterp, form: string) {
  if (interp.isConverb()) {
    if (/ши(с[ья])?$/.test(form)) {
      interp.features.tense = f.Tense.past
    } else if (/чи(с[ья])?$/.test(form)) {
      interp.features.tense = f.Tense.present
    } else {
      let msg = `Bad ending for converb "${form}"`
      console.error(msg)
      // throw new Error(msg)
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
export function denormalizeInterp(interp: MorphInterp) {
  if (
    (interp.isVerb() || interp.isAdjective() || interp.isNoun())
    && interp.hasGender()
    && !interp.hasNumber()
  ) {
    interp.setIsSingular()
  }
}

////////////////////////////////////////////////////////////////////////////////
export function standartizeMorphoForUd23(interp: MorphInterp, form: string) {
  denormalizeInterp(interp)

  setTenseIfConverb(interp, form)  // redundant?

  // remove degree from &noun
  if (interp.isAdjectiveAsNoun()) {
    interp.dropFeature(f.Degree)
  }

  // add base degree if empty
  if (interp.isAdjective() && !interp.hasFeature(f.Degree) && !interp.isPronominal()) {
    // interp.setFeature(f.Degree, f.Degree.positive)
  }

  // drop features
  interp.dropFeature(f.PrepositionRequirement)
  interp.dropFeature(f.Formality)
  interp.dropFeature(f.VerbReversivity)
  interp.dropFeature(f.PunctuationSide)

  interp.dropFeature(f.Rarity)
  interp.dropFeature(f.Oddness)
  interp.dropFeature(f.Colloquiality)

  // temp
  if (interp.isPunctuation()
    && form === '—'  // m-dash
    && !interp.hasFeature(f.PunctuationType)
  ) {
    interp.setFeature(f.PunctuationType, f.PunctuationType.dash)
  }

  if (interp.isForeign()) {
    interp.setFromVesumStr('x:foreign', interp.lemma)
  }

  // we're not sure there's a need for that
  if (interp.getFeature(f.PunctuationType) === f.PunctuationType.ellipsis) {
    interp.dropFeature(f.PunctuationType)
  }
}

////////////////////////////////////////////////////////////////////////////////
const SUBRELS_TO_EXPORT = new Set([
  'admod:amntgov',
  'advcl:sp',
  'advcl:svc',
  'ccomp:svc',
  'compound:svc',
  'conj:svc',
  'det:numgov',
  'det:nummod',
  'flat:foreign',
  'flat:name',
  'flat:repeat',
  'flat:title',
  'nummod:gov',
  'parataxis:discourse',
  'parataxis:newsent',
  'xcomp:sp',
])
export function standartizeSentenceForUd23(sentence: Array<TokenNode>) {
  let lastToken = last(sentence).node
  let rootIndex = sentence.findIndex(x => !x.node.hasDeps())

  for (let node of sentence) {
    let t = node.node

    // todo? set obj from rev to obl
    // todo: choose punct relation from the rigthtest token

    for (let edep of t.edeps) {
      // remove non-exportable subrels
      if (!SUBRELS_TO_EXPORT.has(edep.relation)) {
        edep.relation = stripSubrel(edep.relation)
      }
    }

    // leave the rightest punct head only
    {
      let [nonpunts, puncts] = clusterize(
        t.deps,
        x => uEq(x.relation, 'punct') && !sentence[x.headIndex].node.isElided(),
        [[], []]
      )
      if (puncts.length) {
        puncts.sort((a, b) => a.headIndex - b.headIndex)
        t.deps = [puncts[0], ...nonpunts]
      }
    }

    // set AUX and Cond
    if (uEqSome(t.rel, ['aux', 'cop'])) {
      t.interp.setIsAuxillary()
      if (['б', 'би'].includes(t.interp.lemma)) {
        t.interp.setIsConditional()
      }
    }

    // set the only iobj to obj
    if (uEq(t.rel, 'iobj')
      && !node.parent.children.some(x => uEqSome(x.node.rel, CORE_COMPLEMENTS))
    ) {
      t.rel = 'obj'
    }

    // remove non-exportable subrels
    if (t.rel && !SUBRELS_TO_EXPORT.has(t.rel)) {
      t.rel = stripSubrel(t.rel)
    }

    // set participle acl to amod
    if (uEq(t.rel, 'acl')
      && !isFeasibleAclRoot(node)
      && t.interp.isParticiple()
    ) {
      t.rel = 'amod'
    }

    // todo: test
    if (t.interp.isParticiple()) {
      node.children.filter(x => uEq(x.node.rel, 'aux'))
        .forEach(x => x.node.rel = 'cop')
    }

    standartizeMorphoForUd23(t.interp, t.form)
  }

  // set parataxis punct to the root
  if (lastToken.interp.isPunctuation()
    && uEq(lastToken.rel, 'parataxis')
  ) {
    lastToken.headIndex = rootIndex
  }
}


////////////////////////////////////////////////////////////////////////////////
// todo: move out
export function thisOrConjHead(node: GraphNode<Token>, predicate/* : TreedSentencePredicate */) {
  for (let t of node.walkThisAndUp0()) {
    if (!uEq(t.node.rel, 'conj')) {
      return predicate(t)
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
export function isFeasibleAdvmod(head: TokenNode, dep: TokenNode) {
  return head.node.interp.isVerbial2()
    || isNonverbialPredicate(head)
    || (head.node.interp.isAdjective() && !head.node.interp.isPronominal())
    || head.node.interp.isAdverb()
    || thisOrConjHead(head, x => uEq(x.node.rel, 'obl'))
    || isAdvmodParticle(dep)
}

////////////////////////////////////////////////////////////////////////////////
export function isPassive(t: TokenNode) {
  if (uEqSome(t.node.rel, SUBJECTS)) {
    if (t.parent.node.interp.isPassive()) {
      return true
    }
    if (t.parent.children.some(x => uEq(x.node.rel, 'xcomp')
      && x.node.rel !== 'xcomp:sp'
      && x.node.interp.isPassive())
    ) {
      return true
    }
  }
  return false
}

////////////////////////////////////////////////////////////////////////////////
export function fillWithValencyFromDict(interp: MorphInterp, valencyDict: ValencyDict) {
  if (interp.isVerb()) {
    interp.features.dictValency = valencyDict.lookupVerb(interp.lemma)
  } else if (interp.isNounish()) {
    interp.features.dictValency = valencyDict.lookupGerund(interp.lemma)
  }
}

////////////////////////////////////////////////////////////////////////////////
export function isNonverbialPredicate(t: TokenNode) {
  return (t.node.interp.isNounish() || t.node.interp.isAdjective()) && t.children.some(
    x => uEqSome(x.node.rel, ['cop', 'nsubj', 'csubj'])
  )
}

////////////////////////////////////////////////////////////////////////////////
export const ADVMOD_NONADVERBIAL_LEMMAS = [
  'не',
  'ні',
  'ані',
]

////////////////////////////////////////////////////////////////////////////////
export const SUBORDINATE_CLAUSES = [
  'csubj',
  'ccomp',
  'xcomp',
  'advcl',
  'acl',
]

////////////////////////////////////////////////////////////////////////////////
export const SOME_MODAL_ADVS = [
  'важко',
  'важливо',
  'варт',
  'варто',
  'вільно',
  'гарно',
  'дивно',
  'довше',
  'дозволено',
  'досить',
  'достатньо',
  'доцільно',
  'жарко',
  'запізно',
  'зручніше',
  'краще',
  'легко',
  'ліпше',
  'може',
  'можливо',
  'можна',
  'найкраще',
  'найліпше',
  'найтяжче',
  'невільно',
  'неефективно',
  'неможливо',
  'необхідно',
  'ніяково',
  'нормально',
  'потрібно',
  'правильно',
  'приємно',
  'реально',
  'слід',
  'сором',
  'треба',
  'цікаво',
  'чемно',
]

const NUM_ADV_AMBIG = [
  'багато',
  'небагато',
  'скілька',
  'скільки',
  'скількись',
  'скількі',
]

export const QAUNTITATIVE_ADVERBS = [
  ...NUM_ADV_AMBIG,
  'більше',
  'мало',
  'менше',
  'немало',
  'трохи',
  'трошки',
  'чимало',
]

export const ADVERBS_MODIFYING_NOUNS = [
  'майже',
]

export const CORE_COMPLEMENTS = [
  'obj',
  // 'xcomp',
  'ccomp',
]

export const CORE_COMPLEMENTS_XCOMP = [
  ...CORE_COMPLEMENTS,
  'xcomp'
]

export const COMPLEMENTS = [
  ...CORE_COMPLEMENTS,
  'iobj',
]

export const OBLIQUES = [
  'obl',
  'obl:agent',
]

export const SUBJECTS = [
  'nsubj',
  'csubj',
]

export const NOMINAL_HEAD_MODIFIERS = [
  'nmod',
  'appos',
  'amod',
  'nummod',
  'nummod_gov',
  'acl',
  'det',
  'case',
  'punct',
  'conj',
  'cc',
  'advmod',
  'discourse',
]

export const SOME_FREQUENT_TRANSITIVE_VERBS = [
  'бажати',
  'вважати',
  'вважати',
  'вимагати',
  'вирішити',
  'виходити',
  'встигнути',
  'дозволити',
  'дозволяти',
  'доручити',
  'заборонити',
  'завадити',
  'змогти',
  'змусити',
  'змушувати',
  'зуміти',
  'любити',
  'мати',
  'могти',
  'мусити',
  'переставати',
  'почати',
  'починати',
  'примушувати',
  'припинити',
  'пропонувати',
  'радити',
  'розуміти',
  'спробувати',
  'спробувити',
  'спробувити',
  'хотіти',
  // 'звикнути',
]

export const SOME_FREQUENT_INTRANSITIVE_VERBS = [
  'бігти',
  'вабити',  //
  'їхати',
  'поїхати',
  'приходити',
  'сідати',
  'ходити',
]

export const SOME_DATIVE_VALENCY_NOUNS = new Set([
  'вдячність',
  'видача',
  'визначення',
  'відповідність',
  'довг',
  'допомога',
  'доставка',
  'загроза',
  'запобігання',
  'заподіяння',
  'інтерв’ю',
  'край',
  'надання',
  'надсилання',
  'нанесення',
  'опір',
  'п.',
  'пам’ятник',
  'передання',
  'передача',
  'побажання',
  'повернення',
  'повідомлення',
  'подібне',
  'поклоніння',
  'поміч',
  'посвята',
  'привітання',
  'пригода',
  'придбання',
  'протидія',
  'сприяння',
  'спротив',
  'угода',  // деякі неоднозначні!
  'уклін',
])

export const MONTHS = [
  'січень',
  'лютий',
  'березень',
  'квітень',
  'травень',
  'червень',
  'липень',
  'серпень',
  'вересень',
  'жовтень',
  'листопад',
  'грудень',
]

export const COMPARATIVE_ADVS = [
  'більше',
  'більш',
  'менш',
  'менше'
]

export const COMPARATIVE_SCONJS = [
  'ніж',
  'як',
  // 'від',
  'чим'
]

export const CONJ_PROPAGATION_RELS_ARR = [
  'private',
  'distrib',
  'collect',
]
export const CONJ_PROPAGATION_RELS = new Set(CONJ_PROPAGATION_RELS_ARR)

export const HELPER_RELATIONS = CONJ_PROPAGATION_RELS

export const ALLOWED_RELATIONS/* : Array<UdMiRelation> */ = [
  'acl:adv',
  'acl:parataxis',
  'acl',
  'advcl:cmp',
  'advcl:sp',
  'advcl:svc',
  'advcl',
  'advmod:amtgov',
  'advmod',
  'amod',
  'appos:nonnom',
  'appos:reverse',
  'appos',
  'aux',
  'case',
  'cc',
  'ccomp:svc',
  'ccomp',
  'compound:svc',
  'compound',
  'conj:parataxis',
  'conj:repeat',
  'conj:svc',
  'conj:upperlevel',
  'conj',
  'cop',
  'csubj',
  'det:numgov',
  'det:nummod',
  'det',
  'discourse',
  'dislocated',
  'expl',
  'fixed',
  'flat:foreign',
  'flat:name',
  'flat:pack',
  'flat:range',
  'flat:rcp',
  'flat:repeat',
  'flat:title',
  'flat',
  'goeswith',
  'iobj',
  'list',
  'mark',
  'nmod',
  'nmod:iobj',
  'nmod:obj',
  'nmod:xcompsp',
  'nsubj:pass',
  'nsubj',
  'nummod:gov',
  'nummod',
  'obj',
  'obl:agent',
  'obl',
  'orphan',
  'parataxis:discourse',
  'parataxis:newsent',
  'parataxis:rel',
  'parataxis:thatis',
  'parataxis',
  'punct',
  'reparandum',
  'root',
  'vocative',
  'xcomp:sp',
  'xcomp',
]
export const LEAF_RELATIONS = [
  'cop',
  'aux',
  'expl',
  'fixed',
  // 'flat',
  'goeswith',
  'punct',
]

export const LEFT_POINTED_RELATIONS = [
  // 'case',  // treated separately
  'cc',
  'reparandum',
]

export const RIGHT_POINTED_RELATIONS = [
  'appos',
  'conj',
  'fixed',
  'flat',
  'list',
]

export const DISCOURSE_DESTANATIONS = [
  'PART',
  'SYM',
  'INTJ',
  'ADV',  // temp
]

export const COPULA_LEMMAS = [
  'бути',
  'бувати',
  'бувши',
  'будучи',
]

export const CONDITIONAL_AUX_LEMMAS = [
  'б',
  'би',
]

export const AUX_LEMMAS = [
  ...COPULA_LEMMAS,
  ...CONDITIONAL_AUX_LEMMAS,
]

export const CLAUSAL_MODIFIERS = SUBORDINATE_CLAUSES

export const EXPL_FORMS = [
  'собі',
  'воно',
  'це',
  'то',
]

export const CLAUSE_RELS = [
  ...SUBORDINATE_CLAUSES,
  'parataxis',
]

export const MARK_ROOT_RELS = [
  ...SUBORDINATE_CLAUSES,
  'appos',
  'parataxis:discourse',
]

export const CONTINUOUS_REL = [
  'csubj',
  'ccomp',
  // 'xcomp',
  'advcl',
  // 'acl',
  'parataxis',
  'flat',
  'fixed',
  'compound',
]


export const POSES_NEVER_ROOT: Array<UdPos> = [
  // 'ADP',
  'AUX',
  // 'CCONJ',
  // 'SCONJ',
  // 'NUM',
  // 'PART',
  'PUNCT',
]

export const CURRENCY_SYMBOLS = [
  '₴',
  '$',
  '€',
]

export const WORDS_WITH_INS_VALENCY = [
  // 'даний',
  // 'одмітний',
  // 'переповнений',
  // 'засмічений',
  // 'узятий',
  // 'зацікавлений',

  // 'володіти',
  // 'задовольнитися',
  // 'зробитися',

  // 'рискувати',
  // 'пожертвувати',
  // 'тхнути',
  // 'тягнути',
  // 'називати',
  // 'дихнути',
  // 'нехтувати',
  // 'пахнути',

  'командувати',
  'курувати',
  'керувати',
  'нехтувати',
  'знехтувати',
  'володіти',
  'опікуватися',
  'відати',
  'пахнути',
  'затискати',
]

export const SOME_WORDS_WITH_ACC_VALENCY = new Set([  // not in valency dict
  'бігати',
  'бігти',
  'бухтіти',
  'досиджувати',
  'думати',
  'дякувати',
  'зазначити',
  'заказати',
  'запитувати',
  'збутися',
  'інкримінувати',
  'наложити',
  'нотувати',
  'поворожити',
  'пообростати',
  'постачати',
  'продивлятися',
  'проскочити',
  'розмістити',
  'розміщувати',
  'штовхнути',
  'являти',
  'виплюнути',
  'виповнювати',
  'виготовляти',
  'боятися',
  'затискати',
])

export const VALID_ADVS_AMBIG_TO_NOUN = new Set([
  'варто',
  'відразу',
  'враз',
  'все',  // ~
  'вчора',
  'далі',
  'дещо',
  'дибки',
  'доки',
  'досі',
  'загалом',
  'зараз',
  'зразу',
  'коли',
  'коли',
  'надміру',
  'палко',
  'погано',
  'разом',
  'різко',
  'руба',
  'слід',
  'струнко',
  'сьогодні',
  'тому',
  'тому',
  'тому',
  'треба',
  'усюди',  // ~?
  'чого',
  'чому',
  'щось',
  'як',
  'як',
])

export const PREPS_HEADABLE_BY_NUMS = [
  'близько',
  'понад',
]

export const TEMPORAL_ACCUSATIVES = [
  'вечір',
  'година',
  'день',
  'доба',
  'ніч',
  'раз',
  'рік',
  'секунда',
  'тиждень',
  'хвилина',
  'хвилинка',
  'ранок',
  'мить',
  'час',
  'безліч',
  'р.',
  'місяць',
  'півгодини',
]

export const GENDERLESS_PRONOUNS = [
  'абихто',
  'будь-хто',  // прибрати після розділу
  'ви',
  'вони',  // todo: ns?
  'дехто',
  'дещо',  // ніякий?
  'ми',
  'ніхто',
  'ніщо',  // середній?
  'себе',
  'ти',
  'хто-небудь',  // прибрати після розділу
  'хтось',
  'я',
]

export const EMPTY_ANIMACY_NOUNS = [
  'себе',
  'ся',
]

const GEN_VALENCY_ADJECTIVES = new Set([
  'певний',
  'сповнений',
  'позбавлений',
  'повний',
  'певний',
])

const DAT_VALENCY_ADJECTIVES = new Set([
  'ближчий',
  'ближчий',
  'вигідний',
  'виписаний',
  'відданий',
  'відомий',
  'вдячний',
  'властивий',
  'доступний',
  'звичний',
  'найвірніший',
  'незнайомий',
  'ненависний',
  'переданий',
  'передбачений',
  'піддатний',
  'підконтрольний',
  'повернений',
  'потрібний',
  'присвячений',
  'подобний',
  'подібний',
  'нерекомендований',
  'приступніший',
])

const INF_VALENCY_ADJECTIVES = [
  'готовий',
  'здатний',
  'радий',
  'неспроможний',
  'неготовий',
  'повинний',
  'нездатний',
  'змушений',
  'покликаний',
]

export const QUANTIF_PREP = [
  'понад',
  'близько',
]

export const PROMOTION_PRECEDENCE = [
  'nsubj',
  'obj',
  'iobj',
  'obl',
  'advmod',
]
