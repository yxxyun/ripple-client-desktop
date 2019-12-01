/* globals require, console */

'use strict';

var gulp = require('gulp'),
  shell = require('gulp-shell'),
  merge = require('merge-stream'),
  modRewrite = require('connect-modrewrite'),
  webpack = require('webpack'),
  jade = require('jade'),
  jadeL10n = require('jade-l10n'),
  NwBuilder = require('nw-builder'),
  useref = require('gulp-useref'),
  gulpWebpack = require('webpack-stream'),
  meta = require('./package.json'),
  languages = require('./l10n/languages.json').active;

var $ = require('gulp-load-plugins')({
  pattern: ['gulp-*', 'del', 'browser-sync']
});

var BUILD_DIR = '.build/';
var TMP_DIR = '.tmp/';
var PACKAGES_FOLDER = 'packages/';
var APP_NAME = meta.name + '-' + meta.version

require('events').EventEmitter.prototype._maxListeners = 100;

// Clean the build folder
gulp.task('clean:dev', function(done) {
  $.del.sync([
    TMP_DIR + 'js',
    TMP_DIR + 'templates',
    TMP_DIR + 'main.css',
    TMP_DIR + 'index.html'
  ]);
  done();
});

gulp.task('clean:dist', function (done) {
  $.del.sync([BUILD_DIR + '*']);
  done();
});

// Webpack
gulp.task('webpack:vendor:dev', function() {
  return gulp.src('src/js/entry/vendor.js')
    .pipe(gulpWebpack({
      mode: 'development',
      node: {
        fs: 'empty'
      },
      output: {
        filename: 'vendor.js'
      },
      module: {
        rules: [
          { test: /\.js$/, exclude: /node_modules/, loader: 'babel-loader' }
        ]
      },
      resolve: {
        alias: {
          'bignumber.js$': 'bignumber.js/bignumber.js'
        }
      },
      target: 'node-webkit',
      cache: true,
    }))
    .pipe(gulp.dest(TMP_DIR + 'js/'))
    .pipe($.browserSync.reload({stream:true}));
});

gulp.task('webpack:vendor:dist', function() {
  return gulp.src('src/js/entry/vendor.js')
    .pipe(gulpWebpack({
      mode: 'production',
      node: {
        fs: 'empty'
      },
      output: {
        filename: "vendor.js"
      },
      module: {
        rules: [
          { test: /\.js$/, exclude: /node_modules/, loader: 'babel-loader' }
        ]
      },
      target: 'node-webkit',
      cache: true,
    }))
    .pipe(gulp.dest(BUILD_DIR + 'js/'))
});

gulp.task('webpack:dev', function() {
  // TODO jshint
  // TODO move to js/entry.js
  return gulp.src('src/js/entry/entry.js')
    .pipe(gulpWebpack({
      mode: 'development',
      node: {
        fs: 'empty'
      },
      module: {
        rules: [
          { test: /\.jade$/, loader: "jade-loader" },
        ]
      },
      output: {
        filename: "app.js"
      },
      target: 'node-webkit',
      cache: true,
    }))
    .pipe(gulp.dest(TMP_DIR + 'js/'))
    .pipe($.browserSync.reload({stream:true}));
});

gulp.task('webpack:dist', function() {
  return gulp.src('src/js/entry/entry.js')
    .pipe(gulpWebpack({
      mode: 'production',
      node: {
        fs: 'empty'
      },
      module: {
        rules: [
          { test: /\.jade$/, loader: "jade-loader" },
        ]
      },
      output: {
        filename: "app.js"
      },
      target: 'node-webkit',
      cache: true,
      plugins: [
        new webpack.BannerPlugin('Ripple Admin Console v' + meta.version + '\nCopyright (c) ' + new Date().getFullYear() + ' ' + meta.author.name + '\nLicensed under the ' + meta.license + ' license.')
      ]
    }))
    .pipe(gulp.dest(BUILD_DIR + 'js/'));
});

// TODO SASS
// Less
gulp.task('less', function () {
  return gulp.src('src/less/ripple/main.less')
    .pipe($.less({
      paths: ['src/less']
    }))
    .pipe(gulp.dest(TMP_DIR))
    .pipe($.browserSync.reload({stream:true}));
});

// Extracts l10n strings from template files
gulp.task('l10nExtract', function () {
  return gulp.src('src/templates/**/*.jade')
    .pipe($.jadeL10nExtractor({
      filename: 'messages.pot'
    }))
    .pipe(gulp.dest('./l10n/templates'))
});

// Static server
gulp.task('serve', function(done) {
  $.browserSync({
    open: false,
    server: {
      baseDir: [".", TMP_DIR, "./res", "./deps/js", ''],
      middleware: [
        modRewrite([
          '!\\.html|\\.js|\\.css|\\.png|\\.jpg|\\.gif|\\.svg|\\.txt|\\.eot|\\.woff|\\.woff2|\\.ttf$ /index.html [L]'
        ])
      ]
    }
  });
  done();
});

// Launch node-webkit
gulp.task('nwlaunch', shell.task(['node_modules/.bin/nw --mixed-context']));

// Static files
gulp.task('static', function() {
  // package.json
  var pkg = gulp.src(['src/package.json'])
    .pipe(gulp.dest(BUILD_DIR));

  var icons = gulp.src(['icons/**/*'])
    .pipe(gulp.dest(BUILD_DIR + 'icons/'));

  var res = gulp.src(['res/**/*'])
    .pipe(gulp.dest(BUILD_DIR));

  var fonts = gulp.src(['fonts/**/*', 'node_modules/font-awesome/fonts/**/*'])
    .pipe(gulp.dest(BUILD_DIR + 'fonts/'));

  // Images
  var images = gulp.src('img/**/*')
    .pipe(gulp.dest(BUILD_DIR + 'img/'));

  return merge(pkg, icons, res, fonts, images);
});

// Version branch
gulp.task('gitVersion', function (cb) {
  require('child_process').exec('git rev-parse --abbrev-ref HEAD', function(err, stdout) {
    meta.gitVersionBranch = stdout.replace(/\n$/, '');

    require('child_process').exec('git describe --tags --always', function(err, stdout) {
      meta.gitVersion = stdout.replace(/\n$/, '');

      cb(err)
    })
  })
});

// Preprocess
gulp.task('preprocess:dev', function() {
  return gulp.src(TMP_DIR + 'templates/en/index.html')
    .pipe($.preprocess({
      context: {
        MODE: 'dev',
        VERSION: meta.gitVersion,
        VERSIONBRANCH: meta.gitVersionBranch,
        VERSIONFULL: meta.gitVersion + '-' + meta.gitVersionBranch
      }
    }))
    .pipe(gulp.dest(TMP_DIR))
});

gulp.task('preprocess:dist', function() {
  return gulp.src(BUILD_DIR + 'templates/en/index.html')
    .pipe($.preprocess({
      context: {
        MODE: 'dist',
        VERSION: meta.gitVersion,
        VERSIONBRANCH: meta.gitVersionBranch,
        VERSIONFULL: meta.gitVersion
      }
    }))
    .pipe(gulp.dest(BUILD_DIR))
});

// Languages
gulp.task('templates:dev', function () {
  return gulp.src('src/templates/**/*.jade')
    // filter out unchanged partials
    .pipe($.cached('jade'))

    // find files that depend on the files that have changed
    .pipe($.jadeInheritance({basedir: 'src/templates'}))

    // filter out partials (folders and files starting with "_" )
    .pipe($.filter(function (file) {
      return !/\/_/.test(file.path) && !/^_/.test(file.relative);
    }))

    .pipe($.jade({
      jade: jade,
      pretty: true
    }))
    .pipe(gulp.dest(TMP_DIR + 'templates/en'))
});

gulp.task('templates:dist', function() {
  return gulp.src('src/templates/**/*.jade')
    .pipe($.jade({
      jade: jadeL10n,
      languageFile: 'l10n/en/messages.po',
      pretty: true
    }))
    .pipe(gulp.dest(BUILD_DIR + 'templates/en'));
});

// Default Task (Dev environment, no showDevTools)
gulp.task('default',
  gulp.series(
    gulp.parallel('clean:dev', 'less', 'templates:dev',  'gitVersion'),
    'webpack:dev',
    'webpack:vendor:dev',
    'preprocess:dev',
    'serve',
    'nwlaunch'
  ),
 function(done) {
  // Webpack
  gulp.watch(['src/js/**/*.js', 'config.js', '!src/js/entry/vendor.js'], gulp.task('webpack:dev'));

  // Webpack for vendor files
  gulp.watch(['src/js/entry/vendor.js'], gulp.task('webpack:vendor:dev'));

  // Templates
  gulp.watch(['src/templates/**/*.jade'], gulp.task('templates:dev'));

  // index.html preprocessing
  $.watch(TMP_DIR + 'templates/en/*.html', function(){
    gulp.start('preprocess:dev');
  });

  // Reload
  $.watch(TMP_DIR + 'templates/**/*', $.browserSync.reload);

  gulp.watch('src/less/**/*', gulp.task('less'));

  done();
});

gulp.task('setdebug', function (done) {
  process.env.DEBUG = 'true';
  done();
});

// Dev Task (Dev environment, showDevTools)
gulp.task('dev',
  gulp.series(
    gulp.parallel('clean:dev', 'less', 'templates:dev', 'gitVersion', 'setdebug'),
    'webpack:dev',
    'webpack:vendor:dev',
    'preprocess:dev',
    'serve',
    'nwlaunch'
  ),
 function(done) {
  // Webpack
  gulp.watch(['src/js/**/*.js', 'config.js', '!src/js/entry/vendor.js'], gulp.task('webpack:dev'));

  // Webpack for vendor files
  gulp.watch(['src/js/entry/vendor.js'], gulp.task('webpack:vendor:dev'));

  // Templates
  gulp.watch(['src/templates/**/*.jade'], gulp.task('templates:dev'));

  // index.html preprocessing
  $.watch(TMP_DIR + 'templates/en/*.html', function(){
    gulp.start('preprocess:dev');
  });

  // Reload
  $.watch(TMP_DIR + 'templates/**/*', $.browserSync.reload);

  gulp.watch('src/less/**/*', gulp.task('less'));

  done();
});

gulp.task('deps', function () {

  return gulp.src([BUILD_DIR + 'index.html'])
    // Concatenates asset files from the build blocks inside the HTML
    .pipe(useref())
    // Adds AngularJS dependency injection annotations
    // We don't need this, cuz the app doesn't go thru this anymore
    //.pipe($.if('*.js', $.ngAnnotate()))
    // Uglifies js files
    .pipe($.if('*.js', $.uglify()))
    // Minifies css files
    .pipe($.if('*.css', $.csso()))
    // Minifies html
    .pipe($.if('*.html', $.minifyHtml({
      empty: true,
      spare: true,
      quotes: true
    })))
    // Creates the actual files
    .pipe(gulp.dest(BUILD_DIR))
    // Print the file sizes
    .pipe($.size({ title: BUILD_DIR, showFiles: true }));
});

// Build packages
gulp.task('build', function() {
  var nw = new NwBuilder({
    files: [BUILD_DIR + '**/**'],
    platforms: ['linux'],
    flavor: 'normal',
    // TODO: Use these instead of the nested app/package.json values
    appName: APP_NAME,
    appVersion: meta.version,
    buildDir: PACKAGES_FOLDER,
    zip: true,
    cacheDir: TMP_DIR,
    // TODO: timestamped versions
    macIcns: './res/dmg/xrp_ripple_logo.icns',
    winIco: './res/dmg/xrp_ripple_logo.ico'
  });

  return nw.build()
    .catch(function (error) {
      console.error(error);
    });
});

// Zip packages
gulp.task('zip', function() {
  // Zip the packages
  var linux32 = gulp.src(PACKAGES_FOLDER + APP_NAME + '/linux32/**/*')
    .pipe($.zip('linux32.zip'))
    .pipe(gulp.dest(PACKAGES_FOLDER + APP_NAME));

  var linux64 = gulp.src(PACKAGES_FOLDER + APP_NAME + '/linux64/**/*')
    .pipe($.zip('linux64.zip'))
    .pipe(gulp.dest(PACKAGES_FOLDER + APP_NAME));

  var osx32 = gulp.src(PACKAGES_FOLDER + APP_NAME + '/osx32/**/*')
    .pipe($.zip('osx32.zip'))
    .pipe(gulp.dest(PACKAGES_FOLDER + APP_NAME));

  var osx64 = gulp.src(PACKAGES_FOLDER + APP_NAME + '/osx64/**/*')
    .pipe($.zip('osx64.zip'))
    .pipe(gulp.dest(PACKAGES_FOLDER + APP_NAME));

  var win32 = gulp.src(PACKAGES_FOLDER + APP_NAME + '/win32/**/*')
    .pipe($.zip('win32.zip'))
    .pipe(gulp.dest(PACKAGES_FOLDER + APP_NAME));

  var win64 = gulp.src(PACKAGES_FOLDER + APP_NAME + '/win64/**/*')
    .pipe($.zip('win64.zip'))
    .pipe(gulp.dest(PACKAGES_FOLDER + APP_NAME));

  return merge(linux32, linux64, osx32, osx64, win32, win64);
});

// Final product
gulp.task('packages', gulp.series(
    gulp.parallel('clean:dist', 'less', 'templates:dist', 'static', 'gitVersion'),
    'webpack:dist',
    'webpack:vendor:dist',
    'preprocess:dist',
    'deps',
    'build',
    'zip'
  ), function(done) { done(); }
);
