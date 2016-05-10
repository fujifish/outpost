var http = require('http');
var https = require('https');
var proxying = require('proxying-agent');
var url = require('url');
var Logger = require('./logger');

/**
 * Connector to the fortitude server
 * @param outpost
 * @constructor
 */
function fortitude(outpost) {
  this.outpost = outpost;
  this.config = outpost.config;
  this.logger = new Logger('outpost:fortitude', outpost.logger);
}

/**
 * Initialize fortitude
 * @param cb
 */
fortitude.prototype.init = function(cb) {
  if (this.config.fortitude) {
    this.fortitude = url.parse(this.config.fortitude);
    this.transport = this.fortitude.protocol === 'https:' ? https : http;
    this.frequency = this.config.syncFrequency || 0;

    var _this = this;
    if (this.frequency >= 30) {
      _this.logger.debug('setting up auto sync every ' + this.frequency + ' seconds');

      function autoSync() {
        if (!_this.outpost.processing) {
          _this.outpost.processTopLevel({type: 'sync'}, function(result, details) {
            if (result !== 'success') {
              _this.logger.error('auto sync ' + result + ': ' + details);
            }
          });
        }
      }
      setInterval(autoSync, _this.frequency * 1000);
      autoSync();
    } else {
      _this.logger.debug('auto sync is disabled');
    }
  }
  cb();
};

/**
 * Send a request to fortitude
 * @param path
 * @param method
 * @param data
 * @param cb
 * @private
 */
fortitude.prototype._send = function(path, method, data, cb) {
  if (!this.fortitude) {
    cb('fortitude is not defined');
    return;
  }

  var message = {
    id: this.config.id,
    name: this.config.name,
    payload: data
  };
  var messageData = JSON.stringify(message);

  var fullpath = '/' + (this.fortitude.path.split('/').concat(path.split('/'))).filter(function(p){return p.length>0}).join('/');
  var reqOptions = {
    hostname: this.fortitude.hostname,
    port: this.fortitude.port,
    path: fullpath + '?auth=' + this.config.auth,
    method: method,
    agent: this.outpost.getProxy(this.config.fortitude),
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(messageData, 'utf8')
    }
  };

  // make the request
  var req = this.transport.request(reqOptions, function(res) {
    res.on('error', function(err) {
      cb('error receiving response from fortitude: ' + err.message);
    });

    var body = '';

    res.on('data', function(data) {
      body = body + data;
    });

    res.on('end', function(data) {
      if (data) {
        body = body + data;
      }

      if (!body || body.length === 0) {
        cb(null, null);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 201) {
        cb('request returned status ' + res.statusCode + ': ' + body);
        return;
      }

      try {
        cb(null, JSON.parse(body));
      } catch (err) {
        cb('error parsing fortitude response: ' + err.message + ", body = "  +body);
      }
    });
  });

  req.on('error', function(err) {
    cb('error sending request to fortitude: ' + err.message);
  });

  // do it like this because with ntlm proxy we dont want to end the request until the ntlm handshake is done
  req.on('socket', function() {
    req.write(messageData);
    req.end();
  });
};

/**
 * Send a sync request to fortitude
 * @param state the state to send to fortitude
 * @param cb
 */
fortitude.prototype.sync = function(state, cb) {
  this._send('agent/nodes/sync', 'POST', state, cb);
};

/**
 * Update the status of a fortitude command
 */
fortitude.prototype.updateCommand = function(id, data, cb) {
  this._send('agent/commands/'+id, 'PUT', data, cb);
};

/**
 * Send a unregister request to fortitude
 */
fortitude.prototype.unregister = function(cb) {
  this._send('agent/unregister', 'POST', null, cb);
};

exports = module.exports = fortitude;