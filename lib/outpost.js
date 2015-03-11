var Logger = require('./logger');
var fs = require('fs');
var url = require('url');
var http = require('http');
var https = require('https');
var cluster = require('cluster');
//var express = require('express');
var proxying = require('proxying-agent');

function Outpost(config) {
  this.config = config || {};
  this.logger = new Logger('outpost', this.config.log);
}

Outpost.prototype.start = function(cb) {
  this.logger.info('starting outpost agent with config: ' + JSON.stringify(this.config));

  if (this.config.homebase) {
    this.homebase = url.parse(this.config.homebase);
    this.ssl = this.homebase.protocol === 'https:';
    this.transport = this.ssl ? https : http;
    if (this.config.proxy) {
      var proxyingOptions = {
        proxy: this.config.proxy,
        authType: (this.config.proxyAuth || 'basic'),
        ntlm: {
          domain: this.config.proxyNTLMDomain
        },
        tunnel: this.ssl
      };
      this.proxy = new proxying.ProxyingAgent(proxyingOptions);
    }
  }

  var _this = this;
  this._setupCallbacks(function() {
    _this._loadCommands(cb);
  });
};

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
    this.logger.log(msg.log);
    return;
  }

  if (msg.event === 'complete') {
    cb(msg.result);
  }
};

Outpost.prototype.stop = function() {
  cluster.emit('shutdown');
};

Outpost.prototype._fetchCommands = function() {
  var reqOptions = {
    hostname: this.homebase.hostname,
    path: (this.homebase.path || '/commands') + '?key=' + this.config.key,
    method: 'GET',
    proxy: this.proxy
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
    if (result.status !== 'success') {
      _this.logger.error('failure message: ' + result.message);
      _this.logger.error('aborting all later commands.');
    } else {
      _this.process(commands);
    }
  });
};

Outpost.prototype._process = function(command, cb) {
  this.logger.info('processing command: ' + JSON.stringify(command));
  if (!this.commands[command.type]) {
    this.logger.error('error processing command ' + command.type + ': unknown command type');
    cb();
    return;
  }

  command.config = this.config;

  var _this = this;
  // run in this process
  if (this.config.fork === false) {
    var work = require('./worker');
    work(command, function(msg) {
      _this._handleWorkerMessage(msg, cb);
    });
    return;
  }

  // start a worker
  var worker = cluster.fork({command: JSON.stringify(command)});
  worker.on('message', function(msg) {
    _this._handleWorkerMessage(msg, cb);
  });

};

exports = module.exports = Outpost;