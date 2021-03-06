var util = require('util');
var fs = require('fs');
var path = require('path');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandStop() {
  Command.call(this);
}

util.inherits(CommandStop, Command);

CommandStop.prototype.execute = function() {
  var _this = this;
  this._stop(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandStop.prototype._stop = function(cb) {
  var _this = this;
  this.cache.installedModule(this.command.module, this.command.outpost.config.root, function(err, module) {
    if (err) {
      cb('error', err);
      return;
    }
    if (module) {
      _this._process(module, cb);
    } else {
      this.logger.error('module ' + _this.command.module + ' not found');
      cb('error', 'module ' + _this.command.module + ' not found');
    }
  });
};

CommandStop.prototype._process = function(module, cb) {
  var _this = this;
  var moduleData = module.data;
  var script = moduleData && moduleData.scripts && moduleData.scripts.stop;
  var stopConfig = this.command.config;
  var state = this.command.outpost.state;

  var modulesDir = this.command.outpost.config.modulesDir;
  var moduleDir = path.resolve(modulesDir, module.modulepath);

  // delete the start state
  state.save(moduleDir, 'start', {started: false}, function(err) {
    if (err) {
      cb('error', 'error removing ' + module.fullname + ' start state: ' + err.message);
      return;
    }

    if (script) {
      var modulesDir = _this.command.outpost.config.modulesDir;
      var moduleDir = path.resolve(modulesDir, module.modulepath);
      var scriptPath = path.resolve(moduleDir, script);
      _this.logger.debug('running stop script for module ' + module.fullname);
      var runner = new ScriptRunner('stop', module, scriptPath, stopConfig, moduleDir, _this.command.outpost);
      runner.run(function(result, msg) {
        cb(result, msg);
      });
    } else {
      _this.logger.debug('skipping stop: module ' + module.fullname + ' has no stop script');
      cb('skipped', 'no stop script');
    }
  });
};
exports = module.exports = CommandStop;