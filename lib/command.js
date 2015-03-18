var events = require('events');
var util = require('util');
var Logger = require('./logger');

/**
 * Base command
 * @param type
 * @constructor
 */
function Command(type) {
  events.EventEmitter.call(this);
  this.type = type;
  this.logger = new Logger(this.type);
}

util.inherits(Command, events.EventEmitter);

/**
 * Run this command
 * @param command
 */
Command.prototype.run = function(command) {
  this.command = command;
  this.execute();
};

/**
 * specify that this command completed
 * @param status
 * @param msg
 */
Command.prototype.complete = function(status, msg) {
  if (msg) {
    this.logger.error(msg);
  }
  this.emit('complete', {status: status, message: msg});
};

exports = module.exports = Command;