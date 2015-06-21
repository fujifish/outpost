var util = require('util');
var fs = require('fs');
var path = require('path');
var childp = require('child_process');
var cluster = require('cluster');
var Logger = require('./logger');

const PERMISSION = 0744;

/**
 * The monitoring service
 * @param outpost
 * @constructor
 */
function Monitor(outpost) {
  this.config = outpost.config;
  this.logger = new Logger('outpost:monitor', outpost.logger);
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
  this.logger.debug('starting monitor service');
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
      _this._startMonitor(_this.db[name], _this.db[name].timeout || 10, function() {});
    });
    cb && cb();
  });
};

/**
 * Stop the monitor service
 */
Monitor.prototype.stop = function(cb) {
  var _this = this;
  Object.keys(this.timers).forEach(function(name) {
    clearInterval(_this.timers[name]);
  });
  _this.timers = {};
  cb && cb();
};

/**
 * Add a new process to be monitored
 */
Monitor.prototype.monitor = function(module, info, cb) {

  // it might already be monitored
  var proc = this.db[info.name] || this._normalizeProcess(info, module.modulepath);
  if (!proc) {
    this.logger.error('skipping monitor request for process with invalid info. info is: ' + JSON.stringify(info));
    cb && cb('invalid process info');
    return;
  }

  this._startMonitor(proc, info.timeout || 10, function(err) {
    cb && cb(err);
  });
};

/**
 * checks if a process is already being monitored
 */
Monitor.prototype.monitored = function(name, cb) {
  var proc = this.db[name];
  cb && cb(!!proc);
};

/**
 * Unmonitor a process
 */
Monitor.prototype.unmonitor = function(info, cb) {
  var proc;
  if (info.name) {
    proc = this.db[info.name];
  }

  if (!proc) {
    this.logger.debug('process '  + info.name + ' is not monitored');
    cb && cb();
    return;
  }

  var _this = this;
  // default wait time for process to stop is 10 seconds
  this._stopMonitor(proc, info.timeout || 10, function() {
    // remove from the db
    if (_this.db[proc.name]) {
      delete _this.db[proc.name];
      try {
        fs.unlinkSync(proc.metaFile);
      }  catch (err) {
        _this.logger.error('error trying to unmonitor ' + proc.name + ': ' + err.message);
        cb && cb(err);
        return;
      }

      try {
        fs.unlinkSync(proc.pidFile);
        var procDir = path.resolve(_this.procDir, proc.name);
        fs.rmdirSync(procDir);
      } catch (err) {
        // just ignore, not a problem
        _this.logger.warning('failed to delete pid file during unmonitor of ' + proc.name + ': ' + err.message);
      }
      cb && cb();
    }
  });


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
  proc.name = info.name;
  proc.cmd = info.cmd || process.execPath;
  proc.modulepath = info.modulepath || moduleFullpath;

  // requires name, cmd and modulepath
  if (!proc.name || !proc.modulepath) {
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
  var defaultPidFile = path.resolve(this.procDir, proc.name + '/pid');
  proc.pidFile = info.pidFile ? path.resolve(cwd, info.pidFile) : defaultPidFile;
  proc.customPidFile = (proc.pidFile !== defaultPidFile);
  proc.cwd = info.cwd ? path.resolve(cwd, info.cwd) : cwd;
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
      return;
    }
  }

  try {
    fs.writeFileSync(proc.metaFile, JSON.stringify(proc, null, 2));
    var pidFile = proc.pidFile;
    if (proc.pid) {
      fs.writeFileSync(pidFile, ''+proc.pid);
    } else {
      fs.unlinkSync(pidFile);
    }
  } catch(err) {
    this.logger.error('error saving monitored process ' + proc.name + ' metadata: ' + err.message);
    cb && cb(err);
    return;
  }

  cb && cb();
};

/**
 * Start monitoring a process
 * @param proc
 * @param timeout
 * @param cb
 * @private
 */
Monitor.prototype._startMonitor = function(proc, timeout, cb) {

  this.logger.debug('starting monitor of ' + proc.name);

  // check if it's already running
  if (this._running(proc)) {
    this.logger.debug('process ' + proc.name + ' already running');
    cb && cb();
    return;
  }

  // start the process
  var _this = this;
  this._startProcess(proc, timeout, function(err) {
    if (err) {
      _this.logger.error('error starting process ' + proc.name + ': ' + err);
      cb && cb(err);
      return;
    }

    // after starting the process we have the pid.
    // start the timer to continuously check the status of the process
    _this.timers[proc.name] = setInterval(function() {
      // check that the process is running once every second
      _this._startProcess(proc, timeout, function(err) {
        if (err) {
          _this.logger.error('error re-starting process ' + proc.name + ': ' + err);
          _this._stopMonitor(proc, 10, function(){});
        }
      });
    }, 1000);

    cb && cb();
  });

};

/**
 * Stop monitoring a process
 * @param proc
 * @param timeout
 * @param cb
 * @private
 */
Monitor.prototype._stopMonitor = function(proc, timeout, cb) {
  if (!proc.name) {
    cb && cb();
    return;
  }

  this.logger.debug('stopping monitor of ' + proc.name);

  // clear the check timer
  if (this.timers[proc.name]) {
    clearInterval(this.timers[proc.name]);
    delete this.timers[proc.name];
  }

  // kill the process
  var _this = this;
  this._stopProcess(proc, timeout, function(err) {
    if (err) {
      _this.logger.error('process ' + proc.name + ' could not be stopped');
    }
    cb && cb(err);
  });
};

/**
 * Start a process
 * @param proc
 * @param timeout
 * @param cb
 * @private
 */
Monitor.prototype._startProcess = function(proc, timeout, cb) {
  var current = Date.now();
  var running = this._running(proc);
  var elapsed = current - proc.lastStartAttempt;

  if (running || proc.starting || proc.suppressed) {
    // reset the failure information if the process has been running ok for the last 30 seconds
    if (running && elapsed > 30000) {
      delete proc.lastStartAttempt;
      delete proc.suppressTime;
      delete proc.suppressed;
      delete proc.starting;
    }

    cb && cb();
    return;
  }

  // suppress process launch if not enough time passed from the last failure
  if (elapsed < 10000) {
    proc.suppressTime = proc.suppressTime || 5000;
    this.logger.debug('process ' + proc.name + ' failed too fast. delaying restart for ' + proc.suppressTime/1000 + ' seconds');
    proc.suppressed = true;
    setTimeout(function() {
      delete proc.suppressed;
    }, proc.suppressTime);
    proc.suppressTime = Math.min(proc.suppressTime * 2, 30000);
    cb && cb();
    return;
  }

  proc.starting = true;
  proc.lastStartAttempt = current;

  // have the process start with logging to a file
  this.logger.debug('process ' + proc.name + ' is not running. starting process');
  var outFile = fs.openSync(proc.logFile, 'a');
  var errFile = fs.openSync(proc.logFile, 'a');

  fs.writeSync(outFile, '\n---------- ' + new Date().toISOString() + ' outpost spawning process ----------\n\n');

  var options = {
    cwd: proc.cwd,
    env: util._extend(util._extend({}, process.env), proc.env),
    stdio: ['ignore', outFile, errFile],
    detached: true,
    uid: proc.uid,
    gid: proc.gid
  };

  // if we have a custom pid file, delete it's content before trying to start the process
  if (proc.customPidFile) {
    try {
      fs.truncateSync(proc.customPidFile, 0);
    } catch (err) {
      // ignore
    }
  }

  // launch the child process and detach from it so it keeps running
  var child;
  try {
    child = childp.spawn(proc.cmd, proc.args, options);
  } catch(err) {
    this.logger.error('error spawning monitored process ' + proc.name + ': ' + err.message);
    cb && cb(err);
    return;
  } finally {
    fs.close(outFile);
    fs.close(errFile);
  }

  var _this = this;
  function _processStarted(pid) {
    _this.logger.debug('process ' + proc.name + ' started with pid ' + pid);
    proc.starting = false;
    proc.pid = pid;
    child.unref();
    // save the new process state
    _this.db[proc.name] = proc;
    _this._save(proc, function(err) {
      if (err) {
        _this.logger.error('error saving process ' + proc.name + ' state: ' + (err.message || err));
      }
      cb && cb(err);
    });
  }

  // if we are using our own default pid file, use the spawned child process id
  if (!proc.customPidFile) {
    _processStarted(child.pid);
  } else {
    // otherwise, wait for the custom pid file to contain the pid

    function _delayCheck() {
      setTimeout(_check, 500);
    }

    function _check() {
      if (timeout > 0 && --timeout === 0) {
        cb && cb('timeout waiting for process to start');
        return;
      }
      try {
        var data = fs.readFileSync(proc.pidFile);
        if (data) {
          data = data.toString().trim();
          var pid = data.match(/^\d+$/) && parseInt(data);
          if (pid && pid > 0) {
            _processStarted(pid);
          } else {
            _delayCheck();
          }
        } else {
          _delayCheck();
        }
      } catch (err) {
        // it's ok if the file doesn't exist yet
        if (err.code !== 'ENOENT') {
          _this.logger.error('error trying to read pid of ' + proc.name + ' from ' + proc.pidFile + ': ' + err.message);
        } else {
          _delayCheck();
        }
      }
    }

    _delayCheck();
  }

};

/**
 * Stop a running process
 * @param proc
 * @param timeout seconds to wait for the process to stop
 * @param cb
 * @private
 */
Monitor.prototype._stopProcess = function(proc, timeout, cb) {
  if (!proc.pid) {
    this.logger.debug('process ' + proc.name + ' is already stopped');
    cb && cb();
    return;
  }

  this.logger.debug('stopping process ' + proc.name + ' with pid ' + proc.pid);
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch(err) {
    // ignore
  }

  // wait for the process to stop running
  var _this = this;
  function _check() {
    // negative timeout means there is no timeout
    if (timeout >= 0 && --timeout === 0) {
      cb && cb('timeout waiting for process '  + proc.name + ' to stop');
      return;
    }
    // if the process is still running, check again in 1 second
    if (_this._running(proc)) {
      setTimeout(function() {
        _check();
      }, 1000);
    } else {
      // yay, it's not running any more
      _this.logger.debug('process ' + proc.name + ' stopped');
      proc.pid = null;
      cb && cb();
    }
  }
  _check();

};

/**
 * Check if the process is running
 * @param proc
 * @returns {boolean}
 * @private
 */
Monitor.prototype._running = function(proc) {
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



