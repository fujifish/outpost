var cluster = require('cluster');
var chalk = require('chalk');
var fmt = require('util').format;

var Logger = function(tag, file) {
  this.tag = tag;
  this.chalk = new chalk.constructor({enabled: true});
//  this.chalk = chalk;
  if (typeof file === 'string') {
    var fs = require('fs');
    this.stream = fs.createWriteStream(file, { flags: 'a' });
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
