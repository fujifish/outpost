var util = require('util');
var fs = require('fs');
var path = require('path');
var npm = require('npm');
var Command = require('../command');
var ScriptRunner = require('../script-runner');

function CommandStart() {
  Command.call(this);
}

util.inherits(CommandStart, Command);

CommandStart.prototype.execute = function() {
  var _this = this;
  this._start(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandStart.prototype._start = function(cb) {
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

CommandStart.prototype._process = function(module, cb) {
  var _this = this;
  var moduleData = module.package.data;
  var script = moduleData && moduleData.scripts && moduleData.scripts.start;
  var startConfig = this.command.config;
  var state = this.command.outpost.state;

  var modulesDir = this.command.outpost.config.modulesDir;
  var moduleDir = path.resolve(modulesDir, module.modulepath);

  // save the start state
  state.save(moduleDir, 'start', {started: true}, function(err) {
    if (err) {
      cb('error', 'error saving ' + module.fullname + ' start state: ' + err.message);
      return;
    }

    if (script) {
      var modulesDir = _this.command.outpost.config.modulesDir;
      var moduleDir = path.resolve(modulesDir, module.modulepath);
      var scriptPath = path.resolve(moduleDir, script);
      _this.logger.debug('running start script for module ' + module.fullname);
      var runner = new ScriptRunner('start', module, scriptPath, startConfig, moduleDir, _this.command.outpost);
      runner.run(function(result, msg) {
        cb(result, msg);
      });
    } else {
      _this.logger.debug('skipping start: module ' + module.fullname + ' has no start script');
      cb('skipped', 'no start script');
    }
  });
};
exports = module.exports = CommandStart;