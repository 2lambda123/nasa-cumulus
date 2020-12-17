'use strict';

const awsClients = require('@cumulus/aws-client/services');
const isNil = require('lodash/isNil');

const FileUtils = require('./FileUtils');

const translateGranule = async (
  granule,
  fileUtils = FileUtils
) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await fileUtils.buildDatabaseFiles({
      s3: awsClients.s3(),
      files: granule.files,
    }),
  };
};

module.exports = {
  translateGranule,
};
