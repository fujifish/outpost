var events = require('events');
var fs = require('fs');
var util = require('util');
var Logger = require('./logger');

/**
 * Base command
 * @constructor
 */
function Command() {
  events.EventEmitter.call(this);
  this.type = this.constructor.name.replace('Command', '').replace(/([A-Z])/g, function($1){return $1.toLowerCase();});
}

util.inherits(Command, events.EventEmitter);

/**
 * Run this command
 * @param command the command data
 */
Command.prototype.run = function(command) {
  this.command = command;
  this.logger = new Logger('outpost:command:' + this.type, command.outpost.logger);
  this.outpost = command.outpost;
  this.cache = command.outpost.cache;
  this.state = command.outpost.state;
  this.monitor = command.outpost.monitor;
  this.execute();
};

///**
// * initialize this command for execution and prepare for execution
// * @private
// */
//Command.prototype._init = function() {
//  var npmConfig = {
//    cache: this.command.outpost.config.cacheDir,
//    'fetch-retries': 2
//  };
//
//  var _this = this;
//  npm.load(npmConfig, function (err) {
//    if (err) {
//      _this.complete('error', 'error loading npm config: ' + err);
//      return;
//    }
//    _this.execute();
//  });
//};

/**
 * Execution method. Commands should override this method with the command logic
 */
Command.prototype.execute = function() {}

/**
 * specify that this command completed
 * @param result the result for the execution: 'success', 'error', 'skipped'
 * @param details additional completion details
 */
Command.prototype.complete = function(result, details) {
  this.emit('complete', {result: result, details: details});
};


exports = module.exports = Command;