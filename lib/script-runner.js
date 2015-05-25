var fs = require('fs');
var util = require('util');
var path = require('path');
var childProcess = require('child_process');
var chalk = require('chalk');
var Logger = require('./logger');

/**
 * Run a script in a child process and wait for the script to finish execution
 * @param command the command context
 * @param module the module context
 * @param script the script to run
 * @param scriptConfig script configuration parameters to pass to the script
 * @param cwd current working directory of the script
 * @param outpost outpost object
 * @constructor
 */
function ScriptRunner(command, module, script, scriptConfig, cwd, outpost) {
  this.module = module;
  this.script = script;
  this.scriptConfig = scriptConfig || {};
  this.cwd = cwd;
  this.config = outpost.config;
  this.monitor = outpost.monitor;
  this.chalk = new chalk.constructor({enabled: true});

  var tag = 'outpost:' + command + ':' + module.fullname;
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
        if (message.result) {
          complete(message.result, message.details);
        } else if (message.monitor) {
          _this.monitor.monitor(_this.module, message.monitor, function(err) {
            // send the callback back to the script
            scriptRunner.send({cbid: message.cbid, args: [err]})
          });
          renewScriptTimeout();
        } else if (message.unmonitor) {
          _this.monitor.unmonitor(message.unmonitor, function(err) {
            // send the callback back to the script
            scriptRunner.send({cbid: message.cbid, args: [err]})
          });
          renewScriptTimeout();
        } else if (message.progress) {
          renewScriptTimeout();
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

exports = module.exports = ScriptRunner;