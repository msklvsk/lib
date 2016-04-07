import {lexCompare} from './lang';

////////////////////////////////////////////////////////////////////////////////
export function uniqValuedMap2array(map) {
  return Object.keys(map).sort((a, b) => {
    return map[a] - map[b];
  })
}

////////////////////////////////////////////////////////////////////////////////
export function* findIndexwiseDiff(input: Array<any>) {
  let maxLen = Math.max(...input.map(x => x.length));
  let curDiffLen = 0;
  for (let j = 0; j < maxLen; ++j) {
    let cur = input[0][j];
    for (let i = 1; i < input.length; ++i) {
      if (input[i][j] !== cur) {
        ++curDiffLen;
        break;
      }
      if (curDiffLen) {
        yield [j - curDiffLen, curDiffLen];
        curDiffLen = 0;
      }
    }
  }
  if (curDiffLen) {
    yield [maxLen - curDiffLen, curDiffLen];
  }
}

////////////////////////////////////////////////////////////////////////////////
export function longestCommonSubstring(strings: Array<string>) {  // naive
  let ret = '';
  if (strings.length) {
    for (let i = 0; i < strings[0].length; ++i) {
      for (let j = 0; j < strings[0].length - i + 1; ++j) {
        let candidate = strings[0].substring(i, i + j);
        if (j > ret.length && strings.every(x => x.indexOf(candidate) >= 0)) {
          ret = candidate;
        }
      }
    }
  }

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function groupTableBy(table: any[], groupProp: string | number | symbol) {
  let ret = new Map<string | number, any[]>();

  for (let row of table) {
    let cell = row[groupProp];
    (ret.get(cell) || ret.set(cell, []).get(cell)).push(row);
  }

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function indexTableByColumns(table: Object[], propNames: any[]) {
  let ret = new Map();

  for (let row of table) {
    if (propNames[propNames.length - 1] in row) {
      let cur = ret;
      for (let i = 0, bound = propNames.length - 1; i < bound; ++i) {
        let col = propNames[i];
        let cell = row[col];
        cur = cur.get(cell) || cur.set(cell, new Map()).get(cell);
      }
      cur.set(row[propNames[propNames.length - 1]], row);
    }
  }

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function arr2indexMap<T>(value: Array<T>) {
  let ret = new Map<T, number>();
  for (let i = 0; i < value.length; ++i) {
    ret.set(value[i], i);
  }

  return ret;
}

////////////////////////////////////////////////////////////////////////////////
export function combinations<T>(arr: T[][]) {
  return [..._combinations(arr)];
}

function* _combinations<T>(arr: T[][], state = new Array<T>()): Iterable<T[]> {
  if (state.length < arr.length) {
    for (let x of arr[state.length]) {
      state.push(x);
      yield* _combinations(arr, state);
      state.pop();
    }
  }
  else {
    yield [...state];
  }
}

////////////////////////////////////////////////////////////////////////////////
export function overflowNegative(value: number) {
  return value & 0x7FFFFFFF;  // todo: MAX_SAFE_INTEGER?
}

////////////////////////////////////////////////////////////////////////////////
/** see https://bost.ocks.org/mike/shuffle/ */
export function shuffle(array: any[]) {
  let m = array.length;
  while (m) {
    let i = Math.floor(Math.random() * m--);
    [array[m], array[i]] = [array[i], array[m]];
  }

  return array;
}

////////////////////////////////////////////////////////////////////////////////
export function stableSort<T>(array: T[], comparator: (a: T, b: T) => number = lexCompare) {
  let indexMap = arr2indexMap(array);
  return array.sort((a, b) => {
    let initialCompare = comparator(a, b);
    if (!initialCompare) {
      return indexMap.get(a) - indexMap.get(b);
    }
    return initialCompare;
  });
}

////////////////////////////////////////////////////////////////////////////////
export function unique<T>(array: T[]) {
  return [...new Set(array)];
}