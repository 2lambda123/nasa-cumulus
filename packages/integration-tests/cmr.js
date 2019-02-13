'use strict';

const got = require('got');
const pWaitFor = require('p-wait-for');
const xml2js = require('xml2js');
const { s3 } = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const { sleep } = require('@cumulus/common/util');

const ONE_SECOND = 1000;
const THREE_SECONDS = 3000;
const ONE_MINUTE = 60000;

/**
 * Sample granule used to update fields and save as a .cmr.xml file
 */
const sampleEcho10Granule = {
  Granule: {
    GranuleUR: 'MYD13Q1.A2017297.h19v10.006.2017313221202',
    InsertTime: '2018-04-25T21:45:45.524043',
    LastUpdate: '2018-04-25T21:45:45.524053',
    Collection: {
      ShortName: 'MYD13Q1',
      VersionId: '006'
    },
    Temporal: {
      RangeDateTime: {
        BeginningDateTime: '2017-10-24T00:00:00Z',
        EndingDateTime: '2017-11-08T23:59:59Z'
      }
    },
    Spatial: {
      HorizontalSpatialDomain: {
        Geometry: {
          GPolygon: {
            Boundary: {
              Point: [
                {
                  PointLongitude: '10.598766856250499',
                  PointLatitude: '-20.004533998735798'
                },
                {
                  PointLongitude: '10.116488181247300',
                  PointLatitude: '-9.963464459448231'
                },
                {
                  PointLongitude: '20.318223437416400',
                  PointLatitude: '-9.958850980581371'
                },
                {
                  PointLongitude: '21.290997939442398',
                  PointLatitude: '-19.999772984245801'
                }
              ]
            }
          }
        }
      }
    },
    TwoDCoordinateSystem: {
      StartCoordinate1: '19',
      StartCoordinate2: '10',
      TwoDCoordinateSystemName: 'MODIS Tile SIN'
    },
    OnlineAccessURLs: [{
      OnlineAccessURL: {
        URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
        URLDescription: 'File to download'
      }
    }],
    Orderable: 'true',
    Visible: 'true',
    CloudCover: '13'
  }
};

const sampleUmmGranule = {
  SpatialExtent: {
    HorizontalSpatialDomain: {
      Geometry: {
        BoundingRectangles: [
          {
            WestBoundingCoordinate: -180,
            EastBoundingCoordinate: 180,
            NorthBoundingCoordinate: 90,
            SouthBoundingCoordinate: -90
          }
        ]
      }
    }
  },
  ProviderDates: [
    {
      Date: '2018-12-19T17:30:31.424Z',
      Type: 'Insert'
    }
  ],
  DataGranule: {
    DayNightFlag: 'Unspecified',
    ProductionDateTime: '2016-01-09T11:40:45.032Z',
    ArchiveAndDistributionInformation: [
      {
        Name: 'Not provided',
        Size: 1.009857177734375,
        SizeUnit: 'NA'
      }
    ]
  },
  TemporalExtent: {
    RangeDateTime: {
      BeginningDateTime: '2016-01-09T11:40:45.032Z',
      EndingDateTime: '2016-01-09T11:41:12.027Z'
    }
  }
};

/**
 * Returns true if the concept exists - if the cmrLink
 * returns a 200 and there are entries
 *
 * @param {string} cmrLink
 *   CMR URL path to concept, i.e. what is returned from post to cmr task
 *   See `@cumulus/cmrjs/cmr-utils/publishECHO10XML2CMR` for expected URL
 * @returns {boolean} true if the concept exists in CMR, false if not
 */
async function conceptExists(cmrLink) {
  const response = await got.get(cmrLink, { json: true });

  if (response.statusCode !== 200) return false;

  return response.body.feed.entry.length > 0;
}

/**
 * Returns true if the concept exists - if the cmrLink
 * returns a 200 and there are entries
 *
 * @param {string} cmrLink
 *   CMR URL path to concept, i.e. what is returned from post to cmr task
 *   See `@cumulus/cmrjs/cmr-utils/publishUMMGJSON2CMR` for expected URL
 * @returns {boolean} true if the concept exists in CMR, false if not
 */
async function conceptExistsUMMG(cmrLink) {
  const response = await got.get(cmrLink, { json: true });

  if (response.statusCode !== 200) return false;

  return response.body.items.length > 0;
}

// See https://bugs.earthdata.nasa.gov/browse/CUMULUS-962
const waitForCmrToBeConsistent = () => sleep(ONE_SECOND);

/**
 * Checks for granule in CMR until it get the desired outcome or hits
 * the number of retries.
 *
 * @param {string} cmrLink - url for granule in CMR
 * @param {boolean} expectation - whether concept should exist (true) or not (false)
 * @returns {Promise<undefined>}
 * @throws {TimeoutError} - throws error when timeout is reached
 */
async function waitForConceptExistsOutcome(cmrLink, expectation) {
  try {
    await pWaitFor(
      async () => (await conceptExists(cmrLink)) === expectation,
      { interval: THREE_SECONDS, timeout: ONE_MINUTE }
    );

    await waitForCmrToBeConsistent();
  }
  catch (err) {
    console.error('waitForConceptExistsOutcome() failed:', err);
    throw err;
  }
}

/**
 * Get the online resource links from the CMR objects
 *
 * @param {string} cmrLink
 *   CMR URL path to concept, i.e. what is returned from post to cmr task
 * @returns {Array<Object>} Array of link objects in the format
 * { inherited: true,
    rel: 'http://esipfed.org/ns/fedsearch/1.1/metadata#',
    hreflang: 'en-US',
    href: 'https://opendap.cr.usgs.gov/opendap/hyrax/MYD13Q1.006/contents.html' }
 */
async function getOnlineResources(cmrLink) {
  const response = await got.get(cmrLink);

  if (response.statusCode !== 200) {
    return null;
  }

  const body = JSON.parse(response.body);

  const links = body.feed.entry.map((e) => e.links);

  // Links is a list of a list, so flatten to be one list
  return [].concat(...links);
}

/**
 * Get the online resource links from the CMR objects for UMM-G
 *
 * @param {string} cmrLink
 *   CMR URL path to concept, i.e. what is returned from post to cmr task
 * @returns {Array<Object>} Array of link objects in the format
 * { URL: "https://example.com/cumulus-test-sandbox-protected/MOD09GQ___006/2016/MOD/MOD09GQ.A0794505._4kqJd.006.9457902462263.hdf",
    Description: "File to download",
    Type: "GET DATA" }
 */
async function getOnlineResourcesUMMG(cmrLink) {
  const response = await got.get(cmrLink);

  if (response.statusCode !== 200) {
    return null;
  }

  const body = JSON.parse(response.body);

  const links = body.items.map((item) => item.umm.RelatedUrls);

  // Links is a list of a list, so flatten to be one list
  return [].concat(...links);
}

/**
 * Generate a granule xml and store to the given S3 bucket
 *
 * @param {Object} granule - granule object
 * @param {Object} collection - collection object
 * @param {string} bucket - bucket to save the xml file to
 * @param {Array<string>} additionalUrls - URLs to convert to online resources
 * @returns {Promise<Array<string>>} - Promise of a list of granule files including the created
 * CMR xml files
 */
async function generateAndStoreCmrXml(granule, collection, bucket, additionalUrls) {
  const xmlObject = sampleEcho10Granule;
  xmlObject.Granule.GranuleUR = granule.granuleId;

  xmlObject.Granule.Collection = {
    ShortName: collection.name,
    VersionId: collection.version
  };

  const granuleFiles = granule.files.map((f) => f.filename);

  if (additionalUrls) {
    xmlObject.Granule.OnlineAccessURLs = additionalUrls.map((url) => ({
      OnlineAccessURL: {
        URL: url,
        URLDescription: 'File to download'
      }
    }));
  }

  const builder = new xml2js.Builder();
  const xml = builder.buildObject(xmlObject);

  const stagingDir = granule.files[0].fileStagingDir;

  const filename = `${stagingDir}/${granule.granuleId}.cmr.xml`;

  const params = {
    Bucket: bucket,
    Key: filename,
    Body: xml,
    Tagging: `granuleId=${granule.granuleId}`
  };

  await s3().putObject(params).promise();

  granuleFiles.push(`s3://${bucket}/${filename}`);
  log.info(`s3://${bucket}/${filename}`);
  log.info(granuleFiles);
  return granuleFiles;
}

/**
 * Generate granule UMM-G JSON file based on the sample UMM-G and store
 * it to S3 in the file staging area
 *
 * @param {Object} granule - granule object
 * @param {Object} collection - collection object
 * @param {string} bucket - bucket to save the xml file to
 * @param {Array<string>} additionalUrls - URLs to convert to related urls
 * @returns {Promise<Array<string>>} - Promise of a list of granule files including the created
 * CMR files
 */
async function generateAndStoreCmrUmmJson(granule, collection, bucket, additionalUrls) {
  const jsonObject = sampleUmmGranule;
  jsonObject.GranuleUR = granule.granuleId;

  jsonObject.CollectionReference = {
    ShortName: collection.name,
    Version: collection.version
  };

  if (additionalUrls) {
    jsonObject.RelatedUrls = additionalUrls.map((url) => ({
      URL: url,
      Type: 'GET DATA'
    }));
  }

  const stagingDir = granule.files[0].fileStagingDir;

  const filename = `${stagingDir}/${granule.granuleId}.cmr.json`;

  const params = {
    Bucket: bucket,
    Key: filename,
    Body: JSON.stringify(jsonObject),
    Tagging: `granuleId=${granule.granuleId}`
  };

  await s3().putObject(params).promise();

  const granuleFiles = granule.files.map((f) => f.filename);
  granuleFiles.push(`s3://${bucket}/${filename}`);
  log.info(`s3://${bucket}/${filename}`);
  log.info(granuleFiles);
  return granuleFiles;
}

/**
 * Generate .cmr.xml files for the granules and store them in S3 to the
 * given S3 location
 *
 * @param {Array<Object>} granules - list of granules in the format of the sync-granules
 * output
 * @param {Object} collection - collection object that includes name and version
 * @param {string} bucket - location to save the xmls to
 * @param {string} cmrFileType - CMR file type to generate. Options are echo10, umm_json_v1_4, default
 * is echo10
 * @param {Array<string>} additionalUrls - URLs to convert to online resources or related urls
 * @returns {Array<string>} list of S3 locations for CMR xml files
 */
async function generateCmrFilesForGranules(
  granules,
  collection,
  bucket,
  cmrFileType,
  additionalUrls
) {
  let files;

  log.info(`Generating fake CMR file with type ${cmrFileType}`);

  if (cmrFileType === 'umm_json_v1_4') {
    // When we do UMM-G 1.5, we'll probably need to pass the file type into this function
    files = await Promise.all(granules.map((g) =>
      generateAndStoreCmrUmmJson(g, collection, bucket, additionalUrls)));
  }
  else {
    files = await Promise.all(granules.map((g) =>
      generateAndStoreCmrXml(g, collection, bucket, additionalUrls)));
  }

  return [].concat(...files);
}

module.exports = {
  conceptExists,
  conceptExistsUMMG,
  getOnlineResources,
  getOnlineResourcesUMMG,
  generateCmrFilesForGranules,
  waitForConceptExistsOutcome
};
