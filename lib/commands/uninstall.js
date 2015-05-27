var util = require('util');
var fs = require('fs');
var path = require('path');
var fse = require('fs-extra');
var npm = require('npm');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandUninstall() {
  Command.call(this, 'uninstall');
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
  this.manifest.installedModule(this.command.module, _this.command.outpost.config.root, function(err, module) {
    if (err) {
      cb('error', err);
      return;
    }
    if (module) {
      var modulesDir = _this.command.outpost.config.modulesDir;
      var moduleDir = path.resolve(modulesDir, module.modulepath);
      fs.exists(moduleDir, function(exists) {
        if (!exists) {
          var msg = 'module ' + _this.command.module + ' is not installed';
          _this.logger.debug(msg);
          cb('skipped', msg);
          return;
        }
        _this._process(module, function(result, msg) {
          cb(result, msg);
        });
      });
    } else {
      _this.logger.error('module ' + _this.command.module + ' not found');
      cb('error', 'module ' + _this.command.module + ' not found');
    }
  });
};

CommandUninstall.prototype._runScript = function(module, type, script, config, cb) {
  var modulesDir = this.command.outpost.config.modulesDir;
  var moduleDir = path.resolve(modulesDir, module.modulepath);
  var scriptPath = path.resolve(moduleDir, script);
  this.logger.debug('running ' + type + ' script for module ' + module.fullname);
  var runner = new ScriptRunner(type, module, scriptPath, config, moduleDir, this.command.outpost);
  runner.run(function(result, msg) {
    cb(result, msg);
  });
};

CommandUninstall.prototype._process = function(module, cb) {
  var moduleData = module.package.data;
  var config = this.command.config;
  var stopScript = moduleData && moduleData.scripts && moduleData.scripts.stop;
  if (stopScript) {
    var _this = this;
    this._runScript(module, 'stop', stopScript, config, function(result, msg) {
      if (result === 'success') {
        _this._runUninstallScript(module, cb);
      } else {
        cb(result, msg);
      }
    });
  } else {
    this._runUninstallScript(module, cb);
  }
};

CommandUninstall.prototype._runUninstallScript = function(module, cb) {
  var moduleData = module.package.data;
  var config = this.command.config;
  var uninstallScript = moduleData && moduleData.scripts && moduleData.scripts.uninstall;
  if (uninstallScript) {
    var _this = this;
    this._runScript(module, 'uninstall', uninstallScript, config, function(result, msg) {
      if (result === 'success') {
        _this._removeModule(module, cb);
      } else {
        cb(result, msg);
      }
    });
  } else {
    this._removeModule(module, cb);
  }
};


CommandUninstall.prototype._removeModule = function(module, cb) {
  var modulesDir = this.command.outpost.config.modulesDir;
  var moduleDir = path.resolve(modulesDir, module.modulepath);

  // remove the module directory. it stays in the cache though.
  this.logger.debug('removing module directory ' + moduleDir);
  fse.remove(moduleDir, function(err) {
    if (err) {
      cb('error', 'failed to remove module directory: ' + err.message)
      return;
    }
    cb('success', null);
  });
};

exports = module.exports = CommandUninstall;