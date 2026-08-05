const path = require('path');

// Points browserslist straight at an in-project stats file so it never walks
// up parent directories looking for one. That walk fails under Hugo's
// sandboxed Node execution, which restricts fs reads to the project root.
process.env.BROWSERSLIST_STATS = path.join(__dirname, 'browserslist-stats.json');

module.exports = {
  plugins: [
    require('autoprefixer'),
    require('cssnano')({ preset: 'default' }),
  ],
};
