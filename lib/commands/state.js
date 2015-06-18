var util = require('util');
var fs = require('fs');
var path = require('path');
var Command = require('../command');

function CommandState() {
  Command.call(this);
}

util.inherits(CommandState, Command);

CommandState.prototype.execute = function() {
  var _this = this;
  this._process(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandState.prototype._process = function(cb) {

  if (!this['_'+this.command.action]) {
    cb('error', this.command.action + ' is not a valid action');
    return;
  }

  this['_'+this.command.action].call(this, cb);
};

CommandState.prototype._show = function(cb) {
  this.state.installed(function(err, modules) {
    if (err) {
      cb('error', err);
    } else {
      cb('success', JSON.stringify(modules, null, 2));
    }
  });
};

CommandState.prototype._apply = function(cb) {
  var state = this.command.state;
  if (typeof state === 'string') {
    try {
      state = JSON.parse(this.command.state);
    } catch (err) {
      cb('error', 'error parsing state');
      return;
    }
  }

  if (!Array.isArray(state)) {
    cb('error', 'invalid state object. expected array.');
    return;
  }

  var _this = this;
  this.state.calculate(state, function(err, commands) {
    var all = [];
    all = all.concat(commands.uninstall || []);
    all = all.concat(commands.install || []);
    all = all.concat(commands.configure || []);
    all = all.concat(commands.start || []);

    if (all.length === 0) {
      _this.logger.debug('state is already satisfied');
    }

    _this.outpost.process(all, function(err) {
      if (err) {
        cb('error', err);
      } else {
        _this.logger.debug('state is satisfied');
        cb('success');
      }
    });
  });
};

exports = module.exports = CommandState;