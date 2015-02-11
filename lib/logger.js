var cluster = require('cluster');
var Log = require('log');

var Logger = function(tag, file) {
  this.tag = tag;
  var stream;
  if (cluster.isMaster) {
    if (file) {
      var fs = require('fs');
      stream = fs.createWriteStream(file, { flags: 'a' });
    } else {
      stream = process.stdout;
    }
  } else {
    stream = {
      write: function(data) {
        process.send( { log: data } );
      }
    };
  }
  this._log = new Log(Log.DEBUG, stream);
};

Logger.prototype.format = function(msg) {
  if (this.tag) {
    return '[' + this.tag + '] ' + msg;
  }
  return msg;
};

Logger.prototype.log = function(msg) {
  this._log.stream.write(msg);
};

Logger.prototype.debug = function(msg) {
  this._log.debug(this.format(msg));
};

Logger.prototype.info = function(msg) {
  this._log.info(this.format(msg));
};

Logger.prototype.warning = function(msg) {
  this._log.warning(this.format(msg));
};

Logger.prototype.error = function(msg) {
  this._log.error(this.format(msg));
};

Logger.prototype.critical = function(msg) {
  this._log.critical(this.format(msg));
};

exports = module.exports = Logger;
