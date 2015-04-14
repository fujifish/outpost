var fs = require('fs');
var util = require('util');
var url = require('url');
var http = require('http');
var https = require('https');
var cluster = require('cluster');
var proxying = require('proxying-agent');
var Logger = require('./logger');
var Manifest = require('./manifest');

/**
 * The output agent
 * @param config.
 *    homebase - the url of the homebase from which this outpost agent should retrieve commands from.
 *    proxy - a proxy to access module downloads and the homebase
 *    key - a key identifying this agent instance. used for fetching commands from the homebase and for updating status
 *    fork - whether to run commands in separate processes. default is true.
 * @constructor
 */
function Outpost(config) {
  this.config = util._extend({
    fork: true,
    cache: './cache',
    modules: './modules'
  }, config || {});

  this.logger = new Logger('outpost', this.config.log);
  this.manifest = new Manifest(this.config);
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

  if (this.config.homebase) {
    this.homebase = url.parse(this.config.homebase);
    this.transport = this.homebase.protocol === 'https:' ? https : http;
    this.proxy = this._getProxy(this.homebase)
  }

  var _this = this;
  this.manifest.load(function(err) {
    if (err) {
      _this.logger.error('error loading manifest: ' + err);
      return;
    }
    _this._setupCallbacks(function() {
      _this._loadCommands(cb);
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

Outpost.prototype._handleWorkerMessage = function(msg, cb) {
  if (msg.log) {
    this.logger.raw(msg.log);
    return;
  }

  if (msg.event === 'complete') {
    cb(msg.result);
  }
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
  this._process(command, function(result) {
    _this.logger.info(command.type + ' finished with ' + result.status);
    if (result.status !== 'success' && result.status !== 'skipped') {
      _this.logger.error('failure message: ' + result.message);
      _this.logger.error('aborting all later commands.');
    } else {
      _this.process(commands, cb);
    }
  });
};

/**
 * Process a single command
 * @param command
 * @param cb
 * @private
 */
Outpost.prototype._process = function(command, cb) {
  this.logger.info('processing command: ' + JSON.stringify(command));
  if (!this.commands[command.type]) {
    this.logger.error('error processing command ' + command.type + ': unknown command type');
    cb();
    return;
  }

  var _this = this;
  // run in this process
  if (this.config.fork === false) {
    command.outpost = {};
    command.outpost.config = this.config;
    var work = require('./worker');
    work(command, function(msg) {
      _this._handleWorkerMessage(msg, cb);
    });
    return;
  }

  // start a worker
  var worker = cluster.fork({
    command: JSON.stringify(command),
    config: JSON.stringify(this.config)
  });
  worker.on('message', function(msg) {
    _this._handleWorkerMessage(msg, cb);
  });

};

exports = module.exports = Outpost;