/* eslint-disable no-console, no-param-reassign */

'use strict';

const fs = require('fs-extra');
const path = require('path');
const utils = require('kes').utils;
const { Lambda } = require('kes');

/**
 * A sub-class of the Kes Lambda class that changes
 * how kes handles Lambda function compression and
 * upload to S3.
 *
 * This sub-class adds cumulus-message-adapter to
 * lambdas defined in a Kes configuration file.
 */
class UpdatedLambda extends Lambda {
  /**
   * Override the main constructor to allow
   * passing the config object to the instance
   * of the class
   *
   * @param {Object} config - Kes config object
   */
  constructor(config) {
    super(config);
    this.config = config;
  }
  /**
   * Copies the source code of a given lambda function, zips it, calculates
   * the hash of the source code and updates the lambda object with
   * the hash, local and remote locations of the code
   *
   * @param {Object} lambda - the lambda object
   * @returns {Promise} returns the updated lambda object
   */
  zipLambda(lambda) {
    let msg = `Zipping ${lambda.local}`;
    // skip if the file with the same hash is zipped
    if (fs.existsSync(lambda.local)) {
      return Promise.resolve(lambda);
    }
    const fileList = [lambda.source];

    if (lambda.useMessageAdapter) {
      const kesFolder = path.join(this.config.kesFolder, 'build', 'adapter');
      fileList.push(kesFolder);
      msg += ' and injecting message adapter';
    }

    console.log(`${msg} for ${lambda.name}`);

    return utils.zip(lambda.local, fileList).then(() => lambda);
  }

  /**
   * Overrides the default method to allow returning
   * the lambda function after s3 paths were built
   *
   * @param {Object} lambda - the Lambda object
   * @returns {Object} the updated lambda object
   */
  buildS3Path(lambda) {
    lambda = super.buildS3Path(lambda);
    // adding the hash of the message adapter zip file as part of lambda zip file
    if (lambda.useMessageAdapter && UpdatedLambda.messageAdapterZipFileHash) {
      lambda.local = path.join(
        path.dirname(lambda.local),
        `${UpdatedLambda.messageAdapterZipFileHash}-${path.basename(lambda.local)}`
      );
      lambda.remote = path.join(
        path.dirname(lambda.remote),
        `${UpdatedLambda.messageAdapterZipFileHash}-${path.basename(lambda.remote)}`
      );
    }

    return lambda;
  }
}

module.exports = UpdatedLambda;

UpdatedLambda.messageAdapterZipFileHash = undefined;
