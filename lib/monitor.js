var util = require('util');
var fs = require('fs');
var path = require('path');
var childp = require('child_process');
var cluster = require('cluster');
var Logger = require('./logger');

/**
 * The monitoring service
 * @param config
 * @constructor
 */
function Monitor(config) {
  this.config = config;
  this.logger = new Logger('outpost:monitor');
  this.db = {};
  this.dbFile = path.resolve(this.config.monitorDir + '/.db');
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
    fs.mkdirSync(path.resolve(this.config.monitorDir), 0744);
  } catch(err) {
    if (err && err.code != 'EEXIST') {
      this.logger.error('error creating monitor directory: ' + err.message);
      cb && cb(err);
      return;
    }
  }

  try {
    fs.mkdirSync(this.logsDir, 0744);
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
  if (!info.name) {
    this.logger.warning('skipping monitor request for process with no name or no cmd. request is: ' + JSON.stringify(info));
    return;
  }

  // check if it is already being monitored
  var proc = this.db[info.name];
  if (!proc) {
    proc = this._normalizeProcess(module, info);
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
    var _this = this;
    this._save(function(err) {
      if (err) {
        _this.logger.error('error while stopping to monitor process ' + proc.pid + ' (' + proc.name + '): ' + (err.message || err));
      }
    });
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
 * @param module the full module name
 * @param info process info
 * @constructor
 */
Monitor.prototype._normalizeProcess = function(module, info) {
  var proc = {};
  proc.cmd = info.cmd;
  proc.name = info.name;
  proc.args = info.args || [];
  proc.env = info.env || {};
  proc.uid = info.uid || process.getuid();
  proc.gid = info.gid || process.getgid();

  proc.log = info.log || this.logsDir + '/' + proc.name + '.log';

  // the default cwd is the module dir
  var cwd = this.config.modulesDir + '/' + module.modulepath;
  proc.cwd = info.cwd || cwd;
  return proc;
};

/**
 * Load and start monitoring existing processes
 * @param cb
 * @private
 */
Monitor.prototype._load = function(cb) {
  // load the monitor database
  var _this = this;
  fs.exists(this.dbFile, function(exists) {
    if (!exists) {
      _this.logger.info('creating new monitor db');
      _this._save(cb);
      return;
    }
    // read the contents
    fs.readFile(_this.dbFile, function(err, data) {
      if (err) {
        _this.logger.error('error loading monitor db: ' + err.message);
        cb && cb(err);
        return;
      }
      try {
        _this.db = JSON.parse(data);
        cb && cb();
      } catch(err) {
        _this.logger.warning('error parsing monitor db: ' + err.message);
        cb && cb();
      }
    });
  });
};

/**
 * Save the monitor database
 * @param cb
 * @private
 */
Monitor.prototype._save = function(cb) {
  try {
    fs.writeFileSync(this.dbFile, JSON.stringify(this.db));
    cb && cb();
  } catch(err) {
    this.logger.error('error saving monitor db: ' + err.message);
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

  // remove the process from the db
  if (this.db[proc.name]) {
    delete this.db[proc.name];
    var _this = this;
    this._save(function(err) {
      if (err) {
        _this.logger.error('error while stopping to monitor ' + proc.name + ': ' + (err.message || err));
      }
    });
  }

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
    // process is already running
    return;
  }

  // have the process start with logging to a file
  this.logger.info(proc.name + ' is not running - starting process');
  var outFile = fs.openSync(proc.log, 'a');
  var errFile = fs.openSync(proc.log, 'a');

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

  // save the new process pid in the db
  this.db[proc.name] = proc;
  var _this = this;
  this._save(function(err) {
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



