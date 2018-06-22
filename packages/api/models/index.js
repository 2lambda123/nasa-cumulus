'use strict';

const Manager = require('./base');
const Collection = require('./collections');
const Granule = require('./granules');
const Pdr = require('./pdrs');
const Provider = require('./providers');
const Rule = require('./rules');
const Execution = require('./executions');
const FileClass = require('./files');

class User extends Manager {
  constructor() {
    super(process.env.UsersTable);
  }
}

module.exports = {
  User,
  Collection,
  Granule,
  Pdr,
  Provider,
  Rule,
  Manager,
  Execution,
  FileClass
};
