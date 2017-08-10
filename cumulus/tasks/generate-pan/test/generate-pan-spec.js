'use strict';
const expect = require('expect.js');
const helpers = require('cumulus-common/test-helpers');
const fs = require('fs');
const pan = require('../pan');

const allSuccessFixture = require('./fixtures/all-success-fixture');
const missingFileFixutre = require('./fixtures/missigng-file-fixture');

const timeStamp = (dateTime) => dateTime.toISOString().replace(/\.\d\d\dZ/, 'Z');

const shortPan = (dateTime) =>
`MESSAGE_TYPE = SHORTPAN;
DISPOSITION = "SUCCESSFUL";
TIME_STAMP = ${timeStamp(dateTime)};`;

describe('generate-pan.handler', () => {
  let result;
  let input;
  let timeStampStr;


  // beforeEach((done) => {
  //   result = pan.generatePan(input, timeStampStr);
  // });

  it('generates a short PAN if all files succeed', () => {
    input = allSuccessFixture.input;
    const now = new Date();
    timeStampStr = timeStamp(now);
    result = pan.generatePan(input, timeStampStr);
    expect(result).to.equal(shortPan(now));
  });

  it('generates a long pan with an entry for the number of files (NO_OF_FILES)', () => {
    input = missingFileFixutre.input;
    const now = new Date();
    timeStampStr = timeStamp(now);
    result = pan.generatePan(input, timeStampStr);
    const numFilesEntry = result.match(/NO_OF_FILES = (\d+);/)[1];
    expect(parseInt(numFilesEntry, 10)).to.equal(input.length);
  });

  // it('generates a timestamp for each file entry', () => {
  //   input = missingFileFixutre.input;
  //   const now = new Date();
  //   timeStampStr = timeStamp(now);
  //   const timeStampEntry = `TIMESTAMP = ${timeStampStr}`;
  //   result = pan.generatePan(input, timeStampStr);

  // });
});

