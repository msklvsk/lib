import { Readable } from 'stream'
import { StreamDataIterator } from './lib/nextify/stream_data_iterator'


////////////////////////////////////////////////////////////////////////////////
export function writePromiseDrain(
  to: NodeJS.WriteStream,
  what: string | Buffer,
) {
  if (!to.write(what, undefined)) {
    return new Promise<void>((resolve, reject) => {
      to.once('drain', resolve)
    })
  }
}

////////////////////////////////////////////////////////////////////////////////
export function writeBackpressed(
  to: NodeJS.WriteStream,
  backpress: NodeJS.ReadableStream,
  what: string | Buffer,
) {
  if (!to.write(what) && !backpress.isPaused()) {
    backpress.pause()
    to.once('drain', () => backpress.resume())  // todo: wtf??
  }
}

////////////////////////////////////////////////////////////////////////////////
export function readNBytes(n: number, istream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {

    let waitUntilNBytes = () => {
      let buf = istream.read(n)
      if (buf) {
        resolve(buf)
      }
      else {
        istream.once('readable', waitUntilNBytes)
      }
    }

    waitUntilNBytes()
    reject()  // todo
    throw new Error('should never happen')
  })
}

////////////////////////////////////////////////////////////////////////////////
export function readTillEnd(istream: Readable): Promise<string> {
  let ret = ''

  return new Promise((resolve, reject) => {

    istream.on('data', chunk => ret += chunk)
      .on('end', () => resolve(ret))

  })
}

////////////////////////////////////////////////////////////////////////////////
// experiment
export async function* binLines(
  readable: NodeJS.ReadableStream,
  separator: Buffer | number,
) {
  let lines = new Array<Buffer>()
  for await (let chunk of new StreamDataIterator<Buffer>(process.stdin)) {
    for (let i = chunk.indexOf(separator); i >= 0; i = chunk.indexOf(separator, i)) {
      let a = new DataView(chunk.buffer, 3, 5)

      lines.push(chunk)
    }
    // console.log(chunk.byteLength)
    yield lines

    lines = []
  }
}
