var util = require('util');
var fs = require('fs');
var path = require('path');
var AsciiTable = require('ascii-table');
var Command = require('../command');

function CommandState() {
  Command.call(this);
}

util.inherits(CommandState, Command);

CommandState.prototype.execute = function() {
  var _this = this;
  this._process(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandState.prototype._process = function(cb) {

  if (!this['_'+this.command.action]) {
    cb('error', this.command.action + ' is not a valid action');
    return;
  }

  this['_'+this.command.action].call(this, cb);
};

CommandState.prototype._show = function(cb) {
  var _this = this;
  this.state.installed(function(err, modules) {
    if (err) {
      cb('error', err);
      return;
    }
    _this.monitor.summary(function(processes) {
      var result;
      if (_this.command.format === 'table') {
        result =
          _this._modulesAsTable(modules) + '\n' +
          _this._procsAsTable(processes);
      } else {
        var data = {modules: modules, processes: processes};
        if (_this.command.format === 'json') {
          result = JSON.stringify(data, null, 2);
        } else {
          result = JSON.stringify(data);
        }
      }
      cb('success', result);
    })
  });
};

CommandState.prototype._modulesAsTable = function(modules) {
  var table = new AsciiTable('Modules');
  table.setHeading('Module', 'Version', 'Installed', 'Configured', 'Started', 'Sub-Modules');
  Object.keys(modules).forEach(function(name) {
    var module = modules[name];
    var installed = module.state.install ? module.state.install.time : '';
    var configured = module.state.configure ? module.state.configure.time : '';
    var started = module.state.start ? module.state.start.time : '';
    table.addRow(module.name, module.version, installed, configured, started, module.meta.data.submodules);
  });
  return table.toString();
};

CommandState.prototype._procsAsTable = function(procs) {
  var table = new AsciiTable('Processes');
  table.setHeading('Name', 'PID', 'Running', 'Module');
  Object.keys(procs).forEach(function(name) {
    var proc = procs[name];
    table.addRow(proc.name, proc.pid || '', proc.running ? 'yes' : 'no', proc.modulepath);
  });
  return table.toString();
};

CommandState.prototype._apply = function(cb) {
  var state = this.command.state;
  if (typeof state === 'string') {
    try {
      state = JSON.parse(this.command.state);
    } catch (err) {
      cb('error', 'error parsing state');
      return;
    }
  }

  if (!Array.isArray(state)) {
    cb('error', 'invalid state object. expected array.');
    return;
  }

  var _this = this;
  this.state.calculate(state, function(err, commands) {
    var all = [];
    all = all.concat(commands.uninstall || []);
    all = all.concat(commands.install || []);
    all = all.concat(commands.configure || []);
    all = all.concat(commands.start || []);

    if (all.length === 0) {
      _this.logger.debug('state is already satisfied');
    }

    _this.outpost.process(all, function(err) {
      if (err) {
        cb('error', err);
      } else {
        _this.logger.debug('state is satisfied');
        cb('success');
      }
    });
  });
};

exports = module.exports = CommandState;