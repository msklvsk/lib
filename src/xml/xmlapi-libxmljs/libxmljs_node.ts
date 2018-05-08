import { LibxmljsDocument } from './libxmljs_document';
import { LibxmljsElement } from './libxmljs_element';
import { LibxmljsAttribute } from './libxmljs_attribute';
import { nodeOrElement, nodeOrElementOrNull, isNode, nodeOrElementOrAttribute } from './utils';
import { wrappedOrNull } from '../../lang';
import { AbstractNode, XmlapiXpathResult } from '../xmlapi/abstract_node';
import { isOddball } from '../xmlapi/utils';

const wu = require('wu');



export class LibxmljsNode extends AbstractNode {
  constructor(protected wrapee) {
    super();
  }

  native() {
    return this.wrapee;
  }

  document() {
    return wrappedOrNull(LibxmljsDocument, this.wrapee.doc());
  }

  parent() {
    if (this.isRoot()) {
      return null;
    }

    return new LibxmljsElement(this.wrapee.parent());
  }

  previousSibling() {
    return nodeOrElementOrNull(this.wrapee.prevSibling());
  }

  nextSibling() {
    return nodeOrElementOrNull(this.wrapee.nextSibling());
  }

  previousElementSibling() {
    return wrappedOrNull(LibxmljsElement, this.wrapee.prevElement());
  }

  nextElementSibling() {
    return wrappedOrNull(LibxmljsElement, this.wrapee.nextElement());
  }

  text(value?: string) {
    if (value !== undefined) {
      this.wrapee.text(value);
    }
    else {
      return this.wrapee.text();
    }
  }

  type() {
    return this.wrapee.type();
  }

  isSame(other: LibxmljsNode) {
    return !isOddball(other) && other.wrapee === this.wrapee;
  }

  getPath() {
    return this.wrapee.path();
  }

  remove() {
    this.wrapee.remove();
    return this;
  }

  replace(replacement: LibxmljsNode) {
    this.wrapee.replace(replacement.wrapee);
  }

  insertBefore(newNode: LibxmljsNode) {
    this.wrapee.addPrevSibling(newNode.wrapee);
  }

  insertAfter(newNode: LibxmljsNode) {
    this.wrapee.addNextSibling(newNode.wrapee);
  }

  evaluate(xpath: string, nsMap?: Object): XmlapiXpathResult {
    let result = this.wrapee.find(xpath, nsMap);
    if (Array.isArray(result)) {
      return wu((function* () {
        for (let node of result) {
          yield nodeOrElementOrAttribute(node);
        }
      })());
    }
    if (typeof result === 'boolean' || typeof result === 'number' || typeof result === 'string') {
      return result;
    }

    throw new Error('Unexpected XPath result');
  }

  evaluateNode(xpath: string, nsMap?: Object) {
    let result = this.wrapee.get(xpath, nsMap);
    if (!result) {
      return null;
    }
    if (typeof result !== 'object' || !isNode(result)) {
      throw new Error('XPath result is not a node');
    }
    return nodeOrElement(result);
  }

  evaluateElement(xpath: string, nsMap?: Object) {
    let result = this.wrapee.get(xpath, nsMap);
    if (!result) {
      return null;
    }
    if (typeof result !== 'object' || result.type() !== 'element') {
      throw new Error('XPath result is not an element');
    }
    return new LibxmljsElement(result);
  }

  evaluateAttribute(xpath: string, nsMap?: Object) {
    let result = this.wrapee.get(xpath, nsMap);
    if (!result) {
      return null;
    }
    if (typeof result !== 'object' || result.type() !== 'attribute') {
      throw new Error('XPath result is not an attribute');
    }
    return new LibxmljsAttribute(result);
  }

  evaluateNodes(xpath: string, nsMap?: Object) {
    return this._evaluateMany(xpath, nsMap).map(x => {
      if (!isNode(x)) {
        throw new Error('XPath result is not a list of nodes');
      }
      return nodeOrElement(x);
    }) as Wu.WuIterable<LibxmljsNode>;  // todo: why not inferred?
  }

  evaluateElements(xpath: string, nsMap?: Object) {
    return this._evaluateMany(xpath, nsMap).map(x => {
      if (x.type() !== 'element') {
        throw new Error('XPath result is not a list of elements');
      }
      return new LibxmljsElement(x);
    }) as Wu.WuIterable<LibxmljsElement>;  // todo: why not inferred?
  }

  evaluateAttributes(xpath: string, nsMap?: Object) {
    return this._evaluateMany(xpath, nsMap).map(x => {
      if (x.type() !== 'attribute') {
        throw new Error('XPath result is not a list of attributes');
      }
      return new LibxmljsAttribute(x);
    }) as Wu.WuIterable<LibxmljsAttribute>;  // todo: why not inferred?
  }

  clone() {
    return nodeOrElement(this.wrapee.clone());
  }

  serialize() {
    return this.wrapee.toString(true);
  }

  protected _evaluateMany(xpath, nsMap?) {
    let result: any[] = this.wrapee.find(xpath, nsMap) || [];

    if (!Array.isArray(result)) {
      throw new Error('XPath result is not a list');
    }
    return wu(result);
  }
}
