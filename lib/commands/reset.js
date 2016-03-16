var util = require('util');
var fse = require('fs-extra');
var Command = require('../command');

function CommandReset() {
  Command.call(this);
}

util.inherits(CommandReset, Command);

CommandReset.prototype.execute = function() {
  var _this = this;
  this._reset(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandReset.prototype._reset = function(cb) {
  var _this = this;
  // stop the monitor service
  this.monitor.stop(function() {
    _this.logger.info('emptying root directory');
    // delete the entire .root directory
    fse.emptyDir(_this.outpost.config.root, function (err) {
      if (err) {
        cb('error', 'reset outpost failed: error emptying root directory: ' + err);
        return;
      }
      // start the monitor service
      _this.monitor.start(function(err) {
        if (err) {
          cb('error', 'reset outpost failed: monitor service failed to restart: ' + err);
          return;
        }
        cb('success');
      });
    })
  });
};

exports = module.exports = CommandReset;