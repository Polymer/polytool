/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {Deferred} from 'polymer-analyzer/lib/utils';
import * as stream from 'stream';

import File = require('vinyl');

(Symbol as any).asyncIterator = Symbol.asyncIterator || Symbol('asyncIterator');

/**
 * Returns the string contents of a Vinyl File object, waiting for
 * all chunks if the File is a stream.
 */
export async function getFileContents(file: File): Promise<string> {
  if (file.isBuffer()) {
    return file.contents.toString('utf-8');
  } else if (file.isStream()) {
    const stream = file.contents;
    stream.setEncoding('utf-8');
    const contents: string[] = [];
    stream.on('data', (chunk: string) => contents.push(chunk));

    return new Promise<string>((resolve, reject) => {
      stream.on('end', () => resolve(contents.join('')));
      stream.on('error', reject);
    });
  }
  throw new Error(
      `Unable to get contents of file ${file.path}. ` +
      `It has neither a buffer nor a stream.`);
}

/**
 * Waits for the given ReadableStream
 */
export function waitFor(stream: NodeJS.ReadableStream):
    Promise<NodeJS.ReadableStream> {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

/**
 * Waits for all the given ReadableStreams
 */
export function waitForAll(streams: NodeJS.ReadableStream[]):
    Promise<NodeJS.ReadableStream[]> {
  return Promise.all<NodeJS.ReadableStream>(streams.map((s) => waitFor(s)));
}

type PipeStream = (NodeJS.ReadableStream|NodeJS.WritableStream|
                   NodeJS.ReadableStream[]|NodeJS.WritableStream[]);

/**
 * pipeStreams() takes in a collection streams and pipes them together,
 * returning the last stream in the pipeline. Each element in the `streams`
 * array must be either a stream, or an array of streams (see PipeStream).
 * pipeStreams() will then flatten this array before piping them all together.
 */
export function pipeStreams(streams: PipeStream[]): NodeJS.ReadableStream {
  return Array.prototype.concat.apply([], streams)
      .reduce((a: NodeJS.ReadableStream, b: NodeJS.ReadWriteStream) => {
        return a.pipe(b);
      });
}

class WritableAsyncIterable<V> implements AsyncIterable<V> {
  private blockedOn: Deferred<IteratorResult<V>>|undefined = undefined;
  backlog: Array<{value: IteratorResult<V>, deferred: Deferred<void>}> = [];
  private _closed = false;
  async write(value: V) {
    if (this._closed) {
      throw new Error('Wrote to closed writable iterable');
    }
    this._write({value, done: false});
  }

  async close() {
    this._closed = true;
    return this._write({done: true} as any);
  }

  private async _write(value: IteratorResult<V>) {
    if (this.blockedOn) {
      this.blockedOn.resolve(value);
      this.blockedOn = undefined;
    } else {
      const deferred = new Deferred<void>();
      this.backlog.push({value, deferred});
      await deferred.promise;
    }
  }

  async * [Symbol.asyncIterator](): AsyncIterator<V> {
    while (true) {
      let value;
      const maybeValue = this.backlog.shift();
      if (maybeValue) {
        maybeValue.deferred.resolve(undefined);
        value = maybeValue.value;
      } else {
        this.blockedOn = new Deferred();
        value = await this.blockedOn.promise;
      }
      if (value.done) {
        return;
      } else {
        yield value.value;
      }
    }
  }
}

/**
 * Implements `stream.Transform` via standard async iteration.
 *
 * The main advantage over implementing stream.Transform itself is that correct
 * error handling is built in and easy to get right, simply by using async/await
 * and
 */
export abstract class AsyncTransformStream<In, Out> extends stream.Transform {
  private readonly _inputs = new WritableAsyncIterable<In>();

  /**
   * Implement this method!
   *
   * Read from the given iterator to consume input, yield values to write
   * chunks of your own. You may yield any number of values for each input.
   *
   * Note: currently you *must* completely consume `inputs` and return for this
   *   stream to close.
   */
  protected abstract _transformIter(inputs: AsyncIterable<In>):
      AsyncIterable<Out>;

  private _initialized = false;
  private _writingFinished = new Deferred<void>();
  private _initializeOnce() {
    if (this._initialized === false) {
      this._initialized = true;
      const transformDonePromise = (async () => {
        for await (const value of this._transformIter(this._inputs)) {
          // TODO(rictic): if `this.push` returns false, should we wait until
          //     we get a drain event to keep iterating?
          this.push(value);
        }
      })();
      // TODO(rictic): blindly drain the rest of the inputs if _transformIter
      //     returns early?
      transformDonePromise.then(() => {
        this._writingFinished.resolve(undefined);
      }, (err) => this.emit('error', err));
    }
  }

  /**
   * Don't override.
   *
   * Passes input into this._inputs.
   */
  protected _transform(
      input: In,
      _encoding: string,
      callback: (error?: any, value?: Out) => void) {
    this._initializeOnce();
    this._inputs.write(input).then(() => {
      callback();
    }, (err) => callback(err));
  }


  /**
   * Don't override.
   *
   * Finish writing out the outputs.
   */
  protected async _flush(callback: (err?: any) => void) {
    try {
      // We won't get any more inputs. Wait for them all to be processed.
      await this._inputs.close();
      // Wait for all of our output to be written.
      await this._writingFinished.promise;
      callback();
    } catch (e) {
      callback(e);
    }
  }
};
