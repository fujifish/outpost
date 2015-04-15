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
  _this._configure(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandConfigure.prototype._configure = function(cb) {
  var _this = this;
  var module = this.manifest.moduleByName(this.command.module);
  if (module) {
    module.package.read(function (err) {
      if (err) {
        cb('error reading module package file ' + module.package.file + ': ' + err);
        return;
      }
      _this._process(module, cb);
    });
  } else {
    _this.logger.info('skipping configure: module ' + this.command.module + ' not found');
    cb('skipped', null);
  }
};

CommandConfigure.prototype._process = function(module, cb) {
  var _this = this;
  var moduleData = module.package.data;
  var script = moduleData.config && moduleData.config.scripts && moduleData.config.scripts.configure;
  var configParams = this.command.configParams;
  if (script) {
    var modulesDir = _this.command.outpost.config.modules;
    var moduleDir = path.resolve(modulesDir, module.modulepath);
    var scriptPath = path.resolve(moduleDir, script);
    _this.logger.info('running configure script for module ' + module.fullname);
    var runner = new ScriptRunner('outpost:configure:'+module.fullname, scriptPath, configParams, moduleDir);
    runner.run(function(result, msg) {
      cb(result, msg);
    });
  } else {
    this.logger.info('skipping configure: module ' + module.fullname + ' has no configure script');
    cb('skipped', null);
  }
}
exports = module.exports = CommandConfigure;