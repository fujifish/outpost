var util = require('util');
var fs = require('fs');
var path = require('path');
var childp = require('child_process');
var cluster = require('cluster');
var logrotate = require('logrotator');
var Logger = require('./logger');

const PERMISSION = 0744;

/**
 * Timer object instead of using setInterval
 * @param interval
 * @param cb
 * @constructor
 */
function Timer(interval, cb) {
  this.interval = interval;
  this.cb = cb;
}

Timer.prototype._run = function() {
  var self = this;
  this.timer = setTimeout(function() {
    self.cb.call(null);
    self._run();
  }, this.interval);
};

Timer.prototype.start = function() {
  if (this.timer) {
    return this;
  }
  this._run();
  return this;
};

Timer.prototype.stop = function() {
  if (!this.timer) {
    return;
  }
  clearTimeout(this.timer);
  delete this.timer;
  return this;
};

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
  this.logrotator = logrotate.create();

  this.checks = {
    maxUpTime: this._checkMaxUpTime,
    fileLastModified: this._checkFileLastModified
  };
}

/**
 * Start the monitor service
 * @param purge whether to purge any monitored processes upon start
 * @param cb
 */
Monitor.prototype.start = function(purge, cb) {
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
  this.logrotator.on('error', function(err) {
    _this.logger.error('error in logrotation: ' + err);
  });

  this.logrotator.on('rotate', function(file) {
    _this.logger.info('log file ' + file + ' was rotated');
  });

  this._load(function(err) {
    if (err) {
      _this.logger.error('error starting monitor service: ' + (err.message || err));
      cb && cb(err);
      return;
    }

    // if need to clear out monitored processes
    var procNames = Object.keys(_this.db);
    if (purge) {
      _this.logger.debug('purging monitored processes');
      function _unmonitor(names) {
        if (names.length === 0) {
          cb && cb();
          return;
        }
        var name = names.pop();
        _this.unmonitor(_this.db[name], function() {
          // ignore errors
          _unmonitor(names);
        });
      }
      _unmonitor(procNames);
      return;
    }

    // start monitoring for all the monitored processes
    procNames.forEach(function(name) {
      _this._startMonitor(_this.db[name], _this.db[name].timeout || 10, function() {});
    });
    cb && cb();
  });
};

/**
 * Stop the monitor service
 */
Monitor.prototype.stop = function(cb) {
  this.logger.debug('stopping monitor service');
  var _this = this;
  Object.keys(this.timers).forEach(function(name) {
    _this.timers[name].stop();
  });
  this.timers = {};
  this.logrotator.stop();
  this.db = {};
  cb && cb();
};

Monitor.prototype.restart = function(cb) {
  var _this = this;
  this.stop(function() {
    _this.start(cb);
  })
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
  proc.running = info.running || false;

  // requires name, cmd and modulepath
  if (!proc.name || !proc.modulepath) {
    return null;
  }

  proc.args = info.args || [];
  proc.env = info.env || {};
  proc.uid = info.uid || process.getuid();
  proc.gid = info.gid || process.getgid();
  proc.stopSignal = info.stopSignal || 'SIGTERM';
  proc.checks = info.checks || [];

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
    this.logger.debug('process ' + proc.name + ' already running with pid ' + proc.pid);
    this._registerMonitorTimer(proc, timeout, cb);
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
    _this._registerMonitorTimer(proc, timeout, cb);
  });

};

/**
 * start a timer to continuously check the status of the process
 * @param proc
 * @param timeout
 * @param cb
 * @private
 */
Monitor.prototype._registerMonitorTimer = function(proc, timeout, cb) {
  var _this = this;

  // after starting the process we have the pid.
  // start the timer to continuously check the status of the process
  this.timers[proc.name] = new Timer(2000, function() {
    // check that the process is running once every 2 seconds
    _this._startProcess(proc, timeout, function(err) {
      if (err) {
        _this.logger.error('error re-starting process ' + proc.name + ': ' + err);
        _this._stopMonitor(proc, 10, function(){});
      }
    });
  }).start();

  // register log rotation for every 5 minutes
  this.logrotator.register(proc.logFile, {schedule: '5m', size: '10m'});

  cb && cb();
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
    this.timers[proc.name].stop();
    delete this.timers[proc.name];
  }

  // clear log rotation
  this.logrotator.unregister(proc.logFile);

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
  if (proc.starting || proc.suppressed) {
    cb && cb();
    return;
  }

  var current = Date.now();
  var running = this._running(proc);
  var elapsed = proc.lastStartAttempt ? current - proc.lastStartAttempt : undefined;

  if (running) {

    // run all checks
    if (!this._runChecks(proc)) {
      cb && cb();
      return;
    }

    // reset the failure information if the process has been running ok for the last 30 seconds
    if (elapsed && elapsed > 30000) {
      delete proc.lastStartAttempt;
      delete proc.suppressTime;
      delete proc.suppressed;
      delete proc.starting;
    }
    cb && cb();
    return;
  }

  // suppress process launch if not enough time passed from the last failure
  if (elapsed && elapsed < 10000) {
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
  this.logger.debug('process ' + proc.name + ' is not running. starting process ' + proc.cmd + ' from ' + proc.cwd);
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

  var _this = this;

  function childError(err) {
    var message = 'error occurred in monitored process ' + proc.name + ': ' + err.message;
    _this.logger.error(message);
    cb && cb(message);
    cb = null;
  }

  // launch the child process and detach from it so it keeps running
  var child;
  try {
    child = childp.spawn(proc.cmd, proc.args, options);
    child.on('error', childError);
  } catch(err) {
    childError(err);
    return;
  } finally {
    fs.close(outFile);
    fs.close(errFile);
  }

  function _processStarted(pid) {
    _this.logger.debug('process ' + proc.name + ' started with pid ' + pid);
    proc.starting = false;
    proc.startedAt = Date.now();
    proc.pid = pid;
    child.unref();
    // save the new process state
    _this.db[proc.name] = proc;
    _this._save(proc, function(err) {
      if (err) {
        _this.logger.error('error saving process ' + proc.name + ' state: ' + (err.message || err));
      }

      // delay calling the callback to allow any immediate errors on the spawned process to propagate first
      setTimeout(function() {
        cb && cb(err);
        cb = null;
      }, 500);
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

  this.logger.debug('stopping process ' + proc.name + ' pid ' + proc.pid + ' with signal ' + proc.stopSignal);
  try {
    process.kill(proc.pid, proc.stopSignal);
  } catch(err) {
    // ignore
  }

  // wait for the process to stop running
  var _this = this;
  function _check() {
    // negative timeout means there is no timeout
    if (timeout >= 0 && --timeout === 0) {
      if (proc.forceKilled) {
        cb && cb('timeout waiting for process '  + proc.name + ' to be force killed');
        return;
      }
      _this.logger.warning('timeout waiting for process '  + proc.name + ' to stop. forcing stop with SIGKILL');
      try {
        proc.forceKilled = true;
        process.kill(proc.pid, 'SIGKILL');
      } catch(err) {
        //ignore
      }
      // wait an additional 5 seconds for forced process to be stopped
      timeout = 5;
      _check();
      return;
    }
    // if the process is still running, check again in 1 second
    if (_this._running(proc)) {
      setTimeout(function() {
        _check();
      }, 1000);
    } else {
      // yay, it's not running any more
      _this.logger.debug('process ' + proc.name + ' stopped' + (proc.forceKilled ? ' (force killed)' : ''));
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

  proc.lastRunningChecked = Date.now();
  try {
    // test for the existence of the process
    proc.running = process.kill(proc.pid, 0);
  } catch (err) {
    proc.running = false;
  }

  return proc.running;
};

/**
 * Check the process up time and restart it if it reached the maximum
 * return false if check is not successful, which causes a restart of the process
 * @param check
 * @param proc
 * @private
 */
Monitor.prototype._checkMaxUpTime = function(check, proc) {
  var upTime = (Date.now() - proc.startedAt) / (1000*60); // up time in minutes
  if (check.time > 0 && upTime > check.time) {
    this.logger.warning('check failed: reached maximum up time of ' + check.time + ' minutes for ' + proc.name);
    return false;
  }
  return true;
};

/**
 * Check if the last modification time of a file is within bounds. return false if check is not successful,
 * which causes a restart of the process
 * @param check:
 *  - file - the file name to check last modified time
 *  - interval - time in seconds to allow the file to remain unmodified. if time elapses, the process is restarted
 * @param proc
 * @private
 */
Monitor.prototype._checkFileLastModified = function(check, proc) {
  var current = Date.now();
  check.lastStat = check.lastStat || current;

  // do not stat the file too often
  if ((current - check.lastStat)/1000 <= check.time/3) {
    return true;
  }

  var file = path.resolve(proc.cwd, check.file);
  try {
    check.lastStat = current;
    var stat = fs.statSync(file);
  } catch (err) {
    this.logger.error('failed to stat file ' + file + ' during process ' + proc.name + ' check: ' + err.message);
    return err.code === 'ENOENT'; // it's ok if the file doesn't exist
  }

  var modifiedElapsed = (current - stat.mtime.getTime()) / 1000;
  if (modifiedElapsed > check.time) {
    this.logger.warning('check failed: file ' + file + ' was not modified for the last ' + modifiedElapsed + ' seconds');
    return false;
  }
  return true;
};

/**
 * Run all run checks and kill the process if any of them fail
 * @param proc
 * @private
 */
Monitor.prototype._runChecks = function(proc) {
  if (!proc || !proc.pid) {
    return false;
  }

  if (!proc.checks) {
    return true;
  }

  for (var i = 0; i < proc.checks.length; ++i) {
    var check = proc.checks[i];
    if (!check || !check.type || !this.checks[check.type]) {
      this.logger.warning('skipping check ' + i + ' of ' + proc.name + ': check type not found');
      continue;
    }

    var result = this.checks[check.type].call(this, check, proc);
    if (!result) {
      this.logger.debug('stopping process ' + proc.name + ' pid ' + proc.pid + ' due to check ' + check.type + ' failure');
      try {
        process.kill(proc.pid, proc.stopSignal);
      } catch(err) {
        this.logger.error('failed restarting process ' + proc.name + ' pid ' + proc.pid + ': ' + err.message);
      }
      return false;
    }
  }
  // all checks passed
  return true;
};

/**
 * Get a summary of all monitored processes
 */
Monitor.prototype.summary = function(cb) {
  var _this = this;
  // update the current running state
  Object.keys(this.db).forEach(function(name) {
    _this._running(_this.db[name]);
  });
  cb(this.db);
};


exports = module.exports = Monitor;



