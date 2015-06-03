var http = require('http');
var https = require('https');
var proxying = require('proxying-agent');

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
 * Get a proxy instance for the given url
 * @param target
 * @private
 */
Homebase.prototype._getProxy = function(target) {
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
 * Initialize homebase
 * @param cb
 */
Homebase.prototype.init = function(cb) {
  if (this.config.homebase) {
    this.homebase = url.parse(this.config.homebase);
    this.transport = this.homebase.protocol === 'https:' ? https : http;
    this.proxy = this._getProxy(this.homebase)
  }
  cb();
};

/**
 * Send a request to homebase
 * @param path
 * @param data
 * @param cb
 * @private
 */
Homebase.prototype._send = function(path, data, cb) {
  if (!this.homebase) {
    cb('homebase is not defined');
    return;
  }

  var message = {
    key: this.config.key,
    payload: data
  };

  var reqOptions = {
    hostname: this.homebase.hostname,
    path: (this.homebase.path || '') + path + '?key=' + this.config.key,
    method: 'POST',
    agent: this.proxy
  };

  // make the request
  var req = this.transport.request(reqOptions, function(res) {
    if (res.statusCode !== 200 && res.statusCode !== 201) {
      cb('request returned basf status code. received status ' + res.statusCode);
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

      cb(err, JSON.parse(body));
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
 * @param data the data to send to homebase
 * @param cb
 */
Homebase.prototype.sync = function(data, cb) {
  this._send('/nodes', data, cb);
};

exports = module.exports = Homebase;