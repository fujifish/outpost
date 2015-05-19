var util = require('util');
var fs = require('fs');
var path = require('path');
var npm = require('npm');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandUninstall() {
  Command.call(this, 'start');
}

util.inherits(CommandUninstall, Command);

CommandUninstall.prototype.execute = function() {
  var _this = this;
  this._uninstall(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandUninstall.prototype._uninstall = function(cb) {
  var _this = this;
  this.manifest.moduleByName(this.command.module, function(err, module) {
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

CommandUninstall.prototype._process = function(module, cb) {
  var _this = this;
  var moduleData = module.package.data;
  var stopScript = moduleData && moduleData.scripts && moduleData.scripts.stop;
  var uninstallScript = moduleData && moduleData.scripts && moduleData.scripts.uninstall;
  var uninstallConfig = this.command.config;
  if (uninstallScript) {

    function _runScript(script, config, cb) {
      var scriptPath = path.resolve(moduleDir, script);
      _this.logger.info('running stop script for module ' + module.fullname);
      runner = new ScriptRunner('stop', module, scriptPath, config, moduleDir, _this.command.outpost);
      runner.run(function(result, msg) {
        cb(result, msg);
      });
    }

    var runner;
    var modulesDir = _this.command.outpost.config.modulesDir;
    var moduleDir = path.resolve(modulesDir, module.modulepath);
    if (stopScript) {
      // before uninstalling, stop the module
      _runScript(stopScript, uninstallConfig, function(result, msg) {
        if (result === 'success') {
          _runScript(uninstallScript, uninstallConfig, cb);
        }
      });
    } else {
      _runScript(uninstallScript, uninstallConfig, cb);
    }
  } else {
    this.logger.info('skipping uninstall: module ' + module.fullname + ' has no uninstall script');
    cb('skipped', 'no uninstall script');
  }
};
exports = module.exports = CommandUninstall;