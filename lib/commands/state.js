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
  var moduleKeys = Object.keys(modules);
  if (moduleKeys.length === 0) {
    table.addRow('There are no modules installed');
    return table.toString();
  }
  table.setHeading('Module', 'Version', 'Installed', 'Configured', 'Started');
  moduleKeys = moduleKeys.sort(function(a,b) {return modules[a].name > modules[b].name});
  moduleKeys.forEach(function(name) {
    var module = modules[name];
    var installed = module.state.install ? module.state.install.time : '';
    var configured = module.state.configure ? module.state.configure.time : '';
    var started = module.state.start ? module.state.start.time : '';
    table.addRow(module.name, module.version, installed, configured, started);
  });
  return table.toString();
};

CommandState.prototype._procsAsTable = function(procs) {
  var table = new AsciiTable('Processes');
  var proxKeys = Object.keys(procs);
  if (proxKeys.length === 0) {
    table.addRow('There are no processes monitored');
    return table.toString();
  }
  table.setHeading('Name', 'PID', 'Running', 'Module');
  proxKeys = proxKeys.sort(function(a,b) {return procs[a].name > procs[b].name});
  proxKeys.forEach(function(name) {
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
  // get the current state so we can rollback if there is an error
  this.state.current(function(err, rollbackState) {
    if (err) {
      cb('error', err);
      return;
    }

    // calculate the commands to run to reach the desired state
    _this.state.calculate(state, function(err, commands) {
      if (err) {
        _this.logger.error('error while calculating state commands: ' + err);
        cb('error', err);
        return;
      }

      if (commands.length === 0) {
        _this.logger.debug('state is already satisfied');
        cb('success');
        return;
      }

      // run state commands
      _this.outpost.process(commands, function(err) {
        if (err) {
          // we've got an error during processing, rollback the state
          _this.logger.warning('rolling back to previously known good state');
          _this.state.calculate(rollbackState.modules, function(calcErr, rollbackCommands) {
            if (calcErr) {
              _this.logger.error('error while calculating rollback state commands: ' + calcErr);
              _this.logger.fatal('current state might be stale!');
              cb('error', calcErr);
              return;
            }

            if (rollbackCommands.length === 0) {
              _this.logger.warning('rollback state is already satisfied');
              cb('error', err);
              return;
            }

            // run rollback state commands
            _this.outpost.process(rollbackCommands, function(rollbackErr) {
              if (rollbackErr) {
                _this.logger.error('error while processing rollback commands: ' + rollbackErr);
                _this.logger.fatal('current state might be stale!');
                cb('error', rollbackErr);
              } else {
                _this.logger.warning('state rollback completed successfully');
                cb('error', err);
              }
            });
          });
        } else {
          _this.logger.debug('state applied successfully');
          cb('success');
        }
      });
    });
  });
};

exports = module.exports = CommandState;