var fs = require('fs');
var util = require('util');
var path = require('path');
var childProcess = require('child_process');
var chalk = require('chalk');
var Logger = require('./logger');

/**
 * Run a script in a child process and wait for the script to finish execution
 * @param type the command type
 * @param module the module context
 * @param script the script to run
 * @param scriptConfig script configuration parameters to pass to the script
 * @param cwd current working directory of the script
 * @param outpost outpost object
 * @constructor
 */
function ScriptRunner(type, module, script, scriptConfig, cwd, outpost) {
  this.type = type;
  this.module = module;
  this.script = script;
  this.scriptConfig = scriptConfig || {};
  this.cwd = cwd;
  this.outpost = outpost;
  this.config = outpost.config;
  this.manifest = outpost.manifest;
  this.monitor = outpost.monitor;
  this.chalk = new chalk.constructor({enabled: true});

  var tag = 'outpost:' + type + ':' + module.fullname;
  this.logger = new Logger(tag, outpost.logger);
}

/**
 * Run the script as a child process
 * @param cb invoked when the script finished. receives the completion status and details message
 */
ScriptRunner.prototype.run = function(cb) {
  this.logger.debug('running script ' + this.script);
  var _this = this;
  fs.exists(this.script, function(exists) {
    if (!exists) {
      cb('error', 'script ' + _this.script + ' does not exist');
      return;
    }

    try {
      var outpostConfig = util._extend({}, _this.config);
      delete outpostConfig.logger; // remove the logger from the config

      var result;
      var scriptTimeout = null;
      var scriptRunner = childProcess.fork(path.resolve('lib/script.js'), {
        cwd: _this.cwd,
        env: {
          outpostScript: _this.script,
          outpostScriptType: _this.type,
          outpostScriptConfig: JSON.stringify(_this.scriptConfig),
          outpostConfig: JSON.stringify(outpostConfig)
        }
      });

      function complete(result, details) {
        var logMessage = 'script completed with ' + result + (details ? ': ' + details : '');
        if (result === 'error') {
          _this.logger.error(logMessage);
        } else {
          _this.logger.debug(logMessage);
        }
        scriptRunner && scriptRunner.removeAllListeners();
        clearTimeout(scriptTimeout);
        cb(result, details);
      }

      function terminate(msg) {
        _this.logger.error('terminating script: ' + msg);
        scriptRunner.kill('SIGKILL');
        cb('error', msg);
      }

      function renewScriptTimeout() {
        clearTimeout(scriptTimeout);
        scriptTimeout = setTimeout(function() {
          terminate('timeout')
        }, 60 * 1000);
      }

      scriptRunner.on('message', function(message) {
        // script ended running
        if (message.result) {
          complete(message.result, message.details);

        // start monitoring a process
        } else if (message.monitor) {
          _this.monitor.monitor(_this.module, message.monitor, function(err) {
            // send the callback back to the script
            scriptRunner.send({cbid: message.cbid, args: [err]})
          });
          renewScriptTimeout();

        // stop monitoring a process
        } else if (message.unmonitor) {
          _this.monitor.unmonitor(message.unmonitor, function(err) {
            // send the callback back to the script
            scriptRunner.send({cbid: message.cbid, args: [err]})
          });
          renewScriptTimeout();

        // run a script from a sub module
        } else if (message.script) {
          _this._runSubModuleScript(message.script.module, message.script.config, function(err) {
            // send the callback back to the script
            scriptRunner.send({cbid: message.cbid, args: [err]})
          });
          renewScriptTimeout();

        // show some progress
        } else if (message.progress) {
          renewScriptTimeout();

        // log a message
        } else if (message.log) {
          _this.logger.info('  ' + _this.chalk.cyan(message.log));
          renewScriptTimeout();
        }

      });

      scriptRunner.on('error', function(err) {
        terminate('error running script: ' + err);
      });

      scriptRunner.on('exit', function(code, signal) {
        var error;
        if (code !== 0) {
          complete('error', 'exited with code ' + code + ' (signal ' + signal + ')');
          return;
        }

        if (!result) {
          complete('error', 'missing result');
        }

        // we already have a result and reported the script completion

      });

    } catch (e) {
      _this.logger.error(e.stack);
      complete('error', 'exception running script: ' + e.message);
    }
  });
};

/**
 * Run a script of a submodule
 * @param module the submodule name
 * @param config the configuration to pass to the script
 * @param cb
 * @private
 */
ScriptRunner.prototype._runSubModuleScript = function(module, config, cb) {
  var _this = this;

  if (typeof module === 'object') {
    // module is the actual module object
    var moduleData = module.package.data;
    var script = moduleData && moduleData.scripts && moduleData.scripts[_this.type];
    if (!script) {
      cb('module ' + module.name +  ' has no ' + _this.type + ' script');
      return;
    }

    var targetDir = path.resolve(_this.cwd, '.modules/' + module.modulepath);
    var scriptPath = path.resolve(targetDir, script);
    var subRunner = new ScriptRunner(_this.type, module, scriptPath, config, targetDir, _this.outpost);
    subRunner.run(function(result, msg) {
      var err = undefined;
      if (result !== 'success') {
        err = msg;
      }
      cb(err);
    });
  } else {
    this.manifest.installedModule(module, _this.cwd, function(err, _module) {
      if (err) {
        cb(err);
        return;
      }
      _this._runSubModuleScript(_module, config, cb);
    });
  }
};

exports = module.exports = ScriptRunner;
