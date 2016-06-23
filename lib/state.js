var os = require('os');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var utilities = require('./utilities');
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
  this.tags = this._readTags(this.config);
}

State.prototype._readTags = function(config) {
  var tags = {};
  // if tags is a name of a file
  if (config.tags && typeof config.tags === 'string') {
    try {
      var tagsFile = utilities.findFile(config.tags);
      tags = null;
      if (tagsFile) {
        tags = JSON.parse(fs.readFileSync(tagsFile, {encoding: 'utf8'}));
      }
    } catch(e) {
      this.logger.error('error reading tags file ' + tags + ': ' + e.message);
    }
  }
  return tags;
};

/**
 * Create the state file in the given directory
 * @param dir parent directory to create the state file in
 * @param cb
 * @private
 */
State.prototype._stateFile = function(dir, cb) {
  var stateDir = path.resolve(dir, '.outpost');
  var stateFile = path.join(stateDir, 'state.json');
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

      data = data || '{}';
      if (typeof data !== 'string') {
        data = data.toString();
      }

      try {
        data = JSON.parse(data);
      } catch (err) {
        cb('failed to parse state file ' + stateFile + ': ' + err.message);
        return;
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
      cb(err);
      return;
    }

    state[name] = {
      time: new Date().toISOString(),
      data: data
    };

    fs.writeFile(stateFile, JSON.stringify(state, null, 2), function(err) {
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
 * Get agent and platform information
 */
State.prototype.info = function() {
  return {
    agentVersion: require('../package.json').version,
    arch: process.arch,
    platform: process.platform,
    cpus: os.cpus().length,
    memUsage: process.memoryUsage(),
    pid: process.pid,
    nodeVersion: process.version,
    hostname: os.hostname(),
    release: os.release(),
    loadavg: os.loadavg(),
    uptime: os.uptime(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    runas: process.getuid(),
    runasName: this.config.runasName,
    ip: this.config.ip,
    tags: this.tags
  };
};

/**
 * Get the current state of all installed modules
 */
State.prototype.current = function(cb) {
  var _this = this;
  this.installed(function(err, modules) {
    if (err) {
      cb(err);
      return;
    }

    var modulesArray = Object.keys(modules).map(function(name) {return modules[name];});

    var agentState = {
      info: _this.info(),
      modules: modulesArray
    };

    cb(null, agentState);
  });
};

/**
 * Get the current installed modules
 * @param cb
 * @private
 */
State.prototype.installed = function(cb) {
  var modules = {};
  var _this = this;
  var modulesDir = this.config.modulesDir;
  // read all files in modules dir
  fs.readdir(modulesDir, function(err, moduleDirs) {
    if (err) {
      if(err.code == "ENOENT"){
        cb(null, modules);
        return;
      }
      err.message = 'error reading modules directory ' + modulesDir + ': ' + err.message;
      cb(err);
      return;
    }

    var count = moduleDirs.length;
    if (count === 0) {
      cb(null, modules);
      return;
    }

    function processedDir() {
      if (--count === 0) {
        process.nextTick(function() {
          cb(null, modules);
        });
      }
    }

    // iterate over all the possible module dirs
    moduleDirs.forEach(function(dir) {
      // a module dir has the form <module>-<version>
      var parts = dir.match(/^(.+)-(\d+\.\d+\.\d+(-.*)?)$/);
      if (parts) {
        // this might be a module.
        // check if the .outpost dir is present
        var moduleDir = path.resolve(modulesDir, dir);
        fs.readdir(path.resolve(moduleDir, '.outpost'), function(err) {
          // if the .outpost directory exists
          if (err) {
            if (err.code === 'ENOENT') {
              processedDir();
              return;
            }
            cb('error reading directory ' + moduleDir + '/.outpost: ' + err.message);
            return;
          }

          var fullname = parts[1] + '@' + parts[2];
          var module = {
            name: parts[1],
            version: parts[2],
            fullname: fullname,
            dir: moduleDir
          };

          // load the module state
          _this.load(moduleDir, null, function(err, state) {
            if (err) {
              cb(err);
              return;
            }

            module.state = state;
            modules[fullname] = module;
            processedDir();
          });
        });
      }
    });
  });
};

State.prototype._hash = function(obj) {
  var shasum = crypto.createHash('sha1');
  shasum.update(JSON.stringify(obj));
  return shasum.digest('hex');
};

/**
 * Calculate the commands that need to run to force reconfiguration of all installed modules
 */
State.prototype.reconfigure = function(cb) {
  var commands = [];
  this.installed(function(err, modules) {
    if (err) {
      cb && cb(err);
      return;
    }
    Object.keys(modules).forEach(function(name) {
      var module = modules[name];
      var state = module.state;
      commands.push({type: 'stop', module: module.fullname});
      commands.push({
        type: 'configure',
        module: module.fullname,
        config: state && state.configure && state.configure.data
      });
      if (state && state.start && state.start.data && state.start.data.started) {
        commands.push({type: 'start', module: module.fullname});
      }
    });
    cb && cb(null, commands);
  });
};

/**
 * Calculate the commands that need to run to satisfy the provided state
 */
State.prototype.calculate = function(states, cb) {
  this.logger.debug('calculating state');

  var commands = {
    uninstall: [],
    install: [],
    configure: [],
    stop: [],
    start: []
  };

  // every state element contains:
  //  1. full module name
  //  2. installation state
  //  2. the configuration of the module
  //  3. whether the module should be started or not

  // the algorithm is:
  //  1. ignore modules who need to be installed/not installed and currently are so.
  //  2. for every module that does not need to be installed but currently is, add an 'uninstall' command
  //  3. for every module that needs to be installed but isn't, add an 'install' command
  //  4. for every module that needs to be installed, add a 'configure' command
  //  5. for every module that needs to be installed and is required to be started, add a 'start' command

  var _this = this;
  this.installed(function(err, installed) {
    if (err) {
      cb(err);
      return;
    }

    // iterate through all state elements
    states.forEach(function(module) {
      var fullname = module.fullname || module.name + '@' + module.version;

      var installedModule = installed[fullname];
      // remove the module from the installed list so we can check at the end if there are
      // any that need to be uninstalled
      delete installed[fullname];

      // if the module is not installed, add command to install it
      if (!installedModule) {
        commands.install.push({type: 'install', module: fullname});
      }

      var state = module.state || module;
      var installedState = (installedModule && installedModule.state) || {};
      var installedStart = installedState.start || {};
      var started = (installedStart.data || {}).started;

      // check if need to apply configuration
      var configure = state.configure;
      if (configure) {
        //var doConfigure = false;
        var installedConfigure = installedState.configure || {};

        var configureData = configure.data || configure;
        // compare times if given
        //if (configure.time && installedConfigure.time) {
        //  doConfigure = Date.parse(configure.time) > Date.parse(installedConfigure.time);
        //} else {
          // no time given, compare the objects themselves
          var configHash = _this._hash(JSON.stringify(configureData));

          // the current state hash
          var installedConfig = installedConfigure.data || {};
          var installedConfigHash = _this._hash(JSON.stringify(installedConfig));
          var doConfigure = configHash !== installedConfigHash;
        //}

        if (doConfigure) {
          started && commands.stop.push({type: 'stop', module: fullname});
          commands.configure.push({type: 'configure', module: fullname, config: configureData});
          started = false;
        }
      }

      // check if need to start or stop the module
      var start = state.start;
      if (start !== undefined) {
        var startVal = start.data ? start.data.started : start;
        if (startVal === true && started !== true) {
          // if the module needs to be started and it currently is not
          commands.start.push({type: 'start', module: fullname});
        } else if (startVal === false && started === true) {
          // if the module needs to stop and is currently started
          commands.stop.push({type: 'stop', module: fullname});
        }
      }
    });

    // go over all remaining modules in the installed list and uninstall them
    Object.keys(installed).forEach(function(fullname) {
      commands.uninstall.push({type: 'uninstall', module: fullname});
    });

    var all = [];
    all = all.concat(commands.install);
    all = all.concat(commands.uninstall);
    all = all.concat(commands.stop);
    all = all.concat(commands.configure);
    all = all.concat(commands.start);
    cb(null, all);
  });

};

exports = module.exports = State;
