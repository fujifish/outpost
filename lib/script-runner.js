var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var Logger = require('./logger');

/**
 * Run a script in a child process and wait for the script to finish execution
 * @param tag tag name for the log
 * @param script the script to run
 * @param scriptArgs arguments array to pass to the script
 * @param cwd current working directory of the script
 * @constructor
 */
function ScriptRunner(tag, script, scriptArgs, cwd) {
  this.script = script;
  scriptArgs = scriptArgs || [];
  if (!Array.isArray(scriptArgs)) {
    scriptArgs = [scriptArgs];
  }
  this.scriptArgs = scriptArgs || [];
  this.cwd = cwd;
  this.logger = new Logger(tag);
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
      var result;
      var scriptTimeout = null;
      var scriptRunner = childProcess.fork(path.resolve('lib/script.js'), _this.scriptArgs, {env: {outpostScript: _this.script}, cwd: _this.cwd});

      function complete(result, details) {
        _this.logger.debug('script completed with ' + result + (details ? ': ' + details : ''));
        scriptRunner.removeAllListeners();
        clearTimeout(scriptTimeout);
        cb(result, details);
      }

      function terminate(msg) {
        _this.logger.info('terminating script: ' + msg);
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
        if (message.error) {
          terminate('error running script: ' + message.error);
          return;
        }

        if (message.result) {
          result = message.result;
          complete(result, message.details);
          return;
        }

        if (message.progress) {
          renewScriptTimeout();
        }

        if (message.log) {
          _this.logger.info(message.log);
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
      _this.logger.error(e);
      complete('error', 'exception running script: ' + e.message);
    }
  });
};

exports = module.exports = ScriptRunner;
