'use strict';

const path = require('path');

module.exports = {
  all: true,
  clean: process.env.NYC_CLEAN !== 'false',
  silent: process.env.NYC_SILENT === 'true',
  'temp-dir': path.join(__dirname, '.nyc_output'),
  include: [
    '**',
    '!**/coverage/**',
    '!nyc.config.js'
  ]
};
