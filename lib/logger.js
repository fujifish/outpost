var cluster = require('cluster');
var chalk = require('chalk');
var fmt = require('util').format;
var logrotateStream = require('logrotate-stream');

var Logger = function(tag, file) {
  this.tag = tag;
  this.chalk = new chalk.constructor({enabled: true});
  if (typeof file === 'string') {
    this.stream = logrotateStream({file: file, size: '10m', keep: 4, compress: true});
    this.isFile = true;
  } else if (file instanceof Logger) {
    this.stream = file;
  } else {
    this.stream = process.stdout;
  }
};

Logger.prototype.shadow = function(stream) {
  this.shadowStream = stream;
};

Logger.prototype.capture = function() {
  this.captured = '';
};

Logger.prototype.release = function() {
  var captured = this.captured;
  delete this.captured;
  return captured;
};

Logger.prototype.log = function(levelStr, args) {
  var msg = fmt.apply(null, args);
  var prefix = this.chalk.gray.dim(
    '[' + new Date().toISOString() + ']'
    + ' ' + levelStr
    + ' ' + (this.tag ? '[' + this.tag + ']' : ''));
  this.write(prefix + ' ' + msg  + '\n');
};

Logger.prototype.write = function(message) {
  var m = message;
  if (this.isFile) {
    m = chalk.stripColor(message);
  }
  this.stream.write(m);

  if (this.captured !== undefined) {
    this.captured += m;
  }

  try {
    this.shadowStream && this.shadowStream.write(message);
  } catch (err) {
    this.shadowStream = null;
    this.error('error writing to shadow stream: ' + err.message);
  }
};

Logger.prototype.debug = function(msg) {
  this.log('DEBUG', arguments);
};

Logger.prototype.info = function(msg) {
  this.log('INFO ', arguments);
};

Logger.prototype.warning = function(msg) {
  arguments[0] = this.chalk.yellow(msg);
  this.log('WARN ', arguments);
};

Logger.prototype.error = function(msg) {
  arguments[0] = this.chalk.red(msg);
  this.log('ERROR', arguments);
};

Logger.prototype.fatal = function(msg) {
  arguments[0] = this.chalk.red(msg);
  this.log('FATAL', arguments);
};

exports = module.exports = Logger;
