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

  // stop all monitored processes
  this.monitor.unmonitorAll(function() {
    // stop the monitor service
    _this.monitor.stop(function() {
      _this.logger.info('emptying cache directory');
      fse.emptyDir(_this.outpost.config.cacheDir, function (err) {
        if (err) {
          cb('error', 'reset outpost failed: error emptying cache directory: ' + err);
          return;
        }
        _this.logger.info('emptying monitor directory');
        fse.emptyDir(_this.outpost.config.monitorDir, function (err) {
          if (err) {
            cb('error', 'reset outpost failed: error emptying monitor directory: ' + err);
            return;
          }
          _this.logger.info('emptying modules directory');
          fse.emptyDir(_this.outpost.config.modulesDir, function(err) {
            if (err) {
              cb('error', 'reset outpost failed: error emptying modules directory: ' + err);
              return;
            }
            // start the monitor service
            _this.monitor.start(true, function(err) {
              if (err) {
                cb('error', 'reset outpost failed: monitor service failed to restart: ' + err);
                return;
              }
              cb('success');
            });
          });
        });
      });
    });
  });
};

exports = module.exports = CommandReset;