var cluster = require('cluster');
var fmt = require('util').format;

var Logger = function(tag, file) {
  this.tag = tag;
  if (cluster.isMaster) {
    if (file) {
      var fs = require('fs');
      this.stream = fs.createWriteStream(file, { flags: 'a' });
    } else {
      this.stream = process.stdout;
    }
  } else {
    this.stream = {
      write: function(data) {
        process.send( { log: data } );
      }
    };
  }
};

Logger.prototype.log = function(levelStr, args) {
  var msg = fmt.apply(null, args);
  this.stream.write(
    '[' + new Date().toISOString() + ']'
      + ' ' + levelStr
      + ' ' + (this.tag ? '[' + this.tag + ']' : '')
      + ' ' + msg
      + '\n'
  );
};

Logger.prototype.raw = function(message) {
  this.stream.write(message);
};

Logger.prototype.debug = function(msg) {
  this.log('DEBUG', arguments);
};

Logger.prototype.info = function(msg) {
  this.log('INFO ', arguments);
};

Logger.prototype.warning = function(msg) {
  this.log('WARN ', arguments);
};

Logger.prototype.error = function(msg) {
  this.log('ERROR', arguments);
};

Logger.prototype.fatal = function(msg) {
  this.log('FATAL', arguments);
};

exports = module.exports = Logger;
