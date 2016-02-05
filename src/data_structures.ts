import {zip} from './lang'


////////////////////////////////////////////////////////////////////////////////
export class JsonCompareSet<T> {
  private map = new Map<string, T>();
  constructor(iterable?: Iterable<T>) {
    //super(iterable);  // todo
  }
  
  add(value: T) {
    this.map.set(JSON.stringify(value), value);
    return this;
  }
  
  keys() {
    return this.map.values();
  }
  
  values() {
    return this.map.values();
  }
}

////////////////////////////////////////////////////////////////////////////////
export interface IMap<K, V> {
  has(key: K): boolean;
  get(key: K): V;
  set(key: K, val: V): IMap<K, V>;
  [Symbol.iterator]();
}

//------------------------------------------------------------------------------
export class JsonCompareMap<K, V> implements IMap<K, V> {
  map = new Map<string, [K, V]>();

  constructor() {
    this[Symbol.iterator]
  }

  has(key: K) {
    return this.map.has(JSON.stringify(key));
  }

  get(key: K) {
    return this.map.get(JSON.stringify(key))[1];
  }

  set(key: K, val: V) {
    this.map.set(JSON.stringify(key), [key, val]);
    return this;
  }

  [Symbol.iterator]() {
    // todo
  }
}

////////////////////////////////////////////////////////////////////////////////
export class NumeratedSet<T> {  // todo move somewhere 
  values = new Array<T>();
  ids: IMap<T, number>;

  constructor(mapConstructor: { new (): IMap<T, number> } = Map) {
    this.ids = new mapConstructor();
  }

  add(...vals: Array<T>) {
    for (let val of vals) {
      if (!this.ids.has(val)) {
        this.ids.set(val, this.values.push(val) - 1);
      }
    }

    return this;
  }

  id(val: T) {
    return this.ids.get(val);
  }

  static fromUniqueArray(array: Array<any>) {
    let ret = new NumeratedSet();
    ret.values = array;
    for (let i = 0; i < array.length; ++i) {
      ret.ids.set(array[i], i);
    }

    return ret;
  }

  static fromSet(set: Set<any>) {
    let ret = new NumeratedSet();
    for (let val of set) {
      ret.ids.set(val, ret.values.push(val) - 1);
    }

    return ret;
  }
}

////////////////////////////////////////////////////////////////////////////////
export class CachedValue<T> {
  private value: T;
  private argsHash: string = null;

  constructor(private calculator: (...args) => T) {

  }

  get(...args) {
    let hash = JSON.stringify(args);
    if (this.isInvalid() || (args && args.length && hash !== this.argsHash)) {
      this.value = this.calculator(...args);
    }
    this.argsHash = hash;
    
    return this.value;
  }

  invalidate() {
    this.argsHash = null;
  }

  private isInvalid() {
    return this.argsHash === null;
  }
}