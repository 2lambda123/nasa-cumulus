'use strict';

const test = require('ava');
const fs = require('fs');
const HyraxMetadataUpdate = require('..');

test('Test return prod OPeNDAP host when no environment value supplied', async (t) => {

  const data = await HyraxMetadataUpdate.generateAddress('prod');

  t.is(data, 'https://opendap.earthdata.nasa.gov');
});

test('Test return prod OPeNDAP url when prod environment value supplied', async (t) => {
  const event = {
    config: {
      provider: "GES_DISC",
      entryTitle: "GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC"
    },
    input: {}
  };
  const data = await HyraxMetadataUpdate.updateMetadata(event);

  t.is(data.result, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test return sit OPeNDAP host when sit environment value supplied', async (t) => {
  const data = await HyraxMetadataUpdate.generateAddress('sit');

  t.is(data, 'https://opendap.sit.earthdata.nasa.gov');
});

test('Test return uat OPeNDAP host when uat environment value supplied', async (t) => {
  const data = await HyraxMetadataUpdate.generateAddress('uat');

  t.is(data, 'https://opendap.uat.earthdata.nasa.gov');
});

test('Test return error when invalid environment supplied for host generation', async (t) => {

  const error = await t.throws(
    () => HyraxMetadataUpdate.generateAddress('foo')
  );

  t.is(error.message, 'Environment foo is not a valid environment.');
});

test('Test generate path', async (t) => {
  const event = {
    config: {
      provider: "GES_DISC",
      entryTitle: "GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC"
    },
    input: {}
  };
  const data = await HyraxMetadataUpdate.generatePath(event);

  t.is(data, 'providers/GES_DISC/collections/GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test return error when invalid provider supplied for path generation', async (t) => {
  const event = {
    config: { entryTitle: "GLDAS Catchment Land Surface Model L4 daily 0.25 x 0.25 degree V2.0 (GLDAS_CLSM025_D) at GES DISC" },
    input: {}
  };
  const error = await t.throws(
    () => HyraxMetadataUpdate.generatePath(event)
  );

  t.is(error.message, 'Provider not supplied in configuration. Unable to construct path');
});

test('Test return error when invalid entry title supplied for path generation', async (t) => {
  const event = {
    config: { provider: "GES_DISC" },
    input: {}
  };
  const error = await t.throws(
    () => HyraxMetadataUpdate.generatePath(event)
  );

  t.is(error.message, 'Entry Title not supplied in configuration. Unable to construct path');
});

test('Test native id extraction from UMM-G', async (t) => {
  var data = null;

  data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');

  const result = await HyraxMetadataUpdate.getNativeId(data);

  t.is(result, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test native id extraction from ECHO10', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');

  const result = await HyraxMetadataUpdate.getNativeId(data);

  t.is(result, 'GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
});

test('Test adding OPeNDAP URL to UMM-G file', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin.json', 'utf8');
  const expected = fs.readFileSync('tests/data/umm-gout.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to UMM-G file with no related urls', async (t) => {
  const data = fs.readFileSync('tests/data/umm-gin-no-related-urls.json', 'utf8');
  const expected = fs.readFileSync('tests/data/umm-gout-no-related-urls.json', 'utf8');
  const expectedObject = JSON.parse(expected);
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  t.is(result, JSON.stringify(expectedObject, null, 2));
});

test('Test adding OPeNDAP URL to ECHO10 file', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in.xml', 'utf8');
  const expected = fs.readFileSync('tests/data/echo10out.xml', 'utf8');
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  
  t.is(result, expected);
});

test('Test adding OPeNDAP URL to ECHO10 file with no OnlineResources', async (t) => {
  const data = fs.readFileSync('tests/data/echo10in-no-online-resource-urls.xml', 'utf8');
  const expected = fs.readFileSync('tests/data/echo10out-no-online-resource-urls.xml', 'utf8');
  const result = await HyraxMetadataUpdate.addHyraxUrl(data, 'https://opendap.earthdata.nasa.gov/providers/GES_DISC/collections/GLDAS%20Catchment%20Land%20Surface%20Model%20L4%20daily%200.25%20x%200.25%20degree%20V2.0%20(GLDAS_CLSM025_D)%20at%20GES%20DISC/granules/GLDAS_CLSM025_D.2.0:GLDAS_CLSM025_D.A20141230.020.nc4');
  
  t.is(result, expected);
});