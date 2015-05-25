var util = require('util');
var fs = require('fs');
var path = require('path');
var npm = require('npm');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandConfigure() {
  Command.call(this, 'configure');
}

util.inherits(CommandConfigure, Command);

CommandConfigure.prototype.execute = function() {
  var _this = this;
  this._configure(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandConfigure.prototype._configure = function(cb) {
  var _this = this;
  this.manifest.moduleByName(this.command.module, function(err, module) {
    if (err) {
      cb('error', err);
      return;
    }
    if (module) {
      _this._process(module, cb);
    } else {
      _this.logger.error('module ' + _this.command.module + ' not found');
      cb('error', 'module ' + _this.command.module + ' not found');
    }
  });
};

CommandConfigure.prototype._process = function(module, cb) {
  var moduleData = module.package.data;
  var script = moduleData && moduleData.scripts && moduleData.scripts.configure;
  var configureConfig = this.command.config;
  if (script) {
    var modulesDir = this.command.outpost.config.modulesDir;
    var moduleDir = path.resolve(modulesDir, module.modulepath);
    var scriptPath = path.resolve(moduleDir, script);
    this.logger.debug('running configure script for module ' + module.fullname);
    var runner = new ScriptRunner('configure', module, scriptPath, configureConfig, moduleDir, this.command.outpost);
    runner.run(function(result, msg) {
      cb(result, msg);
    });
  } else {
    this.logger.debug('skipping configure: module ' + module.fullname + ' has no configure script');
    cb('skipped', 'no configure script');
  }
}
exports = module.exports = CommandConfigure;