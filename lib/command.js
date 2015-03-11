var events = require('events');
var util = require('util');
var Logger = require('./logger');

function Command(type) {
  events.EventEmitter.call(this);
  this.type = type;
  this.logger = new Logger(this.type);
}

util.inherits(Command, events.EventEmitter);

Command.prototype.run = function(command) {
  this.command = command;
  this.execute();
};

Command.prototype.complete = function(status, msg) {
  if (msg) {
    this.logger.error(msg);
  }
  this.emit('complete', {status: status, message: msg});
};

exports = module.exports = Command;