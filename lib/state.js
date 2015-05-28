var fs = require('fs');
var path = require('path');
var Logger = require('./logger');

/**
 * Installation state manager
 * @param outpost
 * @constructor
 */
function State(outpost) {
  this.config = outpost.config;
  this.logger = new Logger('outpost:state', outpost.logger);
}

/**
 * Create the state directory in the given parent directory
 * @param dir parent directory to create the state dir in
 * @param cb
 * @private
 */
State.prototype._mkStateDir = function(dir, cb) {
  var stateDir = path.resolve(dir, '.outpost/state');
  fs.mkdir(stateDir, 0700, function(err) {
    // it's ok if the directory already exists
    if (err && err.code === 'EEXIST') {
      err = null;
    }
    cb(err, stateDir);
  });
};

/**
 * Save data to a state file in the given directory
 * @param dir the directory to create the state file in
 * @param name the name of the state file to save the data in
 * @param data the data to save
 * @param cb
 */
State.prototype.save = function(dir, name, data, cb) {
  this._mkStateDir(dir, function(err, stateDir) {
    if (err) {
      err.message = 'error creating state directory ' + stateDir + ': ' + err.message;
      cb(err);
      return;
    }

    var stateFile = path.resolve(stateDir, name + '.json');
    fs.writeFile(stateFile, JSON.stringify(data || {}), function(err) {
      cb(err);
    });
  });
};

/**
 *
 * @param state
 * @returns {Array}
 */
State.prototype.translate = function(state) {
  this.logger.debug('translating state');

  if (!state) {
    return [];
  }

  var commands = [];


};

State.prototype._current = function() {

};

exports = module.exports = State;
