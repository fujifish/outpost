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
  this.cache.installedModule(this.command.module, this.command.outpost.config.root, function(err, module) {
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
  var config = this.command.config;
  var state = this.command.outpost.state;

  var modulesDir = this.command.outpost.config.modulesDir;
  var moduleDir = path.resolve(modulesDir, module.modulepath);

  // make sure the configuration has outpost metadata
  config = config || {};
  config._outpost = config._outpost || {};
  config._outpost.date = config._outpost.date || Date.now();
  config._outpost.version = config._outpost.version || -1;

  // save the configuration
  var _this = this;
  state.save(moduleDir, 'configuration', config, function(err) {
    if (err) {
      cb('error', 'error saving ' + module.fullname + ' configuration state: ' + err.message);
      return;
    }

    if (script) {
      var scriptPath = path.resolve(moduleDir, script);
      _this.logger.debug('running configure script for module ' + module.fullname);
      var runner = new ScriptRunner('configure', module, scriptPath, config, moduleDir, _this.command.outpost);
      runner.run(function(result, msg) {
        cb(result, msg);
      });
    } else {
      _this.logger.debug('skipping configure: module ' + module.fullname + ' has no configure script');
      cb('skipped', 'no configure script');
    }
  });

}
exports = module.exports = CommandConfigure;