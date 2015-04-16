var events = require('events');
var fs = require('fs');
var util = require('util');
var npm = require('npm');
var Logger = require('./logger');

/**
 * Base command
 * @param type
 * @constructor
 */
function Command(type) {
  events.EventEmitter.call(this);
  this.type = type;
  this.logger = new Logger('outpost:' + this.type);
}

util.inherits(Command, events.EventEmitter);

/**
 * Run this command
 * @param command the command data
 */
Command.prototype.run = function(command) {
  this.command = command;
  this.manifest = command.outpost.manifest;
  this._init();
};

/**
 * initialize this command for execution and prepare for execution
 * @private
 */
Command.prototype._init = function() {
  var npmConfig = {
    cache: this.command.outpost.config.cache,
    'fetch-retries': 2
  };

  var _this = this;
  npm.load(npmConfig, function (err) {
    if (err) {
      _this.complete('error', 'error loading npm config: ' + err);
      return;
    }
    _this.execute();
  });
};

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