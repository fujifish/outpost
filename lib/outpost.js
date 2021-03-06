require('syswide-cas');

var fs = require('fs');
var os = require('os');
var fse = require('fs-extra');
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var url = require('url');
var http = require('http');
var https = require('https');
var events = require('events');
var chalk = require('chalk');
var proxying = require('proxying-agent');
var utilities = require('./utilities');
var Logger = require('./logger');
var Cache = require('./cache');
var State = require('./state');
var Fortitude = require('./fortitude');
var Monitor = require('./monitor');

/**
 * The outpost agent
 * @param config
 *    root - base directory for outpost files
 *    cliport - the port on which this agent should listen for cli commands on
 *    fortitude - the url of the fortitude from which this outpost agent should retrieve commands from
 *    key - the authentication for communicating with fortitude
 *    registry - url that modules are served from. modules are found in the registry by:
 *     <registry>/module/module-version.tar.gz proxy - a proxy used to access module downloads and the fortitude
 *     proxyAuth - type of authntication to use with the proxy. valid values are 'basic' and 'ntlm' proxyNTLMDomain -
 *     the NTLM domain when the proxy auth type is 'ntlm'
 * @constructor
 */
function Outpost(config) {
  events.EventEmitter.call(this);
  this.config = util._extend({
    id: crypto.randomBytes(6).toString('hex'),
    ip: utilities.localIpAddress(),
    root: path.resolve(__dirname, '../..'),
    cliport: Outpost.prototype.CLIPORT,
    tags: 'optags.json'
  }, config || {});

  this.config.name = this.config.name && this.config.name.trim().length > 0 ? this.config.name : os.hostname();
  this.config.id = this.config.ip + ':' + this.config.id;
  this.config.cacheDir = path.resolve(this.config.root, 'cache');
  this.config.modulesDir = path.resolve(this.config.root, 'modules');
  this.config.monitorDir = path.resolve(this.config.root, 'monitor');
  this.config.runasName = utilities.uidToName(process.getuid());

  try {
    fse.ensureDirSync(this.config.root, 0744);
  } catch (err) {
    if (err && err.code !== 'EEXIST') {
      throw new Error('error creating outpost root directory: ' + err.message);
    }
  }

  this.version = require('../package.json').version;
  this.logFile = path.resolve(this.config.root, 'outpost.log');
  this.commandLogFile = path.resolve(this.config.root, 'command.log');
  this.logger = new Logger('outpost', this.logFile);
  this.cache = new Cache(this);
  this.state = new State(this);
  this.fortitude = new Fortitude(this);
  this.monitor = new Monitor(this);
  this.pendingCommands = [];
}

util.inherits(Outpost, events.EventEmitter);

/**
 * The default outpost cli server port
 * @type {number}
 */
Outpost.prototype.CLIPORT = 7608;

/**
 * Get a proxy instance
 * @private
 */
Outpost.prototype.getProxy = function(target) {
  if (this.config.proxy) {
    var authType = this.config.proxyAuthType || 'basic';
    var proxyingOptions = {
      proxy: this.config.proxy,
      authType: authType
    };
    if (authType === 'ntlm') {
      proxyingOptions.ntlm = {domain: this.config.proxyNTLMDomain};
    }
    return proxying.create(proxyingOptions, target);
  }
  return false;
};

/**
 * Process command that was received from the cli server
 * @param command
 * @param cb
 * @private
 */
Outpost.prototype._processCliCommand = function(command, cb) {
  if (command.type === 'agent') {
    !command.silent && this.logger.shadow(command.shadowLog);
    switch (command.action) {
      case 'stop':
        this.stop(function() {
          cb('success', 'agent stopped');
        });
        break;
      case 'version':
        cb('success', this.version);
        break;
      default:
        cb('error', 'unrecognized action ' + command.action);
        break;
    }
  } else {
    return this.processTopLevel(command, function(result, details) {
      cb(result, details);
    });
  }
};

/**
 * Process a single CLI request received from the http CLI server
 * @param req
 * @param res
 * @private
 */
Outpost.prototype._processCliRequest = function(req, res) {
  var _this = this;
  res.setHeader('Trailer', 'Command-Result');
  var body = '';
  req.on('data', function(data) {
    body += data;
  });
  req.on('end', function(data) {
    if (data) {
      body += data;
    }
    _this.logger.debug('got new cli request: ' + body);

    function _done(result, msg) {
      process.removeListener('uncaughtException', _uncaughtException);
      _this.logger.shadow(null);
      res.addTrailers({"Command-Result": JSON.stringify({result: result, msg: msg})});
      res.end();
    }

    function _uncaughtException(err) {
      _done('error', 'unexpected error occurred: ' + err.stack);
    }

    process.on('uncaughtException', _uncaughtException);

    try {
      var command = JSON.parse(body);

      // add the response as a shadow stream to the logger so that all log messages get to the cli process
      command.shadowLog = {
        write: function() {
          try {
            res.write.apply(res, arguments);
          } catch (e) {
            // ignore
          }
        }
      };

      _this._processCliCommand(command, function(result, details) {
        _done(result, details);
      });

    } catch (err) {
      _this.logger.error('error processing CLI command ' + body + ': ' + err.message);
      _done('error', err.message);
    }
  });
};

/**
 * The CLI server listens for commands from the cli and processes them
 * @param cb
 * @private
 */
Outpost.prototype._setupCliServer = function(cb) {
  var _this = this;
  this.cliServer = http.createServer(function(req, res) {
    _this._processCliRequest(req, res);
  });

  this.cliServer.on('close', function() {
    _this.logger.debug('cli server closed');
  });

  this.cliServer.on('error', function(err) {
    if (err.code && err.code === 'EADDRINUSE') {
      err = 'agent is already running';
    }
    cb && cb(err);
    cb = null;
  });

  // restrict to accepting connections from localhost only
  this.cliServer.listen(this.config.cliport, '127.0.0.1', function() {
    _this.logger.debug('cli server running on port ' + _this.config.cliport);
    cb && cb();
    cb = null;
  });
};

/**
 * initialize this outpost object
 * @param cb
 *
 */
Outpost.prototype.init = function(cb) {
  if (this.initialized) {
    cb && cb();
    return;
  }
  var _this = this;
  this._loadCommands(function() {
    _this.initialized = true;
    cb && cb();
  });
};

/**
 * Starts the outpost agent
 * @param cb called when the agent has finished starting up
 * @param logMessage log a message to the console
 */
Outpost.prototype.start = function(cb, logMessage) {

  var _this = this;
  function _message(message) {
    _this.logger.debug(message);
    logMessage(message);
  }

  var configStr = JSON.stringify(this.config);
  this.logger.debug('-----------------------------------');
  this.logger.debug('starting outpost agent with config: ' + configStr);

  // calculate the hash of the config so we can test if there was a change
  var hash = crypto.createHash('sha256');
  hash.write(configStr);
  hash.end();
  var sha = hash.read().toString('hex');

  // read the previous hash
  var prevSha = null;
  var shaFile =  this.config.root + '/opconfig.sha';
  try {
    prevSha = fs.readFileSync(shaFile, 'utf8').trim();
  } catch (e) {
    if (e.code !== 'ENOENT') {
      cb('error reading ' + shaFile + ': ' + e.message);
      return;
    }
  }

  // if there are configuration changes:
  // 1. need to stop monitoring of existing processes
  // 2. reconfigure all modules
  var purge = prevSha && sha !== prevSha;

  function _startDone(err) {
    // startup auto syncing with fortitude
    _this.fortitude.init(function() {
      if (err) {
        _this.logger.error('agent start failed: ' + err);
      } else {
        _this.logger.debug('agent started');
      }
      cb && cb(err);
    });
  }

  function _startedOk(message) {
    // write the new opconfig hash
    try {
      fs.writeFileSync(shaFile, sha, 'utf8');
      message && _message(message);
    } catch (e) {
      _message('error writing ' + shaFile + ': ' + e.message);
    }
    _startDone();
  }

  this.init(function() {

    _this._setupCliServer(function(err) {
      if (err) {
        _startDone(err);
        return;
      }

      _this._setupProcessHandlers();

      _this._setupCallbacks(function() {
        // if there were opconfig changes, purge all running/monitored processes
        _this.monitor.start(purge, function(err) {
          if (err) {
            _message('error starting monitor service: ' + err);
            _startDone();
            return;
          }

          if (!purge) {
            _startedOk();
            return;
          }

          // if there were opconfig changes, reconfigure all installed modules
          _message('performing reconfiguration');
          _this.state.reconfigure(function(err, commands) {
            if (err) {
              _message('error calculating reconfiguration commands: ' + err);
              _startDone();
              return;
            }
            _this.process(commands, function(err) {
              if (err) {
                _message('error performing reconfiguration: ' + err);
                _startDone();
                return;
              }
              _startedOk('reconfiguration complete');
            });
          });
        });
      });
    });
  });
};

Outpost.prototype._setupProcessHandlers = function() {
  var _this = this;
  process.on('uncaughtException', function _uncaughtException(err) {
    try {
      _this.processing = false;
      _this.logger.error('uncaught exception: ' + err.stack);
    } catch (e) {
      // fallback to printing to console
      console.error('uncaught exception: ' + err.stack);
    }
  });

  function _onSignal(signal) {
    process.stdout.write('\n');
    _this.logger.warning('got ' + signal);
    _this.stop();
    process.nextTick(function() {
      process.exit(0);
    });
  }

  process.on('SIGINT', function() {
    _onSignal('SIGINT');
  });
  process.on('SIGTERM', function() {
    _onSignal('SIGTERM');
  });
};

/**
 * Load possible command types
 * @param cb invoked when the commands are loaded
 * @private
 */
Outpost.prototype._loadCommands = function(cb) {
  this.commands = {};
  var _this = this;
  fs.readdir(path.resolve(__dirname, 'commands'), function(err, files) {
    if (err) {
      _this.logger.error('error reading commands: ' + err);
      return;
    }
    files.forEach(function(file) {
      var match = file.match('(.*)[.]js$');
      if (match) {
        var command = match[1];
        _this.commands[command] = require('./commands/' + command);
      }
    });
    _this.logger.debug('loaded commands: ' + Object.keys(_this.commands));
    cb();
  });
};

/**
 * Setup outpost callbacks
 * @param cb
 * @private
 */
Outpost.prototype._setupCallbacks = function(cb) {
  var _this = this;

  function onShutdown() {
    _this.removeListener('shutdown', onShutdown);
    _this.monitor.stop(function() {
      _this.cliServer.close();
      _this.emit('close');
    });
  }

  this.on('shutdown', onShutdown);
  cb();
};

/**
 * Stop the agent
 */
Outpost.prototype.stop = function(cb) {
  this.logger.debug('stopping agent');
  this.once('close', function() {
    cb && cb();
  });
  this.emit('shutdown');
};

/**
 * process a top level command. sub commands may still be executed
 */
Outpost.prototype.processTopLevel = function(command, cb) {
  if (this.processing) {
    if (command.wait) {
      this.pendingCommands.push({command: command, cb: cb});
    } else {
      cb('error', 'another command is already running');
    }
    return;
  }
  var _this = this;
  this.processing = true;
  !command.silent && this.logger.shadow(command.shadowLog);
  this._process(command, function(result, details) {
    // schedule running the next pending command
    _this.processing = false;
    setImmediate(function() {
      if (_this.pendingCommands.length > 0) {
        var info = _this.pendingCommands.shift();
        _this.processTopLevel(info.command, info.cb);
      }
    });
    cb(result, details);
  });
};

/**
 * Process an array of commands, one by one
 */
Outpost.prototype.process = function(commands, cb) {
  if (!commands || commands.length === 0) {
    cb && cb();
    return;
  }

  var _this = this;
  var command = commands.shift();

  // process the command
  this._process(command, function(result, details) {
    if (result !== 'success' && result !== 'skipped') {
      cb && cb(details);
      cb = null;
      return;
    }

    setTimeout(function() {
      _this.process(commands, cb);
    }, 100);
  });
};

/**
 * Process a single command
 * @param command the command to process
 * @param cb invoked when the command execution completed
 * @private
 */
Outpost.prototype._process = function(command, cb) {
  var _this = this;

  // capture the log of the command execution so we can report result to fortitude
  if (command._id) {
    try {
      fs.unlinkSync(_this.commandLogFile);
    } catch (e) {
      _this.logger.error(`error deleting ${_this.commandLogFile}: ${e.message}`);
    }
    this.logger.capture();
  }

  function _callback(result, details) {
    var captured = _this.logger.release();
    if (captured) {
      // write the captured log to a separate file
      try {
        fs.writeFileSync(_this.commandLogFile, captured)
      } catch (e) {
        _this.logger.error(`error saving last command log to ${_this.commandLogFile}: ${e.message}`);
      }
    }

    if (command._id) {
      // update fortitude of the command result
      _this.fortitude.updateCommand(command._id, {status: result, details: details, log: captured}, function(err) {
        if (err) {
          _this.logger.error('error updating command status:' + err);
        }
      });
    }
    cb && cb(result, details);
    cb = null;
  }

  delete command.shadowLog;
  this.logger.debug('processing command: ' + JSON.stringify(command));
  if (!this.commands[command.type]) {
    this.logger.error('error processing command ' + command.type + ': unknown command type');
    _callback('error', 'unknown command type ' + command.type);
    return;
  }

  command.outpost = this;

  var CommandClass = require('./commands/' + command.type);
  var commandObj = new CommandClass();
  commandObj.on('complete', function(result) {
    var logMessage = 'command ' + command.type + ' finished with ' + result.result + (result.details ? ': ' + result.details : '');
    if (result.result === 'error') {
      _this.logger.error(logMessage);
    } else {
      _this.logger.debug(logMessage);
    }
    _callback(result.result, result.details);
  });
  commandObj.run(command);

};

exports = module.exports = Outpost;