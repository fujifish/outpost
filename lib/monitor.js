var util = require('util');
var fs = require('fs');
var path = require('path');
var childp = require('child_process');
var cluster = require('cluster');
var Logger = require('./logger');

const PERMISSION = 0744;

/**
 * The monitoring service
 * @param config
 * @constructor
 */
function Monitor(config) {
  this.config = config;
  this.logger = new Logger('outpost:monitor');
  this.db = {};
  this.procDir = path.resolve(this.config.monitorDir + '/proc');
  this.logsDir = path.resolve(this.config.monitorDir + '/logs');
  this.timers = {};
}

/**
 * Start the monitor service
 * @param cb
 */
Monitor.prototype.start = function(cb) {
  this.logger.info('starting monitor service');
  try {
    fs.mkdirSync(this.config.monitorDir, PERMISSION);
  } catch(err) {
    if (err && err.code != 'EEXIST') {
      this.logger.error('error creating monitor directory: ' + err.message);
      cb && cb(err);
      return;
    }
  }

  try {
    fs.mkdirSync(this.procDir, PERMISSION);
  } catch(err) {
    if (err && err.code != 'EEXIST') {
      this.logger.error('error creating monitor proc directory: ' + err.message);
      cb && cb(err);
      return;
    }
  }

  try {
    fs.mkdirSync(this.logsDir, PERMISSION);
  } catch(err) {
    if (err && err.code != 'EEXIST') {
      this.logger.error('error creating monitor logs directory: ' + err.message);
      cb && cb(err);
      return;
    }
  }

  var _this = this;
  this._load(function(err) {
    if (err) {
      _this.logger.error('error starting monitor service: ' + (err.message || err));
      cb && cb(err);
      return;
    }

    // setup monitoring for all the monitored processes
    Object.keys(_this.db).forEach(function(name) {
      _this._startMonitor(_this.db[name]);
    });
    cb && cb();
  });
};

/**
 * Add a new process to be monitored
 */
Monitor.prototype.monitor = function(module, info) {

  // it might already be monitored
  var proc = this.db[info.name] || this._normalizeProcess(info, module.modulepath);
  if (!proc) {
    this.logger.warning('skipping monitor request for process with invalid info. info is: ' + JSON.stringify(info));
  }

  this._startMonitor(proc);
};

/**
 * Unmonitor a process
 * info must contain pid or name
 */
Monitor.prototype.unmonitor = function(info) {
  var proc;
  if (info.name) {
    proc = this.db[info.name];
  } else {
    proc = this._findByPid(info.pid);
  }

  if (!proc) {
    return;
  }

  this._stopMonitor(proc);

  // remove from the db
  if (this.db[proc.name]) {
    delete this.db[proc.name];
    try {
      fs.unlinkSync(proc.metaFile);
    }  catch (err) {
      this.logger.err('error trying to unmonitor ' + proc.name + ': ' + err.message);
      return;
    }

    try {
      fs.unlinkSync(proc.pidFile);
      var procDir = path.resolve(this.procDir, proc.name);
      fs.rmdirSync(procDir);
    } catch (err) {
      // just ignore, not such a big problem
    }
  }
};

/**
 * Find a process in the db by it's name
 * @param pid
 * @private
 */
Monitor.prototype._findByPid = function(pid) {
  var _this = this;
  Object.keys(this.db).forEach(function(name) {
    if (_this.db[name].pid === pid) {
      return _this.db[name];
    }
  });

  return null;
};

/**
 * Create a monitored process object
 * @param info process info
 * @param moduleFullpath the module fullpath
 */
Monitor.prototype._normalizeProcess = function(info, moduleFullpath) {
  var proc = {};
  proc.cmd = info.cmd;
  proc.name = info.name;
  proc.modulepath = info.modulepath || moduleFullpath;

  // requires name, cmd and modulepath
  if (!proc.name || !proc.cmd || !proc.modulepath) {
    return null;
  }

  proc.args = info.args || [];
  proc.env = info.env || {};
  proc.uid = info.uid || process.getuid();
  proc.gid = info.gid || process.getgid();

  proc.logFile = info.log || this.logsDir + '/' + proc.name + '.log';
  proc.metaFile = path.resolve(this.procDir, proc.name + '/meta');

  // the default cwd is the module dir
  var cwd = this.config.modulesDir + '/' + proc.modulepath;
  proc.pidFile = info.pidFile ? path.resolve(cwd, info.pidFile) : path.resolve(this.procDir, proc.name + '/pid');
  proc.cwd = info.cwd || cwd;
  return proc;
};

/**
 * Load and start monitoring existing processes
 * @param cb
 * @private
 */
Monitor.prototype._load = function(cb) {
  var _this = this;
  // read the contents of the directory
  fs.readdir(this.procDir, function(err, procs) {
    if (err) {
      _this.logger.error('error reading proc directory contents: ' + (err.message || err));
      cb && cb(err);
      return;
    }

    var count = procs.length;
    if (count === 0) {
      cb && cb();
      return;
    }


    function _done(name, err) {
      if (err) {
        _this.logger.error('process ' + name + ' will not be monitored: ' + err);
      }
      if (--count === 0) {
        cb && cb();
      }
    }

    // iterate through all the monitored procs.
    // every monitored proc is a directory that contains a metadata file and a pid file
    procs.forEach(function(proc) {
      var dir = path.resolve(_this.procDir, proc);
      fs.stat(dir, function(err, stat) {
        if (err) {
          _done(proc, 'error reading ' + dir + ' stat: ' + (err.message || err));
          return;
        }

        // only handle directories
        if (stat.isDirectory()) {
          // we have a directory, load the metadata and the pid
          var metaFile = path.resolve(dir, 'meta');
          fs.exists(metaFile, function(exists) {
            // ignore if there is no meta file
            if (!exists) {
              _done(proc, 'metadata does not exist');
              return;
            }

            // read the metadata contents
            fs.readFile(metaFile, function(err, data) {
              if (err) {
                _done(proc, 'error loading metadata: ' + err.message);
                return;
              }

              // add the monitored process to the db
              var info;
              try {
                info = JSON.parse(data);
              } catch(err) {
                _done(proc, 'error parsing metadata: ' + err.message);
                return;
              }

              // normalize the metadata
              var normalized = _this._normalizeProcess(info, null);
              if (!normalized) {
                _done(proc, 'invalid metadata');
                return;
              }

              // store it in the db
              _this.db[proc] = normalized;

              // now read the pid file, if there is one
              fs.exists(info.pidFile, function(exists) {
                // done with this monitored process if there is no pid
                if (!exists) {
                  _done(proc, null);
                  return;
                }

                // we have a pid file, read it
                fs.readFile(info.pidFile, function(err, data) {
                  if (err) {
                    _done(proc, 'error reading pid file: ' + err.message);
                    return;
                  }
                  // make sure the pid file actually contains a process id.
                  // if not then just ignore
                  if (data.toString().match(/^\d+$/)) {
                    _this.db[proc].pid = parseInt(data);
                  }
                  _done(proc, null);
                });
              });
            });
          });
        } else {
          _done(proc, null);
        }
      });
    });
  });
};

/**
 * Synchronously save the monitored state of a process
 * @param proc the monitored process to save
 * @param cb
 * @private
 */
Monitor.prototype._save = function(proc, cb) {
  try {
    var procDir = path.resolve(this.procDir, proc.name);
    fs.mkdirSync(procDir, PERMISSION);
  } catch(err) {
    if (err.code !== 'EEXIST') {
      this.logger.error('error creating monitored process ' + proc.name + ' dir: ' + err.message);
      cb && cb(err);
    }
  }

  try {
    fs.writeFileSync(proc.metaFile, JSON.stringify(proc));
    var pidFile = proc.pidFile;
    if (proc.pid) {
      fs.writeFileSync(pidFile, ''+proc.pid);
    } else {
      fs.unlinkSync(pidFile);
    }
    cb && cb();
  } catch(err) {
    this.logger.error('error saving monitored process ' + proc.name + ' metadata: ' + err.message);
    cb && cb(err);
  }
};

/**
 * Start monitoring a process
 * @param proc
 * @private
 */
Monitor.prototype._startMonitor = function(proc) {

  this.logger.debug('starting monitor of ' + proc.name);

  // after starting the process it has a pid
  this._startProcess(proc);

  if (proc.pid) {

    // start the timer to continuously check the status of the process
    var _this = this;
    this.timers[proc.name] = setInterval(function() {
      // check if the process is running once every second
      _this._startProcess(proc);
    }, 1000);
  }

};

/**
 * Stop monitoring a process
 * @param proc
 * @private
 */
Monitor.prototype._stopMonitor = function(proc) {
  if (!proc.name) {
    return;
  }

  this.logger.debug('stopping monitor of ' + proc.name);

  // clear the check timer
  if (this.timers[proc.name]) {
    clearInterval(this.timers[proc.name]);
    delete this.timers[proc.name];
  }

  // kill the process
  this._stopProcess(proc);
};

/**
 * Start a process
 * @param proc
 * @private
 */
Monitor.prototype._startProcess = function(proc) {
  if (this._checkProcess(proc)) {
    return;
  }

  // have the process start with logging to a file
  this.logger.info('process ' + proc.name + ' is not running. starting process');
  var outFile = fs.openSync(proc.logFile, 'a');
  var errFile = fs.openSync(proc.logFile, 'a');

  var options = {
    cwd: proc.cwd,
    env: util._extend(util._extend({}, process.env), proc.env),
    stdio: ['ignore', outFile, errFile],
    detached: true,
    uid: proc.uid,
    gid: proc.gid
  };

  // launch the child process and detach from it so it keeps running even if we don't
  try {
    var child = childp.spawn(proc.cmd, proc.args, options);
    proc.pid = child.pid;
    child.unref();
    this.logger.info('process ' + proc.name + ' started with pid ' + proc.pid);
  } catch(err) {
    this.logger.error('error starting process ' + proc.name + ': ' + err.message);
  }

  // save the new process state
  this.db[proc.name] = proc;
  var _this = this;
  this._save(proc, function(err) {
    if (err) {
      _this.logger.error('error while starting to monitor process ' + proc.name + ': ' + (err.message || err));
    }
  });
};

/**
 * Stop a running process
 * @param proc
 * @private
 */
Monitor.prototype._stopProcess = function(proc) {
  if (!proc.pid) {
    return;
  }

  this.logger.info('stopping process ' + proc.name);
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch(err) {
    // ignore
  }

  // reset the pid
  proc.pid = null;
};

/**
 * Check if the process is running
 * @param proc
 * @returns {boolean}
 * @private
 */
Monitor.prototype._checkProcess = function(proc) {
  if (!proc || !proc.pid) {
    return false;
  }

  try {
    // test for the existence of the process
    process.kill(proc.pid, 0);
    return true;
  }
  catch (err) {
    return false;
  }

};


exports = module.exports = Monitor;



