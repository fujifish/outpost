var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var Logger = require('./logger');

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

      function complete(result, msg) {
        _this.logger.debug('script completed with ' + result + (msg ? ': ' + msg : ''));
        scriptRunner.removeAllListeners();
        clearTimeout(scriptTimeout);
        cb(result, msg);
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
        if (message.err) {
          terminate('error running script: ' + message.err);
          return;
        }

        if (message.result) {
          complete(message.result);
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
        var msg;
        if (code !== 0) {
          result = 'error';
          msg = 'abnormal termination (signal ' + signal + ')';
        }

        if (!result) {
          result = 'error';
          msg = 'missing result';
        }

        complete(result, msg);
      });

    } catch (e) {
      _this.logger.error(e);
      complete('error', 'exception running script: ' + e.message);
    }
  });
};

exports = module.exports = ScriptRunner;
