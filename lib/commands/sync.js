var util = require('util');
var fs = require('fs');
var path = require('path');
var Command = require('../command');

function CommandSync() {
  Command.call(this);
}

util.inherits(CommandSync, Command);

CommandSync.prototype.execute = function() {
  var _this = this;
  this._process(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandSync.prototype._process = function(cb) {
  var _this = this;
  var fortitude = this.outpost.fortitude;

  // get the current state to send to fortitude
  this.state.current(function(err, state) {
    if (err) {
      cb('error', err);
      return;
    }

    fortitude.sync(state, function(err, response) {
      if (err) {
        cb('error', err);
        return;
      }

      if (!response || !response.commands) {
        _this.logger.debug('nothing to do, sync is complete');
        cb('success');
        return;
      }

      _this.outpost.process(response.commands, function(err) {
        if (err) {
          cb('error', err);
        } else {
          _this.logger.debug('sync is complete');
          cb('success');
        }
      });
    });
  });
};

exports = module.exports = CommandSync;