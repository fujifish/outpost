var fs = require('fs');
var path = require('path');
var util = require('util');
var url = require('url');
var http = require('http');
var https = require('https');
var cluster = require('cluster');
var proxying = require('proxying-agent');
var Logger = require('./logger');
var Manifest = require('./manifest');
var Monitor = require('./monitor');

/**
 * The outpost agent
 * @param config.
 *    homebase - the url of the homebase from which this outpost agent should retrieve commands from.
 *    id - a identification of this agent instance. used for fetching commands from the homebase and for updating status
 *    proxy - a proxy used to access module downloads and the homebase
 *    root - base directory for outpost files.
 *    registry - url that modules are served from. modules are found in the registry by: <registry>/module/module-version.tar.gz
 * @constructor
 */
function Outpost(config) {
  this.config = util._extend({
//    fork: false,
    root: path.resolve(__dirname, '..')
  }, config || {});

  this.config.cacheDir = path.resolve(this.config.root, '.cache');
  this.config.modulesDir = path.resolve(this.config.root, '.modules');
  this.config.monitorDir = path.resolve(this.config.root, '.monitor');

  this.logger = new Logger('outpost', this.config.log);
  this.manifest = new Manifest(this.config);
  this.monitor = new Monitor(this.config);
}

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
 * Starts the outpost agent
 * @param cb called when the agent is initialized
 */
Outpost.prototype.start = function(cb) {
  this.logger.info('starting outpost agent with config: ' + JSON.stringify(this.config));

  this._setupProcessHandlers();

  if (this.config.homebase) {
    this.homebase = url.parse(this.config.homebase);
    this.transport = this.homebase.protocol === 'https:' ? https : http;
    this.proxy = this._getProxy(this.homebase)
  }

  var _this = this;
  this.manifest.load(function(err) {
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
};

Outpost.prototype._setupProcessHandlers = function() {
  var _this = this;
  process.on('uncaughtException', function _uncaughtException(err) {
    try {
      _this.logger.error('uncaught exception: ' + ((err instanceof Error) ? err.stack : err));
    } catch (e) {
      // fallback to printing to console
      console.log('uncaught exception: ' + ((err instanceof Error) ? err.stack : err));
    }
  });

  process.on('SIGINT', function _onSIGINT() {
    _this.logger.info('got SIGINT');
    _this.stop();
    process.nextTick(function() {
      process.exit(0);
    });
  });

  process.on('SIGTERM', function _onSIGTERM() {
    _this.logger.info('got SIGTERM');
    _this.stop();
    process.nextTick(function() {
      process.exit(0);
    });
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
    _this.logger.info('loaded commands: ' + Object.keys(_this.commands));
    cb();
  });
};

/**
 * Setup worker callbacks
 * @param cb
 * @private
 */
Outpost.prototype._setupCallbacks = function(cb) {
  var _this = this;

  function onFork(worker) {
  }

  function onOnline(worker) {
  }

  function onExit(worker, code, signal) {
    _this.logger.info('worker exited with code ' + code + ' and signal ' + signal);
  }

  function onShutdown() {
    cluster.removeListener('fork', onFork);
    cluster.removeListener('online', onOnline);
    cluster.removeListener('exit', onExit);
    cluster.removeListener('shutdown', onShutdown);
    _this.monitor.stop();
  }

  cluster.on('fork', onFork);
  cluster.on('online', onOnline);
  cluster.on('exit', onExit);
  cluster.on('shutdown', onShutdown);

  // set the worker script
  cluster.setupMaster({
    exec: 'lib/worker.js',
    silent: false
  });

  cb();
};

/**
 * Stop the agent
 */
Outpost.prototype.stop = function() {
  this.logger.info('stopping agent');
  cluster.emit('shutdown');
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
    this.logger.info('no more commands to process');
    cb && cb();
    return;
  }

  var _this = this;
  var command = commands.shift();
  this._process(command, function(result, details) {
    _this.logger.info('command ' + command.type + ' finished with ' + result + (details ? ': ' + details : ''));
    if (result !== 'success' && result !== 'skipped') {
      _this.logger.error('aborting all later commands');
    } else {
      setTimeout(function() {
        _this.process(commands, cb);
      }, 100);
    }
  });
};

/**
 * Process a single command
 * @param command the command to process
 * @param cb invoked when the command execution completed
 * @private
 */
Outpost.prototype._process = function(command, cb) {
  this.logger.info('processing command: ' + JSON.stringify(command));
  if (!this.commands[command.type]) {
    this.logger.error('error processing command ' + command.type + ': unknown command type');
    cb('error', 'unknown command type ' + command.type);
    return;
  }

  command.outpost = {
    config: this.config,
    manifest: this.manifest,
    monitor: this.monitor
  };

  var CommandClass = require('./commands/' + command.type);
  var commandObj = new CommandClass();
  commandObj.on('complete', function(result) {
    cb(result.result, result.details);
  });
  commandObj.run(command);

};

exports = module.exports = Outpost;