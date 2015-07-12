var http = require('http');
var https = require('https');
var proxying = require('proxying-agent');
var url = require('url');

/**
 * Connector to the homebase
 * @param outpost
 * @constructor
 */
function Homebase(outpost) {
  this.outpost = outpost;
  this.config = outpost.config;
}


/**
 * Initialize homebase
 * @param cb
 */
Homebase.prototype.init = function(cb) {
  if (this.config.homebase) {
    this.homebase = url.parse(this.config.homebase);
    this.transport = this.homebase.protocol === 'https:' ? https : http;
    this.proxy = this.outpost.getProxy(this.homebase)
  }
  cb();
};

/**
 * Send a request to homebase
 * @param path
 * @param method
 * @param data
 * @param cb
 * @private
 */
Homebase.prototype._send = function(path, method, data, cb) {
  if (!this.homebase) {
    cb('homebase is not defined');
    return;
  }

  var message = {
    id: this.config.id,
    name: this.config.name,
    payload: data
  };

  var fullpath = '/' + (this.homebase.path.split('/').concat(path.split('/'))).filter(function(p){return p.length>0}).join('/');
  var reqOptions = {
    hostname: this.homebase.hostname,
    port: this.homebase.port,
    path: fullpath + '?key=' + this.config.key,
    method: method,
    agent: this.proxy,
    headers: { 'Content-Type': 'application/json' }
  };

  // make the request
  var req = this.transport.request(reqOptions, function(res) {
    if (res.statusCode !== 200 && res.statusCode !== 201) {
      cb('request returned status ' + res.statusCode);
      return;
    }

    res.on('error', function(err) {
      cb('error receiving response from homebase: ' + err.message);
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

      try {
        cb(null, JSON.parse(body));
      } catch (err) {
        cb('error parsing homebase response: ' + err.message);
      }
    });
  });

  req.on('error', function(err) {
    cb('error sending request to homebase: ' + err.message);
  });

  // do it like this because with ntlm proxy we dont want to end the request until the ntlm handshake is done
  req.on('socket', function() {
    req.write(JSON.stringify(message));
    req.end();
  });
};

/**
 * Send a sync request to homebase
 * @param state the state to send to homebase
 * @param cb
 */
Homebase.prototype.sync = function(state, cb) {
  this._send('api/public/nodes/sync', 'POST', state, cb);
};

/**
 * Update the status of a homebase command
 */
Homebase.prototype.updateCommand = function(id, data, cb) {
  this._send('api/public/commands/'+id, 'PUT', data, cb);
};


exports = module.exports = Homebase;