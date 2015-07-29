var fs = require('fs');
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
var Logger = require('./logger');
var Cache = require('./cache');
var State = require('./state');
var fortitude = require('./fortitude');
var Monitor = require('./monitor');

/**
 * The outpost agent
 * @param config
 *    root - base directory for outpost files
 *    cliport - the port on which this agent should listen for cli commands on
 *    fortitude - the url of the fortitude from which this outpost agent should retrieve commands from
 *    key - the authentication for communicating with fortitude
 *    registry - url that modules are served from. modules are found in the registry by: <registry>/module/module-version.tar.gz
 *    proxy - a proxy used to access module downloads and the fortitude
 *    proxyAuth - type of authntication to use with the proxy. valid values are 'basic' and 'ntlm'
 *    proxyNTLMDomain - the NTLM domain when the proxy auth type is 'ntlm'
 * @constructor
 */
function Outpost(config) {
  events.EventEmitter.call(this);
  this.config = util._extend({
    id: crypto.randomBytes(6).toString('hex'),
    root: path.resolve(__dirname, '../..'),
    cliport: Outpost.prototype.CLIPORT
  }, config || {});

  this.config.root = path.resolve(this.config.root, '.outpost');
  this.config.cacheDir = path.resolve(this.config.root, 'cache');
  this.config.modulesDir = path.resolve(this.config.root, 'modules');
  this.config.monitorDir = path.resolve(this.config.root, 'monitor');

  try {
    fse.ensureDirSync(this.config.root, 0744);
  } catch (err) {
    if (err && err.code !== 'EEXIST') {
      this.logger.error('error creating outpost root directory: ' + err.message);
      return;
    }
  }

  this.version = require('../package.json').version;
  this.logFile = path.resolve(this.config.root, 'outpost.log');
  this.logger = new Logger('outpost', this.logFile);
  this.cache = new Cache(this);
  this.state = new State(this);
  this.fortitude = new fortitude(this);
  this.monitor = new Monitor(this);
}

util.inherits(Outpost, events.EventEmitter);

/**
 * The default outpost cli server port
 * @type {number}
 */
Outpost.prototype.CLIPORT = 7608;

/**
 * Get a proxy instance for the given url
 * @param target
 * @private
 */
Outpost.prototype.getProxy = function(target) {
  if (this.config.proxy) {
    var parsed = url.parse(target);
    var proxyingOptions = {
      proxy: target,
      authType: (this.config.proxyAuthType || 'basic'),
      ntlm: {
        domain: this.config.proxyNTLMDomain
      },
      tunnel: (parsed.protocol === 'https:')
    };
    return new proxying.ProxyingAgent(proxyingOptions);
  }
  return null;
};

/**
 * Process command that was received from the cli server
 * @param command
 * @param cb
 * @private
 */
Outpost.prototype._processCliCommand = function(command, cb) {
  if (command.type === 'agent') {
    if (command.action === 'stop') {
      this.stop(function() {
        cb('success', 'agent stopped');
      });
    } else if (command.action === 'version') {
      cb('success', this.version);
    } else {
      cb('error', 'unrecognized action ' + command.action);
    }
  } else {
    if (this.processing) {
      cb ('error', 'another command is already running');
    } else {
      this._process(command, function(result, details) {
        cb(result, details);
      });
    }
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
  var body = '';
  req.on('data', function(data) {
    body += data;
  });
  req.on('end', function(data) {
    if (data) {
      body += data;
    }
    _this.logger.debug('got new cli request: ' + body);

    function _done(msg) {
      process.removeListener('uncaughtException', _uncaughtException);
      _this.logger.shadow(null);
      msg = msg ? msg + '\n' : msg;
      res.end(msg);
    }

    function _uncaughtException(err) {
      _done('unexpected error occurred: ' + err.stack);
    }

    process.on('uncaughtException', _uncaughtException);

    try {
      var command = JSON.parse(body);
      // add the response as a shadow stream to the logger so that all log messages get to the cli process
      if (!command.silent) {
        // wrap the response to be used as the shadow for the logger.
        // this is done to protect against errors if the response stream ends abruptly.
        var shadow = {
          write: function() {
            try {
              res.write.apply(res, arguments);
            } catch (e) {
              // ignore
            }
          }
        };
        _this.logger.shadow(shadow);
      }
      _this._processCliCommand(command, function(result, details) {
        if (result === 'error') {
          details = 'Error:' + details;
        }
        _done(details);
      });
    } catch (err) {
      _this.logger.error('error processing CLI command ' + body + ': ' + err.message);
      _done(err);
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
  this.cliServer.listen(this.config.cliport, 'localhost', function() {
    _this.logger.debug('cli server running on port ' + _this.config.cliport);
    cb && cb();
    cb = null;
  });
};

/**
 * Starts the outpost agent
 * @param cb called when the agent is initialized
 */
Outpost.prototype.start = function(cb) {
  var _this = this;
  this.logger.debug('starting outpost agent with config: ' + JSON.stringify(_this.config));

  this._setupCliServer(function(err) {
    if (err) {
      cb(err);
      return;
    }

    _this._setupProcessHandlers();

    _this._setupCallbacks(function() {
      _this._loadCommands(function() {
        _this.fortitude.init(function() {
          _this.monitor.start(function(err) {
            if (err) {
              _this.logger.error('error starting monitor service: ' + err);
            }
            cb(err);
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
  fs.readdir('./lib/commands', function(err, files) {
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
  this.processing = true;
  this._process(command, function(result, details) {
    _this.processing = false;
    if (result !== 'success' && result !== 'skipped') {
      cb(details);
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
    this.logger.capture();
  }

  function _callback(result, details) {
    if (command._id) {
      var captured = _this.logger.release();
      _this.fortitude.updateCommand(command._id, {status: result, details: details, log: captured}, function(err) {
        if (err) {
          _this.logger.error('error updating command status:' + err);
        }
      });
    }
    cb(result, details);
  }

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