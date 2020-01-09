'use strict';

const fs = require('fs-extra');
const get = require('lodash.get');
const cloneDeep = require('lodash.clonedeep');
const flatten = require('lodash.flatten');
const os = require('os');
const path = require('path');
const uuidv4 = require('uuid/v4');
const {
  aws,
  CollectionConfigStore,
  constructCollectionId,
  log,
  errors
} = require('@cumulus/common');
const { buildProviderClient } = require('./providerClientUtils');
const { handleDuplicateFile } = require('./granule');

class GranuleFetcher {
  /**
   * Constructor for GranuleFetcher class
   *
   * @param {Object} buckets - s3 buckets available from config
   * @param {Object} collection - collection configuration object
   * @param {Object} provider - provider configuration object
   * @param {string} fileStagingDir - staging directory on bucket,
   * files will be placed in collectionId subdirectory
   * @param {boolean} duplicateHandling - duplicateHandling of a file
   */
  constructor(
    buckets,
    collection,
    provider,
    fileStagingDir = 'file-staging',
    duplicateHandling = 'error'
  ) {
    this.buckets = buckets;
    this.collection = collection;
    this.checksumFiles = {};
    this.supportedChecksumFileTypes = ['md5', 'cksum', 'sha1', 'sha256'];

    if (fileStagingDir && fileStagingDir[0] === '/') this.fileStagingDir = fileStagingDir.substr(1);
    else this.fileStagingDir = fileStagingDir;

    this.duplicateHandling = duplicateHandling;

    // default collectionId, could be overwritten by granule's collection information
    if (this.collection) {
      this.collectionId = constructCollectionId(
        this.collection.dataType || this.collection.name, this.collection.version
      );
    }

    this.providerClient = buildProviderClient({
      cmKeyId: provider.cmKeyId,
      encrypted: provider.encrypted,
      host: provider.host,
      password: provider.password,
      port: provider.port,
      privateKey: provider.privateKey,
      protocol: provider.protocol,
      username: provider.username
    });
  }

  connected() {
    return get(this.providerClient, 'connected', false);
  }

  end() {
    return this.providerClient.end ? this.providerClient.end() : undefined;
  }

  /**
   * Ingest all files in a granule
   *
   * @param {Object} granule - granule object
   * @param {string} bucket - s3 bucket to use for files
   * @returns {Promise<Object>} return granule object
   */
  async ingest(granule, bucket) {
    // for each granule file
    // download / verify integrity / upload

    const stackName = process.env.stackName;
    let dataType = granule.dataType;
    let version = granule.version;

    // if no collection is passed then retrieve the right collection
    if (!this.collection) {
      if (!granule.dataType || !granule.version) {
        throw new Error(
          'Downloading the collection failed because dataType or version was missing!'
        );
      }
      const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
      this.collection = await collectionConfigStore.get(granule.dataType, granule.version);
    } else {
      // Collection is passed in, but granule does not define the dataType and version
      if (!dataType) dataType = this.collection.dataType || this.collection.name;
      if (!version) version = this.collection.version;
    }

    // make sure there is a url_path
    this.collection.url_path = this.collection.url_path || '';

    this.collectionId = constructCollectionId(dataType, version);

    const downloadFiles = granule.files
      .filter((f) => this.filterChecksumFiles(f))
      .map((f) => this.ingestFile(f, bucket, this.duplicateHandling));

    log.debug('awaiting all download.Files');
    const files = flatten(await Promise.all(downloadFiles));
    log.debug('finished ingest()');
    return {
      granuleId: granule.granuleId,
      dataType: dataType,
      version: version,
      files
    };
  }

  /**
   * set the url_path of a file based on collection config.
   * Give a url_path set on a file definition higher priority
   * than a url_path set on the min collection object.
   *
   * @param {Object} file - object representing a file of a granule
   * @returns {Object} file object updated with url+path tenplate
   */
  getUrlPath(file) {
    let urlPath = '';

    this.collection.files.forEach((fileDef) => {
      const test = new RegExp(fileDef.regex);
      const match = file.name.match(test);

      if (match && fileDef.url_path) {
        urlPath = fileDef.url_path;
      }
    });

    if (!urlPath) {
      urlPath = this.collection.url_path;
    }

    return urlPath;
  }

  /**
   * Find the collection file config that applies to the given file
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object|undefined} a collection file config or undefined
   * @private
   */
  findCollectionFileConfigForFile(file) {
    return this.collection.files.find((fileConfig) =>
      file.name.match(fileConfig.regex));
  }

  /**
   * Add a bucket property to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with a bucket property set
   * @private
   */
  addBucketToFile(file) {
    const fileConfig = this.findCollectionFileConfigForFile(file);
    if (!fileConfig) {
      throw new Error(`Unable to update file. Cannot find file config for file ${file.name}`);
    }
    const bucket = this.buckets[fileConfig.bucket].name;

    return Object.assign(cloneDeep(file), { bucket });
  }

  /**
   * Add a url_path property to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with a url_path property set
   * @private
   */
  addUrlPathToFile(file) {
    let foundFileConfigUrlPath;

    const fileConfig = this.findCollectionFileConfigForFile(file);
    if (fileConfig) foundFileConfigUrlPath = fileConfig.url_path;

    // eslint-disable-next-line camelcase
    const url_path = foundFileConfigUrlPath || this.collection.url_path || '';
    return Object.assign(cloneDeep(file), { url_path });
  }

  /**
   * Filter out checksum files and put them in `this.checksumFiles` object.
   * To be used with `Array.prototype.filter`.
   *
   * @param {Object} file - file object from granule.files
   * @returns {boolean} - whether file was a supported checksum or not
   */
  filterChecksumFiles(file) {
    let unsupported = true;
    this.supportedChecksumFileTypes.forEach((type) => {
      const ext = `.${type}`;
      if (file.name.indexOf(ext) > 0) {
        this.checksumFiles[file.name.replace(ext, '')] = file;
        unsupported = false;
      }
    });

    return unsupported;
  }

  /**
   * Verify a file's integrity using its checksum and throw an exception if it's invalid.
   * Verify file's size if checksum type or value is not available.
   * Logs warning if neither check is possible.
   *
   * @param {Object} file - the file object to be checked
   * @param {string} bucket - s3 bucket name of the file
   * @param {string} key - s3 key of the file
   * @param {Object} [options={}] - options for the this._hash method
   * @returns {Array<string>} returns array where first item is the checksum algorithm,
   * and the second item is the value of the checksum.
   * Throws an error if the checksum is invalid.
   * @memberof Granule
   */
  async verifyFile(file, bucket, key, options = {}) {
    const [type, value] = await this.retrieveSuppliedFileChecksumInformation(file);
    let output = [type, value];
    if (type && value) {
      await aws.validateS3ObjectChecksum({
        algorithm: type,
        bucket,
        key,
        expectedSum: value,
        options
      });
    } else {
      log.warn(`Could not verify ${file.name} expected checksum: ${value} of type ${type}.`);
      output = [null, null];
    }
    if (file.size || file.fileSize) { // file.fileSize to be removed after CnmToGranule update
      const ingestedSize = await aws.getObjectSize(bucket, key);
      if (ingestedSize !== (file.size || file.fileSize)) { // file.fileSize to be removed
        throw new errors.UnexpectedFileSize(
          `verifyFile ${file.name} failed: Actual file size ${ingestedSize}`
          + ` did not match expected file size ${(file.size || file.fileSize)}`
        );
      }
    } else {
      log.warn(`Could not verify ${file.name} expected file size: ${file.size}.`);
    }
    return output;
  }

  /**
   * Enable versioning on an s3 bucket
   *
   * @param {string} bucket - s3 bucket name
   * @returns {Promise} promise that resolves when bucket versioning is enabled
   */
  async enableBucketVersioning(bucket) {
    // check that the bucket has versioning enabled
    const versioning = await aws.s3().getBucketVersioning({ Bucket: bucket }).promise();

    // if not enabled, make it enabled
    if (versioning.Status !== 'Enabled') {
      aws.s3().putBucketVersioning({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' }
      }).promise();
    }
  }

  /**
   * Retrieve supplied checksum from a file's specification or an accompanying checksum file.
   *
   * @param {Object} file - file object
   * @returns {Array} returns array where first item is the checksum algorithm,
   * and the second item is the value of the checksum
   */
  async retrieveSuppliedFileChecksumInformation(file) {
    // try to get filespec checksum data
    if (file.checksumType && file.checksum) {
      return [file.checksumType, file.checksum];
    }
    // read checksum from checksum file
    if (this.checksumFiles[file.name]) {
      const checksumInfo = this.checksumFiles[file.name];

      const checksumRemotePath = path.join(checksumInfo.path, checksumInfo.name);

      const downloadDir = await fs.mkdtemp(`${os.tmpdir()}${path.sep}`);
      const checksumLocalPath = path.join(downloadDir, checksumInfo.name);

      let checksumValue;
      try {
        await this.providerClient.download(checksumRemotePath, checksumLocalPath);
        const checksumFile = await fs.readFile(checksumLocalPath, 'utf8');
        [checksumValue] = checksumFile.split(' ');
      } finally {
        await fs.remove(downloadDir);
      }

      // default type to md5
      let checksumType = 'md5';
      // return type based on filename
      this.supportedChecksumFileTypes.forEach((type) => {
        if (checksumInfo.name.indexOf(type) > 0) {
          checksumType = type;
        }
      });

      return [checksumType, checksumValue];
    }

    // No checksum found
    return [null, null];
  }

  /**
   * Ingest individual files
   *
   * @private
   * @param {Object} file - file to download
   * @param {string} destinationBucket - bucket to put file in
   * @param {string} duplicateHandling - how to handle duplicate files
   * value can be
   * 'error' to throw an error,
   * 'replace' to replace the duplicate,
   * 'skip' to skip duplicate,
   * 'version' to keep both files if they have different checksums
   * @returns {Array<Object>} returns the staged file and the renamed existing duplicates if any
   */
  async ingestFile(file, destinationBucket, duplicateHandling) {
    const fileRemotePath = path.join(file.path, file.name);
    // place files in the <collectionId> subdirectory
    const stagingPath = path.join(this.fileStagingDir, this.collectionId);
    const destinationKey = path.join(stagingPath, file.name);

    // the staged file expected
    const stagedFile = Object.assign(cloneDeep(file),
      {
        filename: aws.buildS3Uri(destinationBucket, destinationKey),
        fileStagingDir: stagingPath,
        url_path: this.getUrlPath(file),
        bucket: destinationBucket
      });
    // bind arguments to sync function
    const syncFileFunction = this.providerClient.sync.bind(this.providerClient, fileRemotePath);

    const s3ObjAlreadyExists = await aws.s3ObjectExists(
      { Bucket: destinationBucket, Key: destinationKey }
    );
    log.debug(`file ${destinationKey} exists in ${destinationBucket}: ${s3ObjAlreadyExists}`);

    let versionedFiles = [];
    if (s3ObjAlreadyExists) {
      stagedFile.duplicate_found = true;
      const stagedFileKey = `${destinationKey}.${uuidv4()}`;
      // returns renamed files for 'version', otherwise empty array
      versionedFiles = await handleDuplicateFile({
        source: { Bucket: destinationBucket, Key: stagedFileKey },
        target: { Bucket: destinationBucket, Key: destinationKey },
        duplicateHandling,
        checksumFunction: this.verifyFile.bind(this, file),
        syncFileFunction
      });
    } else {
      log.debug(`await sync file ${fileRemotePath} to s3://${destinationBucket}/${destinationKey}`);
      await syncFileFunction(destinationBucket, destinationKey);
      // Verify file integrity
      log.debug(`await verifyFile ${JSON.stringify(file)}, s3://${destinationBucket}/${destinationKey}`);
      await this.verifyFile(file, destinationBucket, destinationKey);
    }

    // Set final file size
    stagedFile.size = await aws.getObjectSize(destinationBucket, destinationKey);
    delete stagedFile.fileSize; // CUMULUS-1269: delete obsolete field until CnmToGranule is patched
    // return all files, the renamed files don't have the same properties
    // (name, size, checksum) as input file
    log.debug(`returning ${JSON.stringify(stagedFile)}`);
    return [stagedFile].concat(versionedFiles.map((f) => (
      {
        bucket: destinationBucket,
        name: path.basename(f.Key),
        path: file.path,
        filename: aws.buildS3Uri(f.Bucket, f.Key),
        size: f.size,
        fileStagingDir: stagingPath,
        url_path: this.getUrlPath(file)
      })));
  }
}

module.exports = GranuleFetcher;
