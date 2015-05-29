var fs = require('fs');
var path = require('path');
var Logger = require('./logger');

/**
 * Installation state manager
 * @param outpost
 * @constructor
 */
function State(outpost) {
  this.cache = outpost.cache;
  this.config = outpost.config;
  this.logger = new Logger('outpost:state', outpost.logger);
}

/**
 * Create the state file in the given directory
 * @param dir parent directory to create the state file in
 * @param cb
 * @private
 */
State.prototype._stateFile = function(dir, cb) {
  var stateDir = path.resolve(dir, '.outpost');
  var stateFile = path.join(stateDir, 'state.json');
  var _this = this;
  fs.mkdir(stateDir, 0700, function(err) {
    // it's ok if the directory already exists
    if (err) {
      if (err.code !== 'EEXIST') {
        cb(err, stateFile);
        return;
      }
    }

    fs.readFile(stateFile, function(err, data) {
      if (err) {
        if (err.code !== 'ENOENT') {
          cb(err, stateFile);
          return;
        }
      }

      data = data || '';

      if (typeof data !== 'string') {
        data = data.toString();
      }

      if (data.trim().length === 0) {
        data = {};
      } else {
        data = JSON.parse(data);
      }

      cb(null, stateFile, data);
    });
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
  this._stateFile(dir, function(err, stateFile, state) {
    if (err) {
      err.message = 'error reading state file ' + stateFile + ': ' + err.message;
      cb(err);
      return;
    }

    state[name] = data;
    fs.writeFile(stateFile, JSON.stringify(state), function(err) {
      cb(err);
    });
  });
};

/**
 * Load data from a state file in the given directory
 * @param dir the directory to create the state file in
 * @param name the name of the state to load. if null, the entire state is returned
 * @param cb
 */
State.prototype.load = function(dir, name, cb) {
  this._stateFile(dir, function(err, stateFile, state) {
    if (err) {
      err.message = 'error reading state file ' + stateFile + ': ' + err.message;
      cb(err);
      return;
    }

    if (name) {
      state = state[name];
    }

    cb(err, state);
  });
};

/**
 * Remove a state from the state file in the given directory
 * @param dir
 * @param name
 * @param cb
 */
State.prototype.remove = function(dir, name, cb) {
  this._stateFile(dir, function(err, stateFile, state) {
    if (err) {
      err.message = 'error reading state file ' + stateFile + ': ' + err.message;
      cb(err);
      return;
    }
    delete state[name];
    fs.writeFile(stateFile, JSON.stringify(state), function(err) {
      cb(err);
    });
  });
};

/**
 * Get the current state of all installed modules
 */
State.prototype.current = function(cb) {
  var _this = this;
  this._installedModules(function(err, modules) {
    if (err) {
      cb(err);
      return;
    }

    var count = modules.length;
    if (count === 0) {
      cb(null, modules);
      return;
    }

    // load the entire module state for each module
    modules.forEach(function(module) {
      _this.load(module.dir, null, function(err, state) {
        if (err) {
          cb(err);
          return;
        }
        module.state = state;

        if (--count === 0) {
          process.nextTick(function() {
            cb(null, modules);
          });
        }
      });
    });
  });
};

/**
 * Get the current installed modules
 * @param cb
 * @private
 */
State.prototype._installedModules = function(cb) {
  var modules = [];

  var modulesDir = this.config.modulesDir;
  // read all files in modules dir
  fs.readdir(modulesDir, function(err, modules) {
    if (err) {
      err.message = 'error reading modules directory ' + modulesDir + ': ' + err.message;
      cb(err);
      return;
    }

    var count = modules.length;
    modules.forEach(function(dir) {
      // a module dir has the form <module>-<version>
      var parts = dir.match(/^(.+)-(\d+\.\d+\.\d+(-.*)?)$/);
      if (parts) {
        // this might be a module.
        // check if the .outpost dir is present
        var moduleDir = path.resolve(modulesDir, dir);
        fs.readdir(path.resolve(moduleDir, '.outpost'), function(err) {
          // if the directory exists
          if (!err) {
            var module = {
              name: parts[1],
              version: parts[2],
              dir: moduleDir
            };
            modules.push(module);
          }

          if (--count === 0) {
            process.nextTick(function() {
              cb(null, modules);
            });
          }
        });
      }
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

exports = module.exports = State;
