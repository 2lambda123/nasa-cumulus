/* eslint no-console: "off" */

'use strict';

const git = require('simple-git');

function determineIntegrationTestStackName(cb) {
  const branch = process.env.BRANCH;

  if (!branch) return cb('none');

  // Nightly cron job
  //if (process.env.TRAVIS_EVENT_TYPE === 'cron') return cb('cumulus-nightly');

  if (branch === 'master') return cb('cumulus-source');

  const stacks = {
    'Jenny Liu': 'jl',
    jennyhliu: 'jl',
    kkelly51: 'kk2',
    'Katherine Kelly': 'kk2',
    'Lauren Frederick': 'lf-test',
    laurenfrederick: 'lf-test',
    'Mark Boyd': 'mboyd-int',
    'Matt Savoie': 'mhs',
    'Jonathan Kovarik': 'jk',
    Menno: 'mvd',
    'Menno Van Diermen': 'mvd',
    'Jennifer Tran': 'jtran-int',
    'Nate Pauzenga': 'np-ci',
    'Danielle Peters': 'dop-ci',
    'Anthony Ortega': 'jao-ci',
    vpnguye2: 'vkn-ci',
  };

  return git('.').log({ '--max-count': '1' }, (e, r) => {
    const author = r.latest.author_name;

    console.error(`Selecting build stack based on author name: "${author}"`);

    if (author && stacks[author]) {
      return cb(stacks[author]);
    }
    return cb('cumulus-from-pr');
  });
}

determineIntegrationTestStackName(console.log);
