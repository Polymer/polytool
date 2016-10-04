/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

import {dest} from 'vinyl-fs';
import * as gulpif from 'gulp-if';
import * as path from 'path';
import * as logging from 'plylog';
import * as mergeStream from 'merge-stream';
import {PolymerProject, addServiceWorker, forkStream, SWConfig} from 'polymer-build';

import {JSOptimizeStream, CSSOptimizeStream, HTMLOptimizeStream} from './optimize-streams';

import {ProjectConfig} from '../project-config';
import {PrefetchTransform} from './prefetch';
import {waitFor} from './streams';
import {parsePreCacheConfig} from './sw-precache';
import {BabelTransform} from './babel-transform';

const logger = logging.getLogger('cli.build.build');

export interface BuildOptions {
  swPrecacheConfig?: string;
  insertDependencyLinks?: boolean;
  // TODO(fks) 07-21-2016: Fully complete these with available options
  html?: {
    collapseWhitespace?: boolean;
    removeComments?: boolean;
  };
  css?: {
    stripWhitespace?: boolean;
  };
  js?: {
    compile?: boolean;
    minify?: boolean;
  };
}

export async function build(options: BuildOptions, config: ProjectConfig): Promise<void> {
  let sourcesBabelTransform: BabelTransform;
  let depsBabelTransform: BabelTransform;

  if (options.js.compile) {
    sourcesBabelTransform = new BabelTransform();
    depsBabelTransform = new BabelTransform();
  }

  const polymerProject = new PolymerProject({
    root: config.root,
    shell: config.shell,
    entrypoint: config.entrypoint,
    fragments: config.fragments,
    sourceGlobs: config.sourceGlobs,
    includeDependencies: config.includeDependencies,
  });

  if (options.insertDependencyLinks) {
    logger.debug(`Additional dependency links will be inserted into application`);
  }

  // mix in optimization options from build command
  // TODO: let this be set by the user
  const optimizeOptions = {
    html: Object.assign({removeComments: true}, options.html),
    css: Object.assign({stripWhitespace: true}, options.css),
    js: Object.assign({minify: true}, options.js),
  };

  logger.info(`Building application...`);

  logger.debug(`Reading source files...`);
  let sourcesStream: NodeJS.ReadableStream = polymerProject.sources()
    .pipe(polymerProject.splitHtml());

  if (sourcesBabelTransform) {
    sourcesStream = sourcesStream.pipe(gulpif(/\.js$/, sourcesBabelTransform))
  }

  sourcesStream = sourcesStream
    .pipe(gulpif(/\.js$/, new JSOptimizeStream(optimizeOptions.js)))
    .pipe(gulpif(/\.css$/, new CSSOptimizeStream(optimizeOptions.css)))
    .pipe(gulpif(/\.html$/, new HTMLOptimizeStream(optimizeOptions.html)))
    .pipe(polymerProject.rejoinHtml());

  logger.debug(`Reading dependencies...`);
  let depsStream: NodeJS.ReadableStream = polymerProject.dependencies()
    .pipe(polymerProject.splitHtml())

  if (depsBabelTransform) {
    depsStream = depsStream.pipe(gulpif(/\.js$/, depsBabelTransform))
  }

  depsStream = depsStream
    .pipe(gulpif(/\.js$/, new JSOptimizeStream(optimizeOptions.js)))
    .pipe(gulpif(/\.css$/, new CSSOptimizeStream(optimizeOptions.css)))
    .pipe(gulpif(/\.html$/, new HTMLOptimizeStream(optimizeOptions.html)))
    .pipe(polymerProject.rejoinHtml());

  const buildStream = mergeStream(sourcesStream, depsStream)
    .once('data', () => { logger.debug('Analyzing build dependencies...'); })
    .pipe(polymerProject.analyzer);

  const unbundledPhase = forkStream(buildStream)
    .once('data', () => { logger.info('Generating build/unbundled...'); })
    .pipe(
      gulpif(
        options.insertDependencyLinks,
        new PrefetchTransform(polymerProject.root, polymerProject.entrypoint,
          polymerProject.shell, polymerProject.fragments,
          polymerProject.analyzer)
      )
    )
    .pipe(dest('build/unbundled'));

  const bundledPhase = forkStream(buildStream)
    .once('data', () => { logger.info('Generating build/bundled...'); })
    .pipe(polymerProject.bundler)
    .pipe(dest('build/bundled'));

  const swPrecacheConfig = path.resolve(polymerProject.root, options.swPrecacheConfig || 'sw-precache-config.js');
  const loadSWConfig = parsePreCacheConfig(swPrecacheConfig);

  loadSWConfig.then((swConfig) => {
    if (swConfig) {
      logger.debug(`Service worker config found`, swConfig);
    } else {
      logger.debug(`No service worker configuration found at ${swPrecacheConfig}, continuing with defaults`);
    }
  });

  // Once the unbundled build stream is complete, create a service worker for the build
  const unbundledPostProcessing = Promise.all([loadSWConfig, waitFor(unbundledPhase)]).then((results) => {
    const swConfig: SWConfig = results[0];
    return addServiceWorker({
      buildRoot: 'build/unbundled',
      project: polymerProject,
      swConfig: swConfig,
    });
  });

  // Once the bundled build stream is complete, create a service worker for the build
  const bundledPostProcessing = Promise.all([loadSWConfig, waitFor(bundledPhase)]).then((results) => {
    const swConfig: SWConfig = results[0];
    return addServiceWorker({
      buildRoot: 'build/bundled',
      project: polymerProject,
      swConfig: swConfig,
      bundled: true,
    });
  });

  await Promise.all([unbundledPostProcessing, bundledPostProcessing]);
  logger.info('Build complete!');
}
