var events = require('events');
var util = require('util');
var url = require('url');
var WebSocket = require('ws');
var WebSocketStream = require('websocket-stream');
var dnode = require('dnode');

/**
 * FederationServer
 * @param bus
 * @param options
 * @constructor
 */
function FederationServer(bus, options) {
  events.EventEmitter.call(this);
  this.bus = bus;
  this.logger = bus.logger.withTag(bus.id + ':fedserver');
  this._options(options);
}

util.inherits(FederationServer, events.EventEmitter);

/**
 * Setup FederationServer options
 * @param options options to set
 * @private
 */
FederationServer.prototype._options = function(options) {
  this.options = options || {};
  this.options.secret = this.options.secret || 'notsosecret';
  this.options.path = this.options.path || '/';
};

/**
 * Start the federation server
 */
FederationServer.prototype.listen = function() {
  if (this.listening) {
    return;
  }
  if (this.options.server) {
    var _this = this;
    this.wss = new WebSocket.Server({server: this.options.server, verifyClient: this._verifyClient.bind(this), path: this.options.path});

    var _onWssConnection = function(ws) {
      _this._onConnection(ws);
    };

    var _onWssListening = function() {
      _this.logger.debug('websocket server is listening');
      _this.listening = true;
      _this.emit('listening');
    };

    var _onWssError = function(err) {
      _this.logger.error('error on websocket server: ' + JSON.stringify(err));
      _this.emit('error', err);
    };

    var _onWssShutdown = function() {
      _this.wss.removeListener('connection', _onWssConnection);
      _this.wss.removeListener('listening', _onWssListening);
      _this.wss.removeListener('error', _onWssError);
      _this.wss.removeListener('shutdown', _onWssShutdown);
    };

    this.wss.on('connection', _onWssConnection);
    this.wss.on('listening', _onWssListening);
    this.wss.on('error', _onWssError);
    this.wss.on('shutdown', _onWssShutdown);
  }
};

/**
 * Close the federation server
 */
FederationServer.prototype.close = function() {
  if (!this.listening) {
    return;
  }
  this.listening = false;
  this.wss.emit('shutdown');
  this.wss.close();
  this.wss = null;
};

/**
 * Handle a new connection
 * @param ws the new connection
 * @private
 */
FederationServer.prototype._onConnection = function(ws) {
  this.logger.info('new federate client connection');
  var _this = this;

  var object;
  var d;

  var onWsMessage = function(msg) {
    _this.logger.info('received message: ' + msg);
    msg = JSON.parse(msg);
    object = _this.bus[msg.type].apply(_this.bus, msg.args);
    _this.logger.info('creating federated object ' + object.id);
    d = _this._federate(object, msg.methods, ws);
  };

  var onWsClose = function() {
    shutdown();
    _this._endFederation('federate client connection closed', object, d);
  }

  var onWsError = function(err) {
    shutdown();
    _this._endFederation('federate client error: ' + JSON.stringify(err), object, d);
  }

  function shutdown() {
    ws.removeListener('message', onWsMessage);
    ws.removeListener('close', onWsClose);
    ws.removeListener('error', onWsError);
  }

  ws.once('message', onWsMessage);
  ws.on('close', onWsClose);
  ws.on('error', onWsError);

};

/**
 * Hookup all the needed methods of the object to be served remotely
 * @param object
 * @param methods
 * @param ws
 * @private
 */
FederationServer.prototype._federate = function(object, methods, ws) {

  var federatable = {};
  methods.forEach(function(method) {
    federatable[method] = function(args) {
      // the arguments arrive as a hash, so make them into an array
      var _args = Object.keys(args).map(function(k) {return args[k]});
      // invoke the real object method
      object[method].apply(object, _args);
    }
  });

  // setup dnode to receive the methods of the object
  var d = dnode(federatable);

  // tell the client that we are ready
  ws.send('ready');

  // start streaming rpc
  var wsStream = WebSocketStream(ws);
  wsStream.pipe(d).pipe(wsStream);
  d._federationStream = wsStream;
  return d;
};

FederationServer.prototype._endFederation = function(msg, object, d) {
  this.logger.info(msg);
  if (d) {
    d.end();
    d._federationStream.unpipe(d);
    delete d._federationStream;
  }
  object && object.detach && object.detach();
};

/**
 * Accept or reject a connecting web socket. the connecting web socket must contain a valid secret query param
 * @param info
 * @returns {*|boolean}
 * @private
 */
FederationServer.prototype._verifyClient = function(info) {
  var parsed = url.parse(info.req.url, true);
  return parsed.query && (parsed.query.secret === this.options.secret);
};

module.exports = exports = FederationServer;