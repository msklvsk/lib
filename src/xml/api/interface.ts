////////////////////////////////////////////////////////////////////////////////
export abstract class IDocument {
  documentElement: IElement;
  abstract createElement(name: string): IElement;
  abstract serialize(): string;
}

////////////////////////////////////////////////////////////////////////////////
export abstract class INode {
  abstract equals(other: INode): boolean;
  ownerDocument: IDocument;
  firstChild: INode;
  nextSibling: INode;
  parentNode: INode;
  nodeName: string;
  textContent: string;
  abstract isElement(): boolean;
  abstract isText(): boolean;
  abstract isRoot(): boolean;
  abstract replace(replacement: INode);
  abstract insertBefore(newNode: INode): INode;  // todo
  abstract insertAfter(newNode: INode);
  abstract remove(): INode;
  abstract lang(): string;
  abstract is(name: string): boolean;
  abstract parent(): IElement;
}

////////////////////////////////////////////////////////////////////////////////
export abstract class IElement extends INode {
  localName: string;
  abstract getAttribute(name: string): string;
  abstract setAttribute(name: string, value: any);
  abstract renameAttributeIfExists(nameOld: string, nameNew: string);
  abstract removeAttribute(name: string);
  abstract appendChild(child: INode): INode;
  abstract nameNs(): string;
  //isNs(otherName: string): boolean;
  nextElementSibling: IElement;
  lastChild: INode;
  abstract childElements(): Iterable<IElement>;
  abstract childElement(index: number): IElement;
  childElementCount: number;
  abstract xpath(query: string, nsMap?): INode[];
  abstract xpathIt(query: string, nsMap?): IterableIterator<INode>;
  abstract clone(): IElement;  // always deep(?)
  
  xpathEl(query: string, nsMap?) {
    return <IElement[]>this.xpath(query, nsMap).filter(x => x.isElement());
  }
}

// todo: when get, when ()?
