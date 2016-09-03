'use strict';

const fs = require('fs');

const gulp = require('gulp');
const ts = require('gulp-typescript');
const babel = require('gulp-babel');
const uglify = require('gulp-uglify');
const del = require('del');
const mkdirp = require('mkdirp');


const TS_PROJ_FILE = 'src/tsconfig.json';
const tsProject = ts.createProject(TS_PROJ_FILE, { typescript: require('typescript') });


//------------------------------------------------------------------------------
function swallowError(error) {
  console.log(error.toString());
  this.emit('end');
}

////////////////////////////////////////////////////////////////////////////////
gulp.task('typescript', [], () => {
  const dest = 'lib';
  let tsResult = tsProject.src().pipe(ts(tsProject));
  tsResult.dts.pipe(gulp.dest(dest));
  return tsResult.js.pipe(gulp.dest(dest));
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('es5', [], () => {
  let tsResult = tsProject.src()
    .pipe(ts(tsProject));

  tsResult.dts.pipe(gulp.dest('lib5'));

  return tsResult.js
    .pipe(babel({ presets: ['es2015'] }).on('error', swallowError))
    .pipe(gulp.dest('lib5'));
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('cleanup:dist', () => {
  return del(['../mi-lib-dist/**/*'], { force: true });
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('typescript:dist', ['cleanup:dist'], () => {
  let tsProject = ts.createProject(TS_PROJ_FILE);
  return tsProject.src()
    .pipe(ts(tsProject))
    .js
    .pipe(babel({ presets: ['es2015'] }))
    .pipe(uglify())
    .pipe(gulp.dest('../mi-lib-dist/lib'));
});

////////////////////////////////////////////////////////////////////////////////
gulp.task('copy:dist', ['cleanup:dist'], () => {
  return gulp.src(['bin/**', 'data/dict/**', 'package.json'], { base: '.' })
    .pipe(gulp.dest('../mi-lib-dist/'));
});
