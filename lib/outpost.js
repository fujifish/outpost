var fs = require('fs');
var path = require('path');
var util = require('util');
var crypto = require('crypto');
var url = require('url');
var http = require('http');
var https = require('https');
var events = require('events');
var proxying = require('proxying-agent');
var Logger = require('./logger');
var Manifest = require('./manifest');
var Monitor = require('./monitor');

/**
 * The outpost agent
 * @param config.
 *    id - a identification of this agent instance. used for fetching commands from the homebase and for updating status
 *    root - base directory for outpost files.
 *    cliport - the port on which this agent should listen for cli commands on
 *    homebase - the url of the homebase from which this outpost agent should retrieve commands from.
 *    registry - url that modules are served from. modules are found in the registry by: <registry>/module/module-version.tar.gz
 *    proxy - a proxy used to access module downloads and the homebase
 * @constructor
 */
function Outpost(config) {
  events.EventEmitter.call(this);
  this.config = util._extend({
    id: crypto.randomBytes(4).toString('hex'),
    root: path.resolve(__dirname, '..'),
    cliport: Outpost.prototype.CLIPORT
  }, config || {});

  this.config.cacheDir = path.resolve(this.config.root, '.cache');
  this.config.modulesDir = path.resolve(this.config.root, '.modules');
  this.config.monitorDir = path.resolve(this.config.root, '.monitor');

  this.logger = new Logger('outpost', this.config.log);
  this.manifest = new Manifest(this);
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
Outpost.prototype._getProxy = function(target) {
  if (this.config.proxy) {
    var parsed = url.parse(target);
    var proxyingOptions = {
      proxy: target,
      authType: (this.config.proxyAuth || 'basic'),
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
 * Process  command that was received from the cli server
 * @param command
 * @param cb
 * @private
 */
Outpost.prototype._processCliCommand = function(command, cb) {
  if (command.type === 'agent') {
    if (command.action === 'stop') {
      this.stop(function() {
        cb('agent stopped');
      });
    } else {
      cb('unrecognized action ' + command.action);
    }
  } else {
    this.process([command], cb);
  }
};

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

    function _done(err) {
      process.removeListener('uncaughtException', _uncaughtException);
      _this.logger.shadow(null);
      err = err ? err+'\n' : err;
      res.end(err);
    }

    function _uncaughtException(err) {
      _done('unexpected error occurred: ' + err.message);
    }
    process.on('uncaughtException', _uncaughtException);

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

    try {
      // add the response as a shadow stream to the logger so that all log messages get to the cli process
      _this.logger.shadow(shadow);
      _this._processCliCommand(JSON.parse(body), function(err) {
        _done(err);
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

    if (_this.config.homebase) {
      _this.homebase = url.parse(_this.config.homebase);
      _this.transport = _this.homebase.protocol === 'https:' ? https : http;
      _this.proxy = _this._getProxy(_this.homebase)
    }

    _this.manifest.load(function(err) {
      if (err) {
        _this.logger.error('error loading manifest: ' + err);
        cb(err);
      }
      _this._setupCallbacks(function() {
        _this._loadCommands(function() {
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
      _this.logger.error('uncaught exception: ' + ((err instanceof Error) ? err.stack : err));
    } catch (e) {
      // fallback to printing to console
      console.error('uncaught exception: ' + ((err instanceof Error) ? err.stack : err));
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

  process.on('SIGINT', function() {_onSignal('SIGINT');});
  process.on('SIGTERM', function() {_onSignal('SIGTERM');});
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
 * Fetch a list of commands to execute from the homebase
 * @private
 */
Outpost.prototype._fetchCommands = function() {
  var reqOptions = {
    hostname: this.homebase.hostname,
    path: (this.homebase.path || '/commands') + '?key=' + this.config.key,
    method: 'GET',
    agent: this.proxy
  };
  var _this = this;
  var req = this.transport.request(reqOptions, function(res) {
    if (res.statusCode !== 200) {
      _this.logger.error('failed to fetch commands. received status ' + res.statusCode);
      return;
    }
    var body = '';
    res.on('data', function(data) {
      body = body + data;
    });
    res.on('end', function(data) {
      if (data) {
        body = body + data;
      }
      _this.process(JSON.parse(body));
    });
  });

  // do it like this because with ntlm proxy we dont want to end the request until the ntlm handshake is done
  req.on('socket', function() {
    req.end();
  });
};

/**
 * Process an array of commands, one by one
 * @param commands array of commands to process
 * @param cb invoked when done
 */
Outpost.prototype.process = function(commands, cb) {
  if (!commands || commands.length === 0) {
    cb && cb();
    return;
  }

  var _this = this;
  var command = commands.shift();
  this._process(command, function(result, details) {
    var logMessage = 'command ' + command.type + ' finished with ' + result + (details ? ': ' + details : '');
    if (result === 'error') {
      _this.logger.error(logMessage);
    } else {
      _this.logger.debug(logMessage);
    }
    if (result !== 'success' && result !== 'skipped') {
      _this.logger.error('aborting');
      cb();
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
  this.logger.debug('processing command: ' + JSON.stringify(command));
  if (!this.commands[command.type]) {
    this.logger.error('error processing command ' + command.type + ': unknown command type');
    cb('error', 'unknown command type ' + command.type);
    return;
  }

  command.outpost = {
    config: this.config,
    manifest: this.manifest,
    monitor: this.monitor,
    logger: this.logger
  };

  var CommandClass = require('./commands/' + command.type);
  var commandObj = new CommandClass();
  commandObj.on('complete', function(result) {
    cb(result.result, result.details);
  });
  commandObj.run(command);

};

exports = module.exports = Outpost;