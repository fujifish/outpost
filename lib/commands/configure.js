var util = require('util');
var fs = require('fs');
var path = require('path');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandConfigure() {
  Command.call(this, 'configure');
}

util.inherits(CommandConfigure, Command);

CommandConfigure.prototype.execute = function() {
  var _this = this;
  _this._configure(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandConfigure.prototype._configure = function(cb) {
  var _this = this;
  var module = this.manifest.moduleByName(this.command.module);
  if (module) {
    var script = module.config && module.config.scripts && module.config.scripts.configure;
    var configParams = this.command.configParams || {};
    if (script) {
      var modulesDir = _this.command.outpost.config.modules;
      var moduleDir = path.resolve(modulesDir, module.modulepath);
      var scriptPath = path.resolve(moduleDir, script);
      _this.logger.info('running configure script for module ' + module.fullname);
      var runner = new ScriptRunner(module.fullname+':configure', scriptPath, configParams, moduleDir);
      runner.run(function(err, result) {
        if (err) {
          cb('error', err);
          return;
        }
        cb(result, null);
      });
    } else {
      this.logger.info('skipping configure: module ' + module.fullname + ' has no configure script');
      cb('skipped', null);
    }
  } else {
    _this.logger.info('skipping configure: module ' + this.command.module + ' not found');
    cb('skipped', null);
  }
};

exports = module.exports = CommandConfigure;