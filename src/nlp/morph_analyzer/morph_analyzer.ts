import { Dictionary } from '../dictionary/dictionary';
import { IMorphInterp } from '../interfaces';
import { MorphTag } from '../morph_tag';
import { FOREIGN_CHAR_RE } from '../static';



////////////////////////////////////////////////////////////////////////////////
export class MorphAnalyzer {
  constructor(
    private dictionary: Dictionary,
    private numberTag: string,
    private foreignTag: string,
    private xTag: string) {
  }

  hasAnyCase(token: string) {
    return this.dictionary.hasAnyCase(token);
  }

  canBeToken(token: string) {
    return !this.tag(token)[Symbol.iterator]().next().done;
  }

  /** @token is atomic */
  tag(token: string): Iterable<IMorphInterp> {
    token = token.replace(/́/g, '');  // kill emphasis

    if (/^\d+$/.test(token)) {
      return [{ lemma: token, flags: this.numberTag }];
    }

    if (FOREIGN_CHAR_RE.test(token)) {
      return [{ lemma: token, flags: this.foreignTag }];
    }

    let lookupee = [token];
    let lowercase = token.toLowerCase();

    // for (let tok of [token, lowercase]) {
    //   if (tok.includes('-')) {
    //     let [last, ...prevs] = tok.split('-').reverse();
    //     this.dictionary.lookup(last).every(x => x.flags.includes('adj:'))
    //   }
    // }

    if (lowercase !== token) {
      lookupee.push(lowercase);
    }

    let ret = this.dictionary.lookupVariants(lookupee);

    if (!ret.size) {
      ret.addMany(this.dictionary.lookupVariants(lookupee.map(x => x.replace(/ґ/g, 'г'))));
    }

    // // спробуймо по-харківськи
    // if (!ret.size && lowercase.endsWith('сти')) {
    //   let kharkivLowercase = lowercase.slice(0, -1) + 'і';
    //   ret.addMany(this.lookupParsed(kharkivLowercase)
    //     .filter(x => x.canBeKharkivSty())
    //     .map(x => x.toVesumStrMorphInterp()));
    // }

    for (let prefix of ['екс-', 'віце-']) {  // todo: віце not with adj (but with nounish adj)
      if (!ret.size && lowercase.startsWith(prefix)) {
        ret.addMany(this.lookupParsed(lowercase.substr(prefix.length))
          .filter(x => x.isNoun() || x.isAdjective()).map(x => {
            x.lemma = prefix + x.lemma;
            return x.toVesumStrMorphInterp();
          }));
      }
    }

    // try одробив is the same as відробив
    if (!ret.size && lowercase.startsWith('од') && lowercase.length > 4) {
      ret.addMany(this.dictionary.lookup('від' + lowercase.substr(2))
        .filter(x => x.flags.includes('verb'))
        .map(x => {
          x.lemma = 'од' + x.lemma.substr(3);
          if (!x.flags.includes(':odd')) {
            x.flags += ':odd';
          }
          x.flags += ':auto';
          return x;
        }));
    }

    // try обробити is :perf for робити
    if (!ret.size && lowercase.length > 4) {
      for (let prefix of ['обі', 'об']) {
        if (lowercase.startsWith(prefix)) {
          ret.addMany(this.lookupParsed(lowercase.substr(prefix.length))
            .filter(x => x.isVerb() && x.isImperfect()).map(x => {
              x.setIsPerfect().setIsAuto();
              x.lemma = prefix + x.lemma;
              return x.toVesumStrMorphInterp();
            }));
        }
      }
    }

    return ret;
  }

  tagOrX(token: string) {
    let ret = [...this.tag(token)];
    return ret.length ? ret : [{lemma: token, flags: this.xTag}];
  }

  private lookupParsed(token: string) {
    return this.dictionary.lookup(token).map(
      x => MorphTag.fromVesumStr(x.flags, undefined, token, x.lemma));
  }
}
